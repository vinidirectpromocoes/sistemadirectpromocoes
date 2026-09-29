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
from restore_backup import TABLES, restore


class BackupRestoreTests(unittest.TestCase):
    password = "senha-de-teste-com-mais-de-12"

    def archive(self, path, data):
        payload = {"format": "direct-data-v1", "exportedAt": "2026-09-29T12:00:00Z", "tables": data}
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


if __name__ == "__main__":
    unittest.main()
