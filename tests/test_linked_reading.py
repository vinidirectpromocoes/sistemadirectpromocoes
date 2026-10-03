import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from uuid import uuid4
import test_server as fixtures
import server

class LinkedReadingTests(unittest.TestCase):
    setUp=fixtures.CadastroTest.setUp
    tearDown=fixtures.CadastroTest.tearDown
    call=fixtures.CadastroTest.call
    def payload(self, **changes):
        return {'pedido':{'supermercado':'Hipermarket','unidade':'Vila União','setor':'Repositor de mercearia','quantidade_diaristas':1,'turnos':[{'data':'2026-10-03','inicio':'06:00','fim':'14:20'},{'data':'2026-10-04','inicio':'06:00','fim':'14:20'}]},'diarista':{'nome':'Fernando Ferreira Grangeiro','cpf':'04068775303'},'confirmar_cadastro':False,'chave_operacao':str(uuid4()),**changes}
    def save(self,p): return self.call('POST','/api/leitura/pedido-escalado',p)
    def counts(self):
        with server.connect() as db:
            return tuple(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in ('diaristas','pedidos','pedido_escalas','diarias'))
    def test_confirmation_basic_registration_assignment_and_retry(self):
        p=self.payload();future=datetime.now(ZoneInfo('America/Fortaleza')).date()+timedelta(days=14)
        for index,shift in enumerate(p['pedido']['turnos']): shift['data']=(future+timedelta(days=index)).isoformat()
        status,response=self.save(p);self.assertEqual(status,200,response);self.assertTrue(response['requires_registration']);self.assertEqual(self.counts(),(0,0,0,0))
        status,response=self.save({**p,'confirmar_cadastro':True});self.assertEqual(status,200,response);self.assertEqual(self.counts(),(1,1,2,0));self.assertTrue(response['cadastro_criado']);self.assertEqual(response['situacao'],'confirmado');self.assertEqual(self.call('GET','/api/pedidos')[1][0]['situacao'],'confirmado')
        worker=self.call('GET','/api/diaristas')[1][0];self.assertEqual(worker['disponibilidade'],[]);self.assertEqual(worker['setores'],[]);self.assertIsNone(worker['trabalhando']);self.assertIsNone(worker['pode_se_deslocar'])
        scales=self.call('GET',f"/api/pedidos/{response['pedido_id']}/escalas")[1];self.assertTrue(all(s['status']=='escalada' and s['disponibilidade_pedido_confirmada'] for s in scales))
        self.assertEqual(self.call('PATCH',f"/api/pedidos/{response['pedido_id']}/escalas/{scales[0]['id']}",{'status':'presente'})[0],400)
        status,retry=self.save(p);self.assertEqual(status,200,retry);self.assertFalse(retry['pedido_criado']);self.assertEqual(retry['situacao'],'confirmado');self.assertEqual(retry['escalas_criadas'],[]);self.assertEqual(self.counts(),(1,1,2,0))
        p['pedido']['turnos'][0]['inicio']='07:00';self.assertEqual(self.save(p)[0],400);self.assertEqual(self.counts(),(1,1,2,0))
    def test_existing_worker_preserved_and_conflict_rolls_back_all_new_days(self):
        self.call('POST','/api/diaristas',{'nome':'Fernando Ferreira Grangeiro','cpf':'04068775303','bairro':'Centro'})
        p=self.payload();status,first=self.save(p);self.assertEqual(status,200,first);self.assertFalse(first['cadastro_criado'])
        worker=self.call('GET','/api/diaristas')[1][0];self.assertEqual(worker['bairro'],'Centro');self.assertEqual(worker['disponibilidade'],[])
        p=self.payload();p['pedido']['turnos']=[{'data':'2026-10-02','inicio':'06:00','fim':'14:20'},{'data':'2026-10-03','inicio':'06:00','fim':'14:20'}]
        before=self.counts();status,error=self.save(p);self.assertEqual(status,400,error);self.assertIn('outro pedido',error['erro']);self.assertEqual(self.counts(),before)
    def test_full_order_does_not_create_orphan_worker_and_identity_is_checked(self):
        p=self.payload(diarista={'nome':'Pessoa Existente','cpf':'52998224725'},confirmar_cadastro=True);_,first=self.save(p)
        p=self.payload(confirmar_cadastro=True,pedido_id=first['pedido_id']);before=self.counts();self.assertEqual(self.save(p)[0],400);self.assertEqual(self.counts(),before)
        p=self.payload(diarista={'nome':'Nome errado','cpf':'52998224725'});self.assertEqual(self.save(p)[0],400)
        self.call('PATCH',f"/api/diaristas/{first['diarista_id']}/bloqueio",{'bloqueada':True})
        p=self.payload(diarista={'nome':'Pessoa Existente','cpf':'52998224725'});self.assertEqual(self.save(p)[0],400)
    def test_partial_staffing_stays_in_selection_and_last_worker_confirms(self):
        p=self.payload(confirmar_cadastro=True);p['pedido']['quantidade_diaristas']=2
        _,first=self.save(p);self.assertEqual(first['situacao'],'em_selecao')
        second={**p,'chave_operacao':str(uuid4()),'pedido_id':first['pedido_id'],'diarista':{'nome':'Segunda Pessoa','cpf':'52998224725'}}
        status,saved=self.save(second);self.assertEqual(status,200,saved);self.assertEqual(saved['situacao'],'confirmado');self.assertEqual(self.counts(),(2,1,4,0))
    def test_invalid_identity_or_store_never_creates_records(self):
        p=self.payload(confirmar_cadastro=True);p['diarista']['cpf']='11111111111';self.assertEqual(self.save(p)[0],400)
        p=self.payload(confirmar_cadastro=True);p['pedido']['unidade']='Inexistente';self.assertEqual(self.save(p)[0],400);self.assertEqual(self.counts(),(0,0,0,0))

if __name__=='__main__': unittest.main()
