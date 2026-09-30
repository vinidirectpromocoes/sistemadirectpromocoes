import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


SAMPLE = {
    "nome": "Maria de Teste",
    "cpf": "529.982.247-25",
    "setores": ["Eventos", "Limpeza"],
    "cep": "60000-000",
    "logradouro": "Rua Exemplo",
    "numero": "10",
    "complemento": "",
    "bairro": "Centro",
    "trabalhando": True,
    "local_trabalho": "Empresa Exemplo",
    "disponibilidade": [{"dia": "segunda", "inicio": "08:00", "fim": "17:00"}],
    "pode_se_deslocar": True,
    "transporte": "Transporte público",
    "observacoes_locomocao": "",
}


class CadastroTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        server.DB_PATH = Path(self.temp.name) / "diaristas.db"
        server.init_db()
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.PORT = self.http.server_port
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{server.PORT}"

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temp.cleanup()

    def call(self, method, path, data=None):
        body = json.dumps(data).encode() if data is not None else None
        request = Request(self.base + path, data=body, method=method, headers={"Content-Type": "application/json"})
        try:
            with urlopen(request) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_create_edit_list_delete_and_persistence(self):
        status, created = self.call("POST", "/api/diaristas", SAMPLE)
        self.assertEqual(status, 201)
        self.assertEqual(created["cpf"], "52998224725")
        self.assertEqual(created["setores"], ["Eventos", "Limpeza"])
        self.assertEqual((created["cidade"], created["uf"]), ("Fortaleza", "CE"))
        status, duplicate = self.call("POST", "/api/diaristas", SAMPLE)
        self.assertEqual(status, 409)
        self.assertIn("já está cadastrado", duplicate["erro"])
        status, rows = self.call("GET", "/api/diaristas")
        self.assertEqual(status, 200)
        self.assertEqual(len(rows), 1)
        updated = {**SAMPLE, "nome": "Maria Atualizada", "trabalhando": False, "local_trabalho": ""}
        status, row = self.call("PUT", f"/api/diaristas/{created['id']}", updated)
        self.assertEqual(status, 200)
        self.assertEqual(row["nome"], "Maria Atualizada")
        self.assertFalse(row["trabalhando"])
        with server.connect() as db:
            saved = db.execute("SELECT nome FROM diaristas WHERE id = ?", (created["id"],)).fetchone()
        self.assertEqual(saved["nome"], "Maria Atualizada")
        status, result = self.call("DELETE", f"/api/diaristas/{created['id']}")
        self.assertEqual(status, 200)
        self.assertTrue(result["ok"])
        self.assertEqual(self.call("GET", "/api/diaristas")[1], [])

    def test_invalid_cpf_and_schedule_are_rejected(self):
        bad_cpf = {**SAMPLE, "cpf": "111.111.111-11"}
        status, _ = self.call("POST", "/api/diaristas", bad_cpf)
        self.assertEqual(status, 400)
        bad_schedule = {**SAMPLE, "disponibilidade": [{"dia": "segunda", "inicio": "18:00", "fim": "08:00"}]}
        status, _ = self.call("POST", "/api/diaristas", bad_schedule)
        self.assertEqual(status, 400)
        self.assertEqual(self.call("GET", "/api/diaristas")[1], [])

    def test_brand_assets_are_served(self):
        for path, content_type in [
            ("/brand.css", "text/css; charset=utf-8"),
            ("/finance.js", "text/javascript; charset=utf-8"),
            ("/forecast.js", "text/javascript; charset=utf-8"),
            ("/operations.js", "text/javascript; charset=utf-8"),
            ("/workflow.js", "text/javascript; charset=utf-8"),
            ("/matching.js", "text/javascript; charset=utf-8"),
            ("/workflow.css", "text/css; charset=utf-8"),
            ("/backup.js", "text/javascript; charset=utf-8"),
            ("/operations.css", "text/css; charset=utf-8"),
            ("/orders.js", "text/javascript; charset=utf-8"),
            ("/stores.js", "text/javascript; charset=utf-8"),
            ("/stores.css", "text/css; charset=utf-8"),
            ("/settings.js", "text/javascript; charset=utf-8"),
            ("/settings.css", "text/css; charset=utf-8"),
            ("/reading.js", "text/javascript; charset=utf-8"),
            ("/reading-parser.js", "text/javascript; charset=utf-8"),
            ("/reading.css", "text/css; charset=utf-8"),
            ("/logo-direct-promocoes.jpg", "image/jpeg"),
            ("/favicon.svg", "image/svg+xml"),
        ]:
            with self.subTest(path=path), urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Content-Type"], content_type)
                self.assertTrue(response.read())

    def test_invoice_tracks_confirmed_days_partial_receipts_and_absence(self):
        _, worker = self.call("POST", "/api/diaristas", SAMPLE)
        scales = []
        for day in ("2026-09-21", "2026-09-28"):
            _, order = self.call("POST", "/api/pedidos", {
                "supermercado": "Super do Povo", "unidade": "Meireles", "setor": "Operador de caixa",
                "quantidade_diaristas": 1, "turnos": [{"data": day, "inicio": "08:00", "fim": "17:00"}],
                "situacao": "confirmado", "observacoes": "",
            })
            self.assertEqual(self.call("POST", f"/api/pedidos/{order['id']}/escalas", {"data": day, "diarista_id": worker["id"]})[0], 201)
            scale = self.call("GET", f"/api/pedidos/{order['id']}/escalas")[1][0]
            self.assertEqual(self.call("PATCH", f"/api/pedidos/{order['id']}/escalas/{scale['id']}", {"status": "presente"})[0], 200)
            scales.append((order, scale))
        payload = {"rede": "Super do Povo", "periodo_inicio": "2026-09-21", "periodo_fim": "2026-09-28",
                   "vencimento": "2026-10-10", "numero_nota": "TESTE-1"}
        status, invoice = self.call("POST", "/api/cobrancas", payload)
        self.assertEqual(status, 201)
        self.assertEqual(invoice["valor_centavos"], 26800)
        self.assertEqual(len(invoice["itens"]), 2)
        self.assertEqual(self.call("POST", "/api/cobrancas", payload)[0], 400)
        first_order, first_scale = scales[0]
        status, result = self.call("PATCH", f"/api/pedidos/{first_order['id']}/escalas/{first_scale['id']}", {"status": "falta", "motivo": "Não compareceu"})
        self.assertEqual(status, 400)
        self.assertIn("cobrança", result["erro"])
        invoice_id = invoice["id"]
        self.assertEqual(self.call("POST", f"/api/cobrancas/{invoice_id}/recebimentos", {"valor": "100.00", "data_recebimento": "2026-09-29", "forma": "Pix"})[0], 201)
        self.assertEqual(self.call("POST", f"/api/cobrancas/{invoice_id}/recebimentos", {"valor": "200.00", "data_recebimento": "2026-09-29"})[0], 400)
        invoices = self.call("GET", "/api/cobrancas")[1]
        self.assertEqual(invoices[0]["valor_recebido_centavos"], 10000)
        receipt_id = invoices[0]["recebimentos"][0]["id"]
        self.assertEqual(self.call("PATCH", f"/api/recebimentos/{receipt_id}/estornar", {"motivo": "Valor lançado por engano"})[0], 200)
        self.assertEqual(self.call("GET", "/api/cobrancas")[1][0]["valor_recebido_centavos"], 0)
        self.assertEqual(self.call("PATCH", f"/api/cobrancas/{invoice_id}/cancelar", {"motivo": "Corrigir presença registrada"})[0], 200)
        self.assertEqual(self.call("PATCH", f"/api/pedidos/{first_order['id']}/escalas/{first_scale['id']}", {"status": "falta", "motivo": "Não compareceu"})[0], 200)
        status, corrected = self.call("POST", "/api/cobrancas", payload)
        self.assertEqual(status, 201)
        self.assertEqual(corrected["valor_centavos"], 13400)
        self.assertEqual(len(corrected["itens"]), 1)

    def test_batch_payment_is_atomic_and_can_be_reopened(self):
        _, worker = self.call("POST", "/api/diaristas", SAMPLE)
        daily_ids = []
        for day in ("2026-09-21", "2026-09-28"):
            status, daily = self.call("POST", f"/api/diaristas/{worker['id']}/diarias", {
                "data": day, "local": "Loja de teste", "setor": "Eventos", "observacoes": "",
                "valor": "90.00", "vencimento_pagamento": "2026-10-05",
            })
            self.assertEqual(status, 201)
            daily_ids.append(daily["id"])
        payload = {"diarista_id": worker["id"], "diaria_ids": daily_ids, "data_pagamento": "2026-09-29", "forma": "Pix"}
        self.assertEqual(self.call("POST", "/api/pagamento-lotes", {**payload, "diaria_ids": [daily_ids[0], daily_ids[0]]})[0], 400)
        status, batch = self.call("POST", "/api/pagamento-lotes", payload)
        self.assertEqual(status, 201)
        self.assertEqual(batch["valor_centavos"], 18000)
        self.assertEqual(batch["quantidade"], 2)
        self.assertEqual(self.call("POST", "/api/pagamento-lotes", payload)[0], 400)
        self.assertEqual(self.call("PATCH", f"/api/diaristas/{worker['id']}/diarias/{daily_ids[0]}/pagamento", {"data_pagamento": None, "motivo_ajuste": "Correção de teste"})[0], 400)
        self.assertEqual(self.call("PATCH", f"/api/pagamento-lotes/{batch['id']}/reabrir", {"motivo": "Correção da data do pagamento"})[0], 200)
        history = self.call("GET", f"/api/diaristas/{worker['id']}/diarias")[1]
        self.assertTrue(all(row["data_pagamento"] is None and row["pagamento_lote_id"] is None for row in history))
        self.assertEqual(self.call("GET", "/api/pagamento-lotes")[1][0]["status"], "reaberto")

    def test_pending_reading_is_saved_once_and_can_be_resolved(self):
        reading = {"tipo": "diarista", "chave": "cpf:52998224725", "dados": {"nome": "Maria"},
                   "texto": "Nome Completo: Maria\nCPF: 529.982.247-25", "faltando": ["setor"], "avisos": []}
        status, saved = self.call("POST", "/api/leituras-pendentes", reading)
        self.assertEqual(status, 201)
        self.assertEqual(saved["dados"], {"nome": "Maria"})
        status, repeated = self.call("POST", "/api/leituras-pendentes", reading)
        self.assertEqual(status, 200)
        self.assertEqual(repeated["id"], saved["id"])
        status, rows = self.call("GET", "/api/leituras-pendentes")
        self.assertEqual(status, 200)
        self.assertEqual(len(rows), 1)
        server.init_db()
        self.assertEqual(len(self.call("GET", "/api/leituras-pendentes")[1]), 1)
        status, changed = self.call("PATCH", f"/api/leituras-pendentes/{saved['id']}", {"status": "resolvido"})
        self.assertEqual(status, 200)
        self.assertEqual(changed["status"], "resolvido")
        status, reopened = self.call("POST", "/api/leituras-pendentes", {**reading, "faltando": ["setor", "horário"]})
        self.assertEqual(status, 200)
        self.assertEqual(reopened["id"], saved["id"])
        self.assertEqual(reopened["status"], "pendente")
        self.assertEqual(reopened["faltando"], ["setor", "horário"])

    def test_network_and_sector_rates(self):
        status, data = self.call("GET", "/api/tarifas")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["redes"]), 6)
        rates = {row["rede"]: row for row in data["redes"]}
        self.assertEqual((rates["Hipermarket"]["valor_recebido_centavos"], rates["Hipermarket"]["valor_padrao_centavos"]), (12400, 8500))
        self.assertEqual((rates["Fazendinha"]["valor_recebido_centavos"], rates["Fazendinha"]["valor_padrao_centavos"]), (12900, 8500))
        self.assertEqual((rates["Super do Povo"]["valor_recebido_centavos"], rates["Super do Povo"]["valor_padrao_centavos"]), (13400, 9000))
        self.assertEqual(len(data["setores"]), 10)
        self.assertEqual({row["setor"] for row in data["setores"]}, set(server.SETORES_INICIAIS))
        self.assertTrue(all(row["rede"] is None and row["valor_pago_centavos"] is None for row in data["setores"]))
        general = next(row for row in data["setores"] if row["setor"] == "Operador de caixa")
        global_path = f"/api/tarifas/setores/{general['id']}"
        status, filled = self.call("PUT", global_path, {"rede": None, "setor": "Operador de caixa", "valor_pago": "95.00"})
        self.assertEqual(status, 200)
        self.assertEqual(filled["valor_pago_centavos"], 9500)
        self.assertEqual(self.call("PUT", global_path, {"rede": None, "setor": "Operador de caixa", "valor_pago": None})[1]["valor_pago_centavos"], None)
        self.assertEqual(self.call("POST", "/api/tarifas/setores", {"rede": None, "setor": "operador de caixa", "valor_pago": None})[0], 409)
        path = f"/api/tarifas/redes/{rates['Super do Povo']['id']}"
        self.assertEqual(self.call("PUT", path, {"valor_recebido": "0", "valor_padrao": "90"})[0], 400)
        status, updated = self.call("PUT", path, {"valor_recebido": "135.50", "valor_padrao": "92.00"})
        self.assertEqual(status, 200)
        self.assertEqual((updated["valor_recebido_centavos"], updated["valor_padrao_centavos"]), (13550, 9200))
        sector = {"rede": "Super do Povo", "setor": "Operador de caixa", "valor_pago": "96.50"}
        status, created = self.call("POST", "/api/tarifas/setores", sector)
        self.assertEqual(status, 201)
        self.assertEqual(created["valor_pago_centavos"], 9650)
        self.assertEqual(self.call("POST", "/api/tarifas/setores", {**sector, "setor": "operador de caixa"})[0], 409)
        self.assertEqual(self.call("POST", "/api/tarifas/setores", {**sector, "rede": "Rede desconhecida"})[0], 400)
        self.assertEqual(self.call("POST", "/api/tarifas/setores", {**sector, "valor_pago": "-1"})[0], 400)
        status, changed = self.call("PUT", f"/api/tarifas/setores/{created['id']}", {**sector, "valor_pago": "98.00"})
        self.assertEqual(status, 200)
        self.assertEqual(changed["valor_pago_centavos"], 9800)
        self.assertEqual(len(self.call("GET", "/api/tarifas")[1]["setores"]), 11)
        self.assertEqual(self.call("DELETE", f"/api/tarifas/setores/{created['id']}")[0], 200)
        self.assertEqual(len(self.call("GET", "/api/tarifas")[1]["setores"]), 10)
        self.assertEqual(self.call("DELETE", global_path)[0], 200)
        server.init_db()
        self.assertEqual(len(self.call("GET", "/api/tarifas")[1]["setores"]), 9)
        with server.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM direct_auditoria WHERE tabela LIKE 'tarifas_%'").fetchone()[0], 17)

    def test_blocking_and_daily_history(self):
        _, created = self.call("POST", "/api/diaristas", SAMPLE)
        record_id = created["id"]
        self.assertFalse(created["bloqueada"])
        status, blocked = self.call("PATCH", f"/api/diaristas/{record_id}/bloqueio", {"bloqueada": True})
        self.assertEqual(status, 200)
        self.assertTrue(blocked["bloqueada"])
        self.assertTrue(self.call("GET", "/api/diaristas")[1][0]["bloqueada"])
        invalid = {"data": "2026-02-30", "local": "Evento", "setor": "Promoção", "observacoes": ""}
        self.assertEqual(self.call("POST", f"/api/diaristas/{record_id}/diarias", invalid)[0], 400)
        daily = {"data": "2026-09-20", "local": "Centro de eventos", "setor": "Promoção", "observacoes": "Turno da manhã", "valor": "150.50", "vencimento_pagamento": "2026-09-25", "forma_pagamento": "Pix"}
        self.assertEqual(self.call("POST", f"/api/diaristas/{record_id}/diarias", daily)[0], 409)
        self.assertFalse(self.call("PATCH", f"/api/diaristas/{record_id}/bloqueio", {"bloqueada": False})[1]["bloqueada"])
        status, created_daily = self.call("POST", f"/api/diaristas/{record_id}/diarias", daily)
        self.assertEqual(status, 201)
        self.assertEqual(created_daily["local"], "Centro de eventos")
        self.assertIsNone(created_daily["data_pagamento"])
        self.assertEqual(created_daily["valor_centavos"], 15050)
        payment_path = f"/api/diaristas/{record_id}/diarias/{created_daily['id']}/pagamento"
        self.assertEqual(self.call("PATCH", payment_path, {"data_pagamento": "2026-02-30"})[0], 400)
        status, paid = self.call("PATCH", payment_path, {"data_pagamento": "2026-09-22"})
        self.assertEqual(status, 200)
        self.assertEqual(paid["data_pagamento"], "2026-09-22")
        self.assertEqual(paid["valor_centavos"], 15050)
        finance = self.call("GET", "/api/financeiro")[1]
        self.assertEqual(finance[0]["origem"], "diaria")
        self.assertEqual(finance[0]["contraparte"], "Maria de Teste")
        status, history = self.call("GET", f"/api/diaristas/{record_id}/diarias")
        self.assertEqual(status, 200)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["observacoes"], "Turno da manhã")
        self.assertEqual(history[0]["data_pagamento"], "2026-09-22")
        self.assertEqual(self.call("DELETE", f"/api/diaristas/{record_id}")[0], 409)
        self.assertEqual(self.call("DELETE", f"/api/diaristas/{record_id}/diarias/{created_daily['id']}")[0], 409)
        self.assertEqual(len(self.call("GET", "/api/financeiro")[1]), 1)
        self.assertEqual(self.call("PATCH", payment_path, {"data_pagamento": None})[0], 400)
        self.assertIsNone(self.call("PATCH", payment_path, {"data_pagamento": None, "motivo_ajuste": "Correção do teste"})[1]["data_pagamento"])
        self.assertEqual(self.call("DELETE", f"/api/diaristas/{record_id}/diarias/{created_daily['id']}")[0], 200)
        self.assertEqual(self.call("GET", f"/api/diaristas/{record_id}/diarias")[1], [])

    def test_payment_date_migration_keeps_existing_history(self):
        _, person = self.call("POST", "/api/diaristas", SAMPLE)
        with server.connect() as db:
            db.execute("DROP TABLE diarias")
            db.execute("""CREATE TABLE diarias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diarista_id INTEGER NOT NULL REFERENCES diaristas(id) ON DELETE CASCADE,
                data TEXT NOT NULL,
                local TEXT NOT NULL,
                setor TEXT NOT NULL,
                observacoes TEXT NOT NULL DEFAULT '',
                criado_em TEXT NOT NULL
            )""")
            db.execute("INSERT INTO diarias (diarista_id, data, local, setor, observacoes, criado_em) VALUES (?, ?, ?, ?, ?, ?)",
                       (person["id"], "2026-09-10", "Local antigo", "Eventos", "", "2026-09-10T12:00:00+00:00"))
        server.init_db()
        history = self.call("GET", f"/api/diaristas/{person['id']}/diarias")[1]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["local"], "Local antigo")
        self.assertIsNone(history[0]["data_pagamento"])
        self.assertIsNone(history[0]["valor_centavos"])

    def test_daily_payment_requires_amount_and_pending_due_date(self):
        _, person = self.call("POST", "/api/diaristas", SAMPLE)
        path = f"/api/diaristas/{person['id']}/diarias"
        daily = {"data": "2026-09-20", "local": "Loja teste", "setor": "Eventos"}
        self.assertEqual(self.call("POST", path, {**daily, "valor": "90.00"})[0], 400)
        self.assertEqual(self.call("POST", path, {**daily, "data_pagamento": "2026-09-21"})[0], 400)
        status, created = self.call("POST", path, {**daily, "valor": "90.00", "vencimento_pagamento": "2026-09-25"})
        self.assertEqual(status, 201)
        payment = f"{path}/{created['id']}/pagamento"
        self.assertEqual(self.call("PATCH", payment, {"vencimento_pagamento": None})[0], 400)
        self.assertEqual(self.call("PATCH", payment, {"valor": None, "data_pagamento": "2026-09-21"})[0], 400)

    def test_manual_finance_create_edit_and_delete(self):
        entry = {
            "tipo": "receita", "descricao": "Serviço de evento", "categoria": "Serviços",
            "contraparte": "Cliente Exemplo", "valor": "850,75", "vencimento": "2026-09-30",
            "data_pagamento": None, "forma_pagamento": "", "observacoes": "Pedido de teste",
        }
        self.assertEqual(self.call("POST", "/api/financeiro", {**entry, "valor": "0"})[0], 400)
        status, created = self.call("POST", "/api/financeiro", entry)
        self.assertEqual(status, 201)
        self.assertEqual(created["valor_centavos"], 85075)
        status, rows = self.call("GET", "/api/financeiro")
        self.assertEqual(status, 200)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["origem"], "manual")
        paid = {**entry, "data_pagamento": "2026-09-29", "forma_pagamento": "Pix"}
        status, updated = self.call("PUT", f"/api/financeiro/{created['id']}", paid)
        self.assertEqual(status, 200)
        self.assertEqual(updated["data_pagamento"], "2026-09-29")
        self.assertEqual(self.call("DELETE", f"/api/financeiro/{created['id']}")[0], 409)
        self.assertEqual(self.call("PUT", f"/api/financeiro/{created['id']}", {**entry, "motivo_ajuste": "Correção do teste"})[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/financeiro/{created['id']}")[0], 200)
        self.assertEqual(self.call("GET", "/api/financeiro")[1], [])
        audit = self.call("GET", "/api/auditoria")[1]
        self.assertEqual([row["operacao"] for row in audit[:4]], ["DELETE", "UPDATE", "UPDATE", "INSERT"])

    def test_supermarket_order_with_multiple_days(self):
        order = {
            "supermercado": "Mercado Exemplo", "unidade": "Loja Aldeota",
            "contato": "Gerente Teste", "setor": "Reposição",
            "quantidade_diaristas": 3, "situacao": "novo", "observacoes": "Chegar 15 minutos antes",
            "turnos": [
                {"data": "2026-10-05", "inicio": "08:00", "fim": "17:00"},
                {"data": "2026-10-03", "inicio": "09:00", "fim": "16:00"},
            ],
        }
        self.assertEqual(self.call("POST", "/api/pedidos", {**order, "quantidade_diaristas": 0})[0], 400)
        self.assertEqual(self.call("POST", "/api/pedidos", {**order, "turnos": [order["turnos"][0]] * 2})[0], 400)
        self.assertEqual(self.call("POST", "/api/pedidos", {**order, "turnos": [{"data": "2026-10-03", "inicio": "17:00", "fim": "08:00"}]})[0], 400)
        status, created = self.call("POST", "/api/pedidos", order)
        self.assertEqual(status, 201)
        self.assertEqual(created["quantidade_dias"], 2)
        self.assertEqual(created["total_diarias"], 6)
        self.assertEqual(created["turnos"][0]["data"], "2026-10-03")
        status, listed = self.call("GET", "/api/pedidos")
        self.assertEqual(status, 200)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["observacoes"], "Chegar 15 minutos antes")
        status, updated = self.call("PUT", f"/api/pedidos/{created['id']}", {**order, "situacao": "confirmado", "quantidade_diaristas": 4})
        self.assertEqual(status, 200)
        self.assertEqual(updated["situacao"], "confirmado")
        self.assertEqual(updated["total_diarias"], 8)
        self.assertEqual(self.call("DELETE", f"/api/pedidos/{created['id']}")[0], 200)
        self.assertEqual(self.call("GET", "/api/pedidos")[1], [])

    def test_scale_respects_availability_conflicts_and_attendance_date(self):
        _, worker = self.call("POST", "/api/diaristas", SAMPLE)
        today = datetime.now(server.FORTALEZA).date()
        next_monday = today + timedelta(days=(7 - today.weekday()))
        next_tuesday = next_monday + timedelta(days=1)

        def create_order(day, start, end):
            data = {
                "supermercado": "Mercado de teste", "unidade": "Centro", "contato": "",
                "setor": "Eventos", "quantidade_diaristas": 1, "situacao": "novo", "observacoes": "",
                "turnos": [{"data": day.isoformat(), "inicio": start, "fim": end}],
            }
            return self.call("POST", "/api/pedidos", data)[1]

        first = create_order(next_monday, "08:00", "12:00")
        overlapping = create_order(next_monday, "11:00", "16:00")
        unavailable = create_order(next_tuesday, "08:00", "12:00")
        assignment = {"diarista_id": worker["id"], "data": next_monday.isoformat()}
        status, scale = self.call("POST", f"/api/pedidos/{first['id']}/escalas", assignment)
        self.assertEqual(status, 201)
        self.assertEqual(self.call("POST", f"/api/pedidos/{overlapping['id']}/escalas", assignment)[0], 400)
        self.assertEqual(self.call("POST", f"/api/pedidos/{unavailable['id']}/escalas", {**assignment, "data": next_tuesday.isoformat()})[0], 400)
        path = f"/api/pedidos/{first['id']}/escalas/{scale['id']}"
        self.assertEqual(self.call("PATCH", path, {"status": "presente"})[0], 400)
        self.assertEqual(self.call("PATCH", path, {"status": "falta", "motivo": "Não compareceu"})[0], 400)

    def test_batch_assignment_is_atomic_when_one_day_is_full(self):
        _, worker = self.call("POST", "/api/diaristas", SAMPLE)
        _, other = self.call("POST", "/api/diaristas", {**SAMPLE, "nome": "Outra Pessoa de Teste", "cpf": "111.444.777-35"})
        today = datetime.now(server.FORTALEZA).date()
        first_monday = today + timedelta(days=(7 - today.weekday()))
        dates = [(first_monday + timedelta(weeks=index)).isoformat() for index in range(3)]
        _, order = self.call("POST", "/api/pedidos", {
            "supermercado": "Super do Povo", "unidade": "Meireles", "contato": "",
            "setor": "Operador de caixa", "quantidade_diaristas": 1,
            "situacao": "novo", "observacoes": "",
            "turnos": [{"data": day, "inicio": "08:00", "fim": "15:20"} for day in dates],
        })
        _, occupied = self.call("POST", f"/api/pedidos/{order['id']}/escalas", {"diarista_id": other["id"], "data": dates[1]})
        path = f"/api/pedidos/{order['id']}/escalas"
        status, _ = self.call("POST", path, {"diarista_id": worker["id"], "datas": dates})
        self.assertEqual(status, 400)
        self.assertEqual(len(self.call("GET", path)[1]), 1, "nenhuma data da tentativa pode ficar salva")
        self.assertEqual(self.call("DELETE", f"{path}/{occupied['id']}")[0], 200)
        status, saved = self.call("POST", path, {"diarista_id": worker["id"], "datas": dates})
        self.assertEqual(status, 201)
        self.assertEqual({row["data"] for row in saved}, set(dates))
        self.assertEqual(len(self.call("GET", path)[1]), 3)
        self.assertEqual(self.call("POST", path, {"diarista_id": worker["id"], "datas": dates})[0], 400)
        self.assertEqual(len(self.call("GET", path)[1]), 3)

    def test_attendance_freezes_network_rates_and_updates_finance(self):
        today = datetime.now(server.FORTALEZA).date()
        worker_data = {**SAMPLE, "disponibilidade": [{
            "dia": server.WEEKDAYS[today.weekday()], "inicio": "00:00", "fim": "23:59",
        }]}
        _, worker = self.call("POST", "/api/diaristas", worker_data)
        order_data = {
            "supermercado": "Super do Povo", "unidade": "Meireles", "contato": "",
            "setor": "Operador de caixa", "quantidade_diaristas": 1,
            "situacao": "confirmado", "observacoes": "",
            "turnos": [{"data": today.isoformat(), "inicio": "13:40", "fim": "22:00"}],
        }
        _, order = self.call("POST", "/api/pedidos", order_data)
        _, scale = self.call("POST", f"/api/pedidos/{order['id']}/escalas", {
            "diarista_id": worker["id"], "data": today.isoformat(),
        })
        path = f"/api/pedidos/{order['id']}/escalas/{scale['id']}"
        status, updated = self.call("PATCH", path, {"status": "presente"})
        self.assertEqual(status, 200)
        self.assertEqual(updated["diaria"]["valor_centavos"], 9000)
        self.assertEqual(updated["diaria"]["valor_recebido_centavos"], 13400)
        self.assertEqual(updated["diaria"]["vencimento_pagamento"], today.isoformat())
        self.assertEqual(self.call("GET", "/api/financeiro")[1][0]["valor_centavos"], 9000)
        network = next(row for row in self.call("GET", "/api/tarifas")[1]["redes"] if row["rede"] == "Super do Povo")
        self.assertEqual(self.call("PUT", f"/api/tarifas/redes/{network['id']}", {
            "valor_recebido": "150.00", "valor_padrao": "100.00",
        })[0], 200)
        frozen = self.call("GET", f"/api/pedidos/{order['id']}/escalas")[1][0]["diaria"]
        self.assertEqual((frozen["valor_centavos"], frozen["valor_recebido_centavos"]), (9000, 13400))
        self.assertEqual(self.call("PATCH", path, {"status": "falta"})[0], 400)
        self.assertEqual(self.call("PATCH", path, {"status": "falta", "motivo": "Não compareceu"})[0], 200)
        self.assertEqual(self.call("GET", "/api/financeiro")[1], [])
        _, replacement_worker = self.call("POST", "/api/diaristas", {**worker_data,
            "nome": "Substituta de Teste", "cpf": "111.444.777-35"})
        status, replacement = self.call("POST", f"/api/pedidos/{order['id']}/escalas", {
            "diarista_id": replacement_worker["id"], "data": today.isoformat()})
        self.assertEqual(status, 201)
        linked = next(item for item in self.call("GET", "/api/escalas")[1] if item["id"] == scale["id"])
        self.assertEqual(linked["substituida_por_escala_id"], replacement["id"])
        self.assertEqual(linked["falta_motivo"], "Não compareceu")
        self.assertTrue(linked["falta_confirmada_em"])

    def test_extra_costs_accept_zero_and_reject_invalid_values(self):
        rows = self.call("GET", "/api/custos-extras")[1]
        self.assertEqual(len(rows), 6)
        status, updated = self.call("PUT", "/api/custos-extras", {
            "rede": "Super do Povo", "transporte": "5,50", "taxas": "0.0", "outros": 0})
        self.assertEqual(status, 200)
        self.assertEqual((updated["transporte_centavos"], updated["taxas_centavos"], updated["outros_centavos"]), (550, 0, 0))
        self.assertEqual(self.call("PUT", "/api/custos-extras", {
            "rede": "Super do Povo", "transporte": "-1", "taxas": 0, "outros": 0})[0], 400)

    def test_store_catalog_seed_edit_and_persistence(self):
        status, stores = self.call("GET", "/api/lojas")
        self.assertEqual(status, 200)
        self.assertEqual(len(stores), 44)
        self.assertEqual({item["rede"] for item in stores}, {"Super do Povo", "Super Lagoa", "Fazendinha", "Hipermarket", "Pinheiro", "Variedades"})
        self.assertTrue(any(item["cidade"] == "Aquiraz" for item in stores))
        target = next(item for item in stores if item["rede"] == "Super Lagoa" and item["nome"] == "Cidade 2000")
        self.assertEqual(target["situacao"], "confirmado")
        payload = {key: target[key] for key in ("rede", "nome", "endereco", "bairro", "cidade", "fonte_url", "situacao", "observacao")}
        payload.update(endereco="Av. Central Oeste, 1001", situacao="confirmado", observacao="Conferido por telefone")
        status, saved = self.call("PUT", f"/api/lojas/{target['id']}", payload)
        self.assertEqual(status, 200)
        self.assertEqual(saved["endereco"], "Av. Central Oeste, 1001")
        server.init_db()
        persisted = next(item for item in self.call("GET", "/api/lojas")[1] if item["id"] == target["id"])
        self.assertEqual(persisted["situacao"], "confirmado")
        self.assertEqual(persisted["endereco"], "Av. Central Oeste, 1001")

    def test_new_store_and_validation(self):
        sample = {"rede": "Variedades", "nome": "Nova unidade", "endereco": "Rua Exemplo, 10", "bairro": "Centro", "cidade": "Caucaia", "fonte_url": "https://example.com", "situacao": "revisar", "observacao": "Conferir"}
        self.assertEqual(self.call("POST", "/api/lojas", {**sample, "rede": "Outra rede"})[0], 400)
        self.assertEqual(self.call("POST", "/api/lojas", {**sample, "fonte_url": "javascript:alert(1)"})[0], 400)
        status, created = self.call("POST", "/api/lojas", sample)
        self.assertEqual(status, 201)
        self.assertEqual(created["cidade"], "Caucaia")
        self.assertEqual(self.call("POST", "/api/lojas", sample)[0], 409)


if __name__ == "__main__":
    unittest.main()
