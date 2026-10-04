import json
import unittest
import test_server as fixtures
SAMPLE = fixtures.SAMPLE
import server
from payment_calendar import payment_due


class CalendarTests(unittest.TestCase):
    setUp = fixtures.CadastroTest.setUp
    tearDown = fixtures.CadastroTest.tearDown
    call = fixtures.CadastroTest.call

    def presence(self, network='Super do Povo', day='2026-09-29'):
        _, worker = self.call('POST', '/api/diaristas', {**SAMPLE, 'disponibilidade': [{'dia': 'terca', 'inicio': '00:00', 'fim': '23:59'}]})
        _, order = self.call('POST', '/api/pedidos', {'supermercado': network, 'unidade':'Meireles', 'setor':'FLV', 'quantidade_diaristas':1, 'turnos':[{'data':day,'inicio':'07:00','fim':'15:20'}]})
        status, scale = self.call('POST', f"/api/pedidos/{order['id']}/escalas", {'diarista_id':worker['id'],'data':day})
        self.assertEqual(status,201,scale)
        status, scale = self.call('PATCH', f"/api/pedidos/{order['id']}/escalas/{scale['id']}", {'status':'presente'})
        self.assertEqual(status,200,scale)
        return scale['diaria'], worker

    def test_boundaries(self):
        for day, first, second, expected in [('2026-09-15',20,5,'2026-09-20'),('2026-09-16',20,5,'2026-10-05'),('2026-02-15',30,15,'2026-02-28'),('2028-02-15',30,15,'2028-02-29'),('2026-12-31',20,5,'2027-01-05')]:
            self.assertEqual(payment_due(day,first,second),expected)
        self.assertIsNone(payment_due('2026-09-29',None,None))

    def test_presence_calendar_edit_manual_and_paid_history(self):
        daily, worker = self.presence()
        self.assertEqual(daily['vencimento_pagamento'],'2026-10-15')
        self.assertEqual(daily['vencimento_recebimento'],'2026-10-15')
        self.assertEqual(daily['vencimento_origem'],'calendario')
        network = next(r for r in self.call('GET','/api/tarifas')[1]['redes'] if r['rede']=='Super do Povo')
        route=f"/api/tarifas/redes/{network['id']}/calendario"
        status,_=self.call('PUT',route,{'pagamento_primeira_quinzena':30,'pagamento_segunda_quinzena':18})
        self.assertEqual(status,200)
        row=self.call('GET','/api/financeiro')[1][0]
        self.assertEqual(row['vencimento'],'2026-10-18')
        self.assertEqual(row['vencimento_recebimento'],'2026-10-18')
        pay=f"/api/diaristas/{worker['id']}/diarias/{daily['id']}/pagamento"
        self.assertEqual(self.call('PATCH',pay,{'vencimento_pagamento':'2026-10-22'})[0],200)
        self.call('PUT',route,{'pagamento_primeira_quinzena':30,'pagamento_segunda_quinzena':19})
        row=self.call('GET','/api/financeiro')[1][0]
        self.assertEqual(row['vencimento'],'2026-10-22')
        self.assertEqual(row['vencimento_origem'],'manual')
        self.assertEqual(self.call('PATCH',pay,{'data_pagamento':'2026-10-01','valor':'90.00'})[0],200)
        self.call('PUT',route,{'pagamento_primeira_quinzena':30,'pagamento_segunda_quinzena':20})
        self.assertEqual(self.call('GET','/api/financeiro')[1][0]['vencimento'],'2026-10-22')
        # Reinitialization must not undo a saved calendar.
        server.init_db()
        self.assertEqual(next(r for r in self.call('GET','/api/tarifas')[1]['redes'] if r['id']==network['id'])['pagamento_segunda_quinzena'],20)

    def test_unknown_calendar_is_not_overdue_and_manual_due_gate_remains(self):
        with server.connect() as db:
            db.execute("INSERT INTO tarifas_redes(rede,valor_recebido_centavos,valor_padrao_centavos,atualizado_em) VALUES ('Rede sem prazo',13400,9000,'2026-10-03')")
        daily,worker=self.presence('Rede sem prazo')
        self.assertIsNone(daily['vencimento_pagamento'])
        self.assertEqual(daily['vencimento_origem'],'nao_informado')
        pay=f"/api/diaristas/{worker['id']}/diarias/{daily['id']}/pagamento"
        self.assertEqual(self.call('PATCH',pay,{'valor':'85.00','vencimento_pagamento':None})[0],200)
        self.assertEqual(self.call('POST',f"/api/diaristas/{worker['id']}/diarias",{'data':'2026-09-28','local':'Manual','setor':'FLV','valor':'90.00'})[0],400)
        network=next(r for r in self.call('GET','/api/tarifas')[1]['redes'] if r['rede']=='Rede sem prazo')
        route=f"/api/tarifas/redes/{network['id']}/calendario"
        self.assertEqual(self.call('PUT',route,{'pagamento_primeira_quinzena':30,'pagamento_segunda_quinzena':None})[0],400)
        self.assertEqual(self.call('PUT',route,{'pagamento_primeira_quinzena':30,'pagamento_segunda_quinzena':15})[0],200)
        row=self.call('GET','/api/financeiro')[1][0]
        self.assertEqual(row['vencimento'],'2026-10-15')
        self.assertEqual(self.call('PUT',route,{'pagamento_primeira_quinzena':None,'pagamento_segunda_quinzena':None})[0],200)
        self.assertIsNone(self.call('GET','/api/financeiro')[1][0]['vencimento'])

    def test_weekly_boundaries_and_pending_manual_paid_history(self):
        for day in ('2026-09-28','2026-09-29','2026-10-04'):
            self.assertEqual(payment_due(day,None,None,6),'2026-10-10')
        self.assertEqual(payment_due('2026-10-05',None,None,6),'2026-10-17')
        self.assertEqual(payment_due('2026-12-31',None,None,6),'2027-01-09')
        self.assertEqual(payment_due('2028-02-29',None,None,6),'2028-03-11')
        daily,worker=self.presence('Pinheiro')
        self.assertEqual(daily['vencimento_pagamento'],'2026-10-10')
        self.assertEqual(daily['vencimento_recebimento'],'2026-10-10')
        rates=self.call('GET','/api/tarifas')[1]['redes']
        self.assertEqual(next(r for r in rates if r['rede']=='Variedades')['pagamento_semanal_dia'],6)
        network=next(r for r in rates if r['rede']=='Pinheiro')
        route=f"/api/tarifas/redes/{network['id']}/calendario"
        payload={'pagamento_primeira_quinzena':None,'pagamento_segunda_quinzena':None,'pagamento_semanal_dia':5}
        self.assertEqual(self.call('PUT',route,payload)[0],200)
        self.assertEqual(self.call('GET','/api/financeiro')[1][0]['vencimento'],'2026-10-09')
        self.assertEqual(self.call('PUT',route,{**payload,'pagamento_semanal_dia':7})[0],400)
        self.assertEqual(self.call('PUT',route,{**payload,'pagamento_primeira_quinzena':20,'pagamento_segunda_quinzena':5})[0],400)
        pay=f"/api/diaristas/{worker['id']}/diarias/{daily['id']}/pagamento"
        self.assertEqual(self.call('PATCH',pay,{'vencimento_pagamento':'2026-10-12'})[0],200)
        self.call('PUT',route,{**payload,'pagamento_semanal_dia':6})
        self.assertEqual(self.call('GET','/api/financeiro')[1][0]['vencimento'],'2026-10-12')
        self.assertEqual(self.call('PATCH',pay,{'data_pagamento':'2026-10-09','valor':'90.00'})[0],200)
        self.call('PUT',route,payload)
        self.assertEqual(self.call('GET','/api/financeiro')[1][0]['vencimento'],'2026-10-12')
        server.init_db()
        self.assertEqual(next(r for r in self.call('GET','/api/tarifas')[1]['redes'] if r['rede']=='Pinheiro')['pagamento_semanal_dia'],5)

if __name__=='__main__': unittest.main()
