"""Materialize a Direct encrypted export in an isolated SQLite database.

This never connects to Supabase. The resulting SQLite file contains personal
and financial data in plaintext; keep it private and remove it after a drill.
"""

import argparse
import base64
import getpass
import json
import os
import sqlite3
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


TABLES = (
    "diaristas", "diarias", "pedidos", "pedido_escalas", "lojas",
    "financeiro_lancamentos", "tarifas_redes", "tarifas_setores",
    "leituras_pendentes", "direct_staff", "direct_auditoria",
)


def decrypt_archive(archive, password):
    if archive.get("format") != "direct-encrypted-v1":
        raise ValueError("Formato de cópia não reconhecido")
    salt = base64.b64decode(archive["salt"], validate=True)
    iv = base64.b64decode(archive["iv"], validate=True)
    ciphertext = base64.b64decode(archive["data"], validate=True)
    if len(salt) != 16 or len(iv) != 12:
        raise ValueError("Parâmetros de criptografia inválidos")
    key = __import__("hashlib").pbkdf2_hmac("sha256", password.encode(), salt, 200000, 32)
    payload = json.loads(AESGCM(key).decrypt(iv, ciphertext, None))
    if payload.get("format") != "direct-data-v1" or not isinstance(payload.get("tables"), dict):
        raise ValueError("Conteúdo da cópia não reconhecido")
    for table in TABLES:
        if not isinstance(payload["tables"].get(table), list):
            raise ValueError(f"Tabela ausente: {table}")
        if not all(isinstance(row, dict) for row in payload["tables"][table]):
            raise ValueError(f"Registros inválidos: {table}")
    return payload


def relationship_errors(data):
    ids = {table: {str(row["id"]) for row in data[table] if row.get("id") is not None}
           for table in ("diaristas", "pedidos", "pedido_escalas")}
    links = (
        ("diarias", "diarista_id", "diaristas"),
        ("diarias", "pedido_escala_id", "pedido_escalas"),
        ("pedido_escalas", "pedido_id", "pedidos"),
        ("pedido_escalas", "diarista_id", "diaristas"),
    )
    errors = []
    for table, column, target in links:
        for index, row in enumerate(data[table]):
            value = row.get(column)
            if value is not None and str(value) not in ids[target]:
                errors.append(f"{table}[{index}].{column} sem {target} correspondente")
    return errors


def restore(archive_path, password, output_path):
    archive = json.loads(Path(archive_path).read_text(encoding="utf-8"))
    payload = decrypt_archive(archive, password)
    problems = relationship_errors(payload["tables"])
    if problems:
        raise ValueError("Cópia com referências quebradas: " + "; ".join(problems[:5]))
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
    os.close(fd)
    try:
        with sqlite3.connect(destination) as db:
            db.execute("create table backup_meta (format text not null, exported_at text not null)")
            db.execute("insert into backup_meta values (?, ?)", (payload["format"], payload["exportedAt"]))
            db.execute("create table backup_rows (source_table text not null, ordinal integer not null, source_id text, record_json text not null, primary key(source_table, ordinal))")
            for table in TABLES:
                db.executemany("insert into backup_rows values (?, ?, ?, ?)",
                               ((table, index, str(row.get("id", row.get("email", ""))), json.dumps(row, ensure_ascii=False))
                                for index, row in enumerate(payload["tables"][table])))
            actual = dict(db.execute("select source_table, count(*) from backup_rows group by source_table"))
            expected = {table: len(payload["tables"][table]) for table in TABLES}
            if any(actual.get(table, 0) != count for table, count in expected.items()):
                raise ValueError("Contagem divergente após restauração")
            if db.execute("pragma integrity_check").fetchone()[0] != "ok":
                raise ValueError("Falha de integridade do SQLite")
        return expected
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Arquivo JSON criptografado baixado do sistema")
    parser.add_argument("output", type=Path, help="Novo arquivo SQLite isolado (não pode existir)")
    args = parser.parse_args()
    counts = restore(args.archive, getpass.getpass("Senha da cópia: "), args.output)
    print(f"Restauração isolada concluída: {sum(counts.values())} registros, {len(TABLES)} tabelas. Arquivo: {args.output}")
    print("O arquivo restaurado contém dados sem criptografia; proteja-o e apague-o após a conferência.")


if __name__ == "__main__":
    main()
