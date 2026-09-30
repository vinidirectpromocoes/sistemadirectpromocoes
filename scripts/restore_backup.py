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
    "leituras_pendentes", "direct_staff", "direct_auditoria", "cobrancas",
    "cobranca_itens", "cobranca_recebimentos", "pagamento_lotes", "custos_extras", "contratos", "ocorrencias",
)
LEGACY_TABLES = TABLES[:11]


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
    if payload.get("format") not in ("direct-data-v1", "direct-data-v2", "direct-data-v3", "direct-data-v4") or not isinstance(payload.get("tables"), dict):
        raise ValueError("Conteúdo da cópia não reconhecido")
    required = TABLES if payload["format"] == "direct-data-v4" else TABLES[:16] if payload["format"] == "direct-data-v3" else TABLES[:15] if payload["format"] == "direct-data-v2" else LEGACY_TABLES
    for table in required:
        if not isinstance(payload["tables"].get(table), list):
            raise ValueError(f"Tabela ausente: {table}")
        if not all(isinstance(row, dict) for row in payload["tables"][table]):
            raise ValueError(f"Registros inválidos: {table}")
    for table in TABLES:
        payload["tables"].setdefault(table, [])
    return payload


def relationship_errors(data):
    ids = {table: {str(row["id"]) for row in data[table] if row.get("id") is not None}
           for table in ("diaristas", "pedidos", "pedido_escalas", "diarias", "cobrancas", "pagamento_lotes", "contratos")}
    links = (
        ("diarias", "contrato_id", "contratos"),
        ("contratos", "versao_anterior_id", "contratos"),
        ("ocorrencias", "pedido_id", "pedidos"),
        ("ocorrencias", "escala_id", "pedido_escalas"),
        ("diarias", "diarista_id", "diaristas"),
        ("diarias", "pedido_escala_id", "pedido_escalas"),
        ("pedido_escalas", "pedido_id", "pedidos"),
        ("pedido_escalas", "diarista_id", "diaristas"),
        ("pedido_escalas", "substituida_por_escala_id", "pedido_escalas"),
        ("diarias", "pagamento_lote_id", "pagamento_lotes"),
        ("pagamento_lotes", "diarista_id", "diaristas"),
        ("cobranca_itens", "cobranca_id", "cobrancas"),
        ("cobranca_itens", "diaria_id", "diarias"),
        ("cobranca_itens", "pedido_id", "pedidos"),
        ("cobranca_recebimentos", "cobranca_id", "cobrancas"),
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


def restore_operational(archive_path, password, output_path):
    """Restore an export into a fresh runnable local database, never a live database."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import server

    archive = json.loads(Path(archive_path).read_text(encoding="utf-8"))
    payload = decrypt_archive(archive, password)
    data = payload["tables"]
    problems = relationship_errors(data)
    if problems:
        raise ValueError("Cópia com referências quebradas: " + "; ".join(problems[:5]))
    destination = Path(output_path).resolve()
    if destination.exists():
        raise FileExistsError("A base de destino já existe; escolha um novo arquivo para o ensaio")
    destination.parent.mkdir(parents=True, exist_ok=True)
    server.DB_PATH = destination
    try:
        server.init_db()
        os.chmod(destination, 0o600)
        db = server.connect()
        try:
            db.execute("PRAGMA foreign_keys = OFF")
            order = ("ocorrencias", "contratos", "cobranca_recebimentos", "cobranca_itens", "cobrancas", "diarias", "pedido_escalas",
                     "pagamento_lotes", "financeiro_lancamentos", "leituras_pendentes", "custos_extras",
                     "tarifas_setores", "tarifas_redes", "lojas", "pedidos", "diaristas", "direct_auditoria")
            with db:
                for table in order:
                    db.execute(f"DELETE FROM {table}")
                # SQLite is the operational drill target; Auth users are managed separately by Supabase.
                db.execute("CREATE TABLE IF NOT EXISTS direct_staff (email TEXT PRIMARY KEY, role TEXT, active INTEGER)")
                db.execute("DELETE FROM direct_staff")
                insert_order = ("diaristas", "pedidos", "lojas", "tarifas_redes", "tarifas_setores",
                                "contratos", "pagamento_lotes", "pedido_escalas", "diarias", "ocorrencias", "cobrancas", "cobranca_itens",
                                "cobranca_recebimentos", "financeiro_lancamentos", "leituras_pendentes",
                                "custos_extras", "direct_staff")
                for table in insert_order:
                    columns = {item["name"] for item in db.execute(f"PRAGMA table_info({table})")}
                    for row in data[table]:
                        values = {key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                                  for key, value in row.items() if key in columns}
                        names = ", ".join(values)
                        markers = ", ".join("?" for _ in values)
                        db.execute(f"INSERT INTO {table} ({names}) VALUES ({markers})", tuple(values.values()))
                db.execute("DELETE FROM direct_auditoria")
                columns = {item["name"] for item in db.execute("PRAGMA table_info(direct_auditoria)")}
                for row in data["direct_auditoria"]:
                    values = {key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                              for key, value in row.items() if key in columns}
                    names = ", ".join(values)
                    markers = ", ".join("?" for _ in values)
                    db.execute(f"INSERT INTO direct_auditoria ({names}) VALUES ({markers})", tuple(values.values()))
            db.execute("PRAGMA foreign_keys = ON")
            invalid = db.execute("PRAGMA foreign_key_check").fetchall()
            if invalid:
                raise ValueError(f"Integridade referencial inválida: {len(invalid)} vínculo(s)")
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Falha de integridade da base restaurada")
            actual = {table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in TABLES}
            expected = {table: len(data[table]) for table in TABLES}
            if actual != expected:
                raise ValueError("Contagem divergente após restauração operacional")
            return actual
        finally:
            db.close()
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Arquivo JSON criptografado baixado do sistema")
    parser.add_argument("output", type=Path, help="Novo arquivo SQLite isolado (não pode existir)")
    parser.add_argument("--operational", action="store_true", help="Restaurar tabelas reais do servidor local, em arquivo novo")
    args = parser.parse_args()
    action = restore_operational if args.operational else restore
    counts = action(args.archive, getpass.getpass("Senha da cópia: "), args.output)
    print(f"Restauração isolada concluída: {sum(counts.values())} registros, {len(TABLES)} tabelas. Arquivo: {args.output}")
    print("O arquivo restaurado contém dados sem criptografia; proteja-o e apague-o após a conferência.")


if __name__ == "__main__":
    main()
