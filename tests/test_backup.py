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
from restore_backup import TABLES, ALL_TABLES, restore, restore_operational


class BackupRestoreTests(unittest.TestCase):
    password = "senha-de-teste-com-mais-de-12"

    def archive(self, path, data, version="direct-data-v1"):
        payload = {"format": version, "exportedAt": "2026-09-29T12:00:00Z", "tables": data}
        if version in ("direct-data-v5", "direct-data-v6", "direct-data-v7", "direct-data-v8", "direct-data-v9"):
            payload["snapshot"] = {"consistent": True, "counts": {table: len(rows) for table, rows in data.items()}}
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

    def test_operational_restore_accepts_audit_without_author(self):
        import server
        previous_path=server.DB_PATH
        data={table:[] for table in ALL_TABLES}
        data['direct_auditoria']=[{'id':1,'tabela':'pedidos','registro_id':1,'operacao':'INSERT','email_autor':None,'alterado_em':'2026-10-04T12:00:00Z'}]
        try:
            with tempfile.TemporaryDirectory() as directory:
                archive,output=Path(directory)/'backup.json',Path(directory)/'restored.db'
                self.archive(archive,data,'direct-data-v7');restore_operational(archive,self.password,output)
                with sqlite3.connect(output) as db:self.assertEqual(db.execute('select email_autor from direct_auditoria').fetchone()[0],'')
        finally:server.DB_PATH=previous_path

    def test_v6_restores_models_and_store_instructions(self):
        import server
        previous_path = server.DB_PATH
        data = {table: [] for table in ALL_TABLES}
        data["pedido_modelos"] = [{"id": 1, "nome": "Modelo de teste", "dados": {"supermercado": "Super do Povo", "turnos": [{"data": "2030-12-31", "inicio": "07:00", "fim": "15:20"}]}, "criado_em": "2026-10-04", "atualizado_em": "2026-10-04"}]
        data["lojas"] = [{"id": 1, "rede": "Super do Povo", "nome": "Meireles", "endereco": "Rua Teste, 1", "cidade": "Fortaleza", "situacao": "confirmado", "entrada": "Porta lateral", "orientacoes": "FLV: encarregado", "criado_em": "2026-10-04", "atualizado_em": "2026-10-04"}]
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory); archive = root / "backup.json"; output = root / "restored.db"
                self.archive(archive, data, "direct-data-v6")
                counts = restore_operational(archive, self.password, output)
                self.assertEqual(len(counts), len(ALL_TABLES))
                self.assertEqual(counts["pedido_modelos"], 1)
                with sqlite3.connect(output) as db:
                    self.assertEqual(json.loads(db.execute("select dados from pedido_modelos").fetchone()[0])["turnos"][0]["inicio"], "07:00")
                    self.assertEqual(db.execute("select entrada from lojas").fetchone()[0], "Porta lateral")
        finally:
            server.DB_PATH = previous_path

    def test_v7_restores_store_review_relations_and_preserves_private_link(self):
        import server
        previous_path = server.DB_PATH
        data = {table: [] for table in ALL_TABLES}
        data['lojas'] = [{'id': 1, 'rede': 'Super do Povo', 'nome': 'Meireles', 'endereco': 'Rua Teste, 1', 'cidade': 'Fortaleza', 'situacao': 'confirmado', 'criado_em': '2026-10-04', 'atualizado_em': '2026-10-04'}]
        data['pedidos'] = [{'id': 1, 'supermercado': 'Super do Povo', 'unidade': 'Meireles', 'setor': 'FLV', 'quantidade_diaristas': 1, 'situacao': 'novo', 'turnos': [{'data': '2026-10-04', 'inicio': '07:00', 'fim': '15:20'}], 'criado_em': '2026-10-04', 'atualizado_em': '2026-10-04'}]
        data['diaristas'] = [{'id': 1, 'nome': 'Pessoa de teste', 'cpf': '11144477735', 'setores': [], 'disponibilidade': [], 'cep': '', 'logradouro': '', 'numero': '', 'bairro': '', 'cidade': 'Fortaleza', 'uf': 'CE', 'criado_em': '2026-10-04', 'atualizado_em': '2026-10-04'}]
        data['pedido_escalas'] = [{'id': 1, 'pedido_id': 1, 'diarista_id': 1, 'data': '2026-10-04', 'criado_em': '2026-10-04', 'atualizado_em': '2026-10-04'}]
        data['loja_solicitacoes'] = [{'id': 1, 'loja_id': 1, 'chave': '00000000-0000-0000-0000-000000000001', 'dados': {'setor': 'FLV'}, 'estado': 'aprovada', 'pedido_id': 1, 'criado_em': '2026-10-04', 'atualizado_em': '2026-10-04'}]
        data['loja_validacoes'] = [{'id': 1, 'loja_id': 1, 'escala_id': 1, 'presenca': 'presente', 'estado': 'pendente', 'criado_em': '2026-10-04', 'atualizado_em': '2026-10-04'}]
        data['loja_links'] = [{'id': 1, 'loja_id': 1, 'token': 'e' * 64, 'ativo': True, 'expira_em': '2027-01-02T00:00:00Z'}]
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory); archive = root / 'backup.json'; output = root / 'restored.db'
                self.archive(archive, data, 'direct-data-v7')
                counts = restore_operational(archive, self.password, output)
                self.assertEqual(len(counts), len(ALL_TABLES))
                with sqlite3.connect(output) as db:
                    self.assertEqual(db.execute('select pedido_id from loja_solicitacoes').fetchone()[0], 1)
                    self.assertEqual(db.execute('select escala_id,estado from loja_validacoes').fetchone(), (1, 'pendente'))
                    private = json.loads(db.execute("select record_json from backup_private_rows where source_table='loja_links'").fetchone()[0])
                    self.assertEqual(private['token'], 'e' * 64)
                    self.assertEqual(private['expira_em'], '2027-01-02T00:00:00Z')
                    self.assertEqual(db.execute('pragma foreign_key_check').fetchall(), [])
                data['pendencia_acoes']=[{'id':1,'chave':'pedido:1','area':'operacao','responsavel':'Equipe','proxima_acao':'Conferir resposta','atualizado_em':'2026-10-04'}]
                data['substituicao_contatos']=[{'id':1,'escala_id':1,'diarista_id':1,'resposta':'confirmou','datas':['2026-10-04'],'atualizado_em':'2026-10-04'}]
                v8=root/'v8.json';self.archive(v8,data,'direct-data-v8');restore_operational(v8,self.password,root/'v8.db')
                with sqlite3.connect(root/'v8.db') as db:
                    self.assertEqual(db.execute('select responsavel,proxima_acao from pendencia_acoes').fetchone(),('Equipe','Conferir resposta'))
                    self.assertEqual(json.loads(db.execute('select datas from substituicao_contatos').fetchone()[0]),['2026-10-04'])
                data['rede_links']=[{'id':1,'rede':'Super do Povo','token':'a'*64,'ativo':True,'expira_em':'2027-01-01T00:00:00Z'}]
                v9=root/'v9.json';self.archive(v9,data,'direct-data-v9');restore_operational(v9,self.password,root/'v9.db')
                with sqlite3.connect(root/'v9.db') as db:
                    record=json.loads(db.execute("select record_json from backup_private_rows where source_table='rede_links'").fetchone()[0])
                    self.assertEqual(record['rede'],'Super do Povo')
                broken = root / 'broken.json'; data['loja_validacoes'][0]['escala_id'] = 999
                self.archive(broken, data, 'direct-data-v7')
                with self.assertRaisesRegex(ValueError, 'referências quebradas'):
                    restore_operational(broken, self.password, root / 'broken.db')
                self.assertFalse((root / 'broken.db').exists())
        finally:
            server.DB_PATH = previous_path

    def test_v5_restores_private_portal_settings_and_links(self):
        import server
        previous_path = server.DB_PATH
        data = {table: [] for table in ALL_TABLES}
        data["portal_config"] = [{"id": True, "whatsapp": "5585999999999", "grupo_url": "https://chat.whatsapp.com/TestGroupExample"}]
        data["portal_vagas_link"] = [{"id": True, "token": "a" * 64, "ativo": True}]
        data["portal_convites"] = [{"id": "invite-test", "cadastro_hash": "\\xabcdef", "diarista_id": None}]
        data["direct_admins"] = [{"email": "admin@example.invalid"}]
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "backup.json"
                self.archive(archive, data, "direct-data-v5")
                for operational in (False, True):
                    output = root / ("operational.db" if operational else "records.db")
                    counts = (restore_operational if operational else restore)(archive, self.password, output)
                    self.assertEqual(counts["portal_config"], 1)
                    self.assertEqual(counts["portal_vagas_link"], 1)
                    self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                    with sqlite3.connect(output) as db:
                        table = "backup_private_rows" if operational else "backup_rows"
                        saved = json.loads(db.execute(f"SELECT record_json FROM {table} WHERE source_table='portal_vagas_link'").fetchone()[0])
                        self.assertEqual(saved["token"], "a" * 64)
        finally:
            server.DB_PATH = previous_path

    def test_v5_rejects_dangling_portal_registration(self):
        data = {table: [] for table in ALL_TABLES}
        data["portal_registros"] = [{"diarista_id": 999, "convite_id": "missing"}]
        with tempfile.TemporaryDirectory() as directory:
            archive, output = Path(directory) / "backup.json", Path(directory) / "restored.db"
            self.archive(archive, data, "direct-data-v5")
            with self.assertRaisesRegex(ValueError, "referências quebradas"):
                restore(archive, self.password, output)
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
                    db.execute("UPDATE diarias SET vencimento_pagamento='2026-10-15', vencimento_recebimento='2026-10-15', vencimento_origem='calendario' WHERE id=?", (daily_id,))
                    db.execute("UPDATE pedido_escalas SET disponibilidade_pedido_confirmada=1 WHERE id=?", (scale_id,))
                    db.execute("UPDATE tarifas_redes SET pagamento_segunda_quinzena=18 WHERE rede='Super do Povo'")
                    db.execute("UPDATE tarifas_redes SET pagamento_semanal_dia=5 WHERE rede='Pinheiro'")
                    contract_id=db.execute("INSERT INTO contratos(rede,loja,setor,inicio,valor_recebido_centavos,valor_pago_centavos,criado_em) VALUES('Super do Povo','Meireles','Operador de caixa','2026-09-01',13400,9000,'2026-09-29')").lastrowid
                    db.execute("UPDATE diarias SET contrato_id=? WHERE id=?",(contract_id,daily_id))
                    db.execute("INSERT INTO ocorrencias(pedido_id,escala_id,tipo,descricao,autor,criado_em) VALUES(?,?,'elogio','Atendimento bem avaliado','Teste','2026-09-29')",(order_id,scale_id))
                    db.execute("CREATE TABLE direct_staff (email TEXT PRIMARY KEY, role TEXT, active INTEGER)")
                    data = {table: [dict(row) for row in db.execute(f"SELECT * FROM {table}")] for table in TABLES}
                archive, target = root / "source.json", root / "recovered.db"
                self.archive(archive, data, "direct-data-v4")
                counts = restore_operational(archive, self.password, target)
                self.assertEqual(counts["diaristas"], 1)
                self.assertEqual(counts["cobranca_itens"], 1)
                self.assertEqual(counts["contratos"],1)
                self.assertEqual(counts["ocorrencias"],1)
                with sqlite3.connect(target) as db:
                    self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
                    self.assertEqual(db.execute("SELECT disponibilidade_pedido_confirmada FROM pedido_escalas WHERE id=?", (scale_id,)).fetchone()[0],1)
                    self.assertEqual(db.execute("SELECT count(*) FROM diarias WHERE pedido_escala_id = ?", (scale_id,)).fetchone()[0], 1)
                    self.assertEqual(db.execute("SELECT vencimento_pagamento,vencimento_recebimento,vencimento_origem FROM diarias").fetchone(), ('2026-10-15','2026-10-15','calendario'))
                    self.assertEqual(db.execute("SELECT pagamento_segunda_quinzena FROM tarifas_redes WHERE rede='Super do Povo'").fetchone()[0],18)
                    self.assertEqual(db.execute("SELECT pagamento_semanal_dia FROM tarifas_redes WHERE rede='Pinheiro'").fetchone()[0],5)
                self.assertEqual(server.finance_rows()[0]["valor_centavos"], 9000)
        finally:
            server.DB_PATH = previous_path


if __name__ == "__main__":
    unittest.main()
