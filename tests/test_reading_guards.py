import unittest
from datetime import datetime, timedelta
import server
import test_server as fixtures

class ReadingGuardsTest(unittest.TestCase):
    setUp = fixtures.CadastroTest.setUp
    tearDown = fixtures.CadastroTest.tearDown
    call = fixtures.CadastroTest.call

    def worker(self):
        status, worker = self.call('POST','/api/diaristas',{'nome':'Maria Diálogo Teste','cpf':'52998224725'})
        self.assertEqual(status,201,worker)
        return worker

    def test_payment_version_prevents_paid_value_overwrite(self):
        worker=self.worker()
        _,daily=self.call('POST',f"/api/diaristas/{worker['id']}/diarias",{'data':'2026-09-30','local':'Loja Teste','setor':'FLV','valor':'100','vencimento_pagamento':'2026-10-08'})
        keys=('data_pagamento','valor_centavos','vencimento_pagamento','forma_pagamento','pagamento_lote_id')
        expected={key:daily[key] for key in keys}
        route=f"/api/diaristas/{worker['id']}/diarias/{daily['id']}/pagamento"
        status,paid=self.call('PATCH',route,{'data_pagamento':'2026-10-08','valor':'100','vencimento_pagamento':'2026-10-08','forma_pagamento':'Pix','expected_payment':expected})
        self.assertEqual(status,200,paid)
        stale=self.call('PATCH',route,{'data_pagamento':'2026-10-08','valor':'200','forma_pagamento':'Dinheiro','motivo_ajuste':'Alteração concorrente de teste','expected_payment':expected})
        self.assertEqual(stale[0],409,stale)
        saved=self.call('GET',f"/api/diaristas/{worker['id']}/diarias")[1][0]
        self.assertEqual(saved['valor_centavos'],10000)
        self.assertEqual(saved['forma_pagamento'],'Pix')
        fresh={key:paid[key] for key in keys}
        self.assertEqual(self.call('PATCH',route,{'data_pagamento':None,'forma_pagamento':'','motivo_ajuste':'Pagamento lançado na pessoa errada','expected_payment':fresh})[0],200)

    def test_worker_block_and_delete_reject_stale_version(self):
        worker=self.worker();route=f"/api/diaristas/{worker['id']}"
        _,updated=self.call('PUT',route,{**worker,'telefone':'85999998888','expected_updated_at':worker['atualizado_em']})
        self.assertEqual(self.call('PATCH',route+'/bloqueio',{'bloqueada':True,'expected_updated_at':worker['atualizado_em']})[0],409)
        self.assertEqual(self.call('DELETE',route,{'expected_updated_at':worker['atualizado_em']})[0],409)
        status,blocked=self.call('PATCH',route+'/bloqueio',{'bloqueada':True,'expected_updated_at':updated['atualizado_em']})
        self.assertEqual(status,200,blocked)
        self.assertEqual(self.call('DELETE',route,{'expected_updated_at':blocked['atualizado_em']})[0],200)

    def test_assignment_explicit_availability_and_stale_attendance(self):
        worker=self.worker();today=datetime.now(server.FORTALEZA).date().isoformat()
        _,order=self.call('POST','/api/pedidos',{'supermercado':'Super Lagoa','unidade':'CD','setor':'FLV','quantidade_diaristas':1,'turnos':[{'data':today,'inicio':'07:00','fim':'15:20'}]})
        route=f"/api/pedidos/{order['id']}/escalas"
        status,rows=self.call('POST',route,{'diarista_id':worker['id'],'datas':[today],'disponibilidade_confirmada':True})
        self.assertEqual(status,201,rows);scale=rows[0]
        self.assertEqual(scale['disponibilidade_pedido_confirmada'],1)
        status,updated=self.call('PATCH',route+f"/{scale['id']}",{'status':'falta','motivo':'Avisou que estava doente','expected_updated_at':scale['atualizado_em']})
        self.assertEqual(status,200,updated)
        self.assertEqual(self.call('PATCH',route+f"/{scale['id']}",{'status':'presente','expected_updated_at':scale['atualizado_em']})[0],409)
        self.assertEqual(self.call('DELETE',route+f"/{scale['id']}",{'expected_updated_at':scale['atualizado_em']})[0],409)
        self.assertEqual(self.call('GET',f"/api/diaristas/{worker['id']}/diarias")[1],[])
