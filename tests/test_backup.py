import base64
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from restore_backup import TABLES, restore, restore_operational


class BackupRestoreTests(unittest.TestCase):
    password = "senha-de-teste-com-mais-de-12"

    def archive(self, path, data, version="direct-data-v1"):
        payload = {"format": version, "exportedAt": "2026-09-29T12:00:00Z", "tables": data}
        salt, iv = os.urandom(16), os.urandom(12)
        key = __import__("hashlib").pbkdf2_hmac("sha256", self.password.encode(), salt, 200000, 32)
        encrypted = AESGCM(key).encrypt(iv, json.dumps(payload).encode(), None)
        path.write_text(json.dumps({"format": "direct-encrypted-v1", "salt": base64.b64encode(salt).decode(),
                                    "iv": base64.b64encode(iv).decode(), "data": base64.b64encode(encrypted).decode()}))

    def test_restore_preserves_rows_and_relations(self):
        data = {table: [] for table in TABLES}
        data["diaristas"] = [{"id": "worker-1", "nome": "Pessoa de teste"}]
        data["pedidos"] = [{"id": "order-1", "supermercado": "Rede de teste"}]
        data["pedido_escalas"] = [{"id": "shift-1", "pedido_id": "order-1", "diarista_id": "worker-1"}]
        data["diarias"] = [{"id": "daily-1", "pedido_escala_id": "shift-1", "diarista_id": "worker-1"}]
        with tempfile.TemporaryDirectory() as directory:
            archive, output = Path(directory) / "backup.json", Path(directory) / "restored.db"
            self.archive(archive, data)
            counts = restore(archive, self.password, output)
            self.assertEqual(sum(counts.values()), 4)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with sqlite3.connect(output) as db:
                records = db.execute("select record_json from backup_rows where source_table='diarias'").fetchall()
                self.assertEqual(json.loads(records[0][0])["pedido_escala_id"], "shift-1")

    def test_rejects_broken_references_without_output(self):
        data = {table: [] for table in TABLES}
        data["pedido_escalas"] = [{"id": "shift-1", "pedido_id": "missing"}]
        with tempfile.TemporaryDirectory() as directory:
            archive, output = Path(directory) / "backup.json", Path(directory) / "restored.db"
            self.archive(archive, data)
            with self.assertRaisesRegex(ValueError, "referências quebradas"):
                restore(archive, self.password, output)
            self.assertFalse(output.exists())

    def test_wrong_password_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, output = Path(directory) / "backup.json", Path(directory) / "restored.db"
            self.archive(archive, {table: [] for table in TABLES})
            with self.assertRaises(Exception):
                restore(archive, "incorrecta", output)
            self.assertFalse(output.exists())

    def test_operational_restore_recovers_linked_finance(self):
        import server
        from test_server import SAMPLE
        previous_path = server.DB_PATH
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                server.DB_PATH = root / "source.db"
                server.init_db()
                with server.connect() as db:
                    worker = server.validate(SAMPLE)
                    keys = ", ".join(worker)
                    marks = ", ".join("?" for _ in worker)
                    worker_id = db.execute(f"INSERT INTO diaristas ({keys}, criado_em, atualizado_em) VALUES ({marks}, ?, ?)",
                                           (*worker.values(), "2026-09-29", "2026-09-29")).lastrowid
                    order = server.validate_order({"supermercado": "Super do Povo", "unidade": "Meireles",
                        "setor": "Operador de caixa", "quantidade_diaristas": 1,
                        "turnos": [{"data": "2026-09-29", "inicio": "08:00", "fim": "17:00"}]})
                    keys = ", ".join(order)
                    marks = ", ".join("?" for _ in order)
                    order_id = db.execute(f"INSERT INTO pedidos ({keys}, criado_em, atualizado_em) VALUES ({marks}, ?, ?)",
                                          (*order.values(), "2026-09-29", "2026-09-29")).lastrowid
                    scale_id = db.execute("""INSERT INTO pedido_escalas
                        (pedido_id, diarista_id, data, status, criado_em, atualizado_em)
                        VALUES (?, ?, '2026-09-29', 'presente', '2026-09-29', '2026-09-29')""",
                        (order_id, worker_id)).lastrowid
                    daily_id = db.execute("""INSERT INTO diarias
                        (diarista_id, data, local, setor, pedido_escala_id, valor_centavos,
                         valor_recebido_centavos, vencimento_pagamento, criado_em)
                        VALUES (?, '2026-09-29', 'Super do Povo · Meireles', 'Operador de caixa',
                                ?, 9000, 13400, '2026-09-29', '2026-09-29')""", (worker_id, scale_id)).lastrowid
                    invoice_id = db.execute("""INSERT INTO cobrancas
                        (rede, periodo_inicio, periodo_fim, vencimento, valor_centavos, criado_em, atualizado_em)
                        VALUES ('Super do Povo', '2026-09-29', '2026-09-29', '2026-10-10', 13400,
                                '2026-09-29', '2026-09-29')""").lastrowid
                    db.execute("""INSERT INTO cobranca_itens (cobranca_id, diaria_id, pedido_id, data, valor_centavos)
                        VALUES (?, ?, ?, '2026-09-29', 13400)""", (invoice_id, daily_id, order_id))
                    db.execute("CREATE TABLE direct_staff (email TEXT PRIMARY KEY, role TEXT, active INTEGER)")
                    data = {table: [dict(row) for row in db.execute(f"SELECT * FROM {table}")] for table in TABLES}
                archive, target = root / "source.json", root / "recovered.db"
                self.archive(archive, data, "direct-data-v3")
                counts = restore_operational(archive, self.password, target)
                self.assertEqual(counts["diaristas"], 1)
                self.assertEqual(counts["cobranca_itens"], 1)
                with sqlite3.connect(target) as db:
                    self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
                    self.assertEqual(db.execute("SELECT count(*) FROM diarias WHERE pedido_escala_id = ?", (scale_id,)).fetchone()[0], 1)
                self.assertEqual(server.finance_rows()[0]["valor_centavos"], 9000)
        finally:
            server.DB_PATH = previous_path


if __name__ == "__main__":
    unittest.main()
