import json,unittest
from datetime import timedelta
from unittest.mock import patch
import server,order_lifecycle as lifecycle
import test_server as fixtures
SAMPLE=fixtures.SAMPLE
class OrderLifecycleTest(unittest.TestCase):
    setUp=fixtures.CadastroTest.setUp;tearDown=fixtures.CadastroTest.tearDown;call=fixtures.CadastroTest.call
    def seed(self,pending=False):
        day=lifecycle.today();self.day=day;from datetime import date
        yesterday=(date.fromisoformat(day)-timedelta(days=1)).isoformat();self.past=yesterday
        _,w=self.call('POST','/api/diaristas',SAMPLE);self.worker=w['id']
        _,o=self.call('POST','/api/pedidos',dict(supermercado='Super do Povo',unidade='Loja fictícia',setor='Eventos',quantidade_diaristas=1,turnos=[dict(data=yesterday,inicio='07:00',fim='15:20')]))
        self.order=o['id'];_,s=self.call('POST',f'/api/pedidos/{o["id"]}/escalas',dict(diarista_id=w['id'],data=yesterday));self.scale=s['id']
        if not pending:self.call('PATCH',f'/api/pedidos/{self.order}/escalas/{self.scale}',dict(status='presente'))
    def closing(self):
        o=next(o for o in self.call('GET','/api/pedidos')[1] if o['id']==self.order);ss=self.call('GET',f'/api/pedidos/{self.order}/escalas')[1]
        return dict(expected_updated_at=o['atualizado_em'],expected_scales=lifecycle.versions(ss))
    def test_closing_preserves_daily_money_and_history(self):
        self.seed();_,before=self.call('GET',f'/api/diaristas/{self.worker}/diarias');p=self.closing();code,result=self.call('POST',f'/api/pedidos/{self.order}/encerrar',p);self.assertEqual(code,200,result);self.assertEqual(result['situacao'],'concluido');self.assertEqual(before,self.call('GET',f'/api/diaristas/{self.worker}/diarias')[1]);self.assertEqual(self.call('GET',f'/api/diaristas/{self.worker}/historico-escalas')[1][0]['status'],'presente');self.assertEqual(self.call('POST',f'/api/pedidos/{self.order}/encerrar',p)[0],200)
        self.assertEqual(self.call('PATCH',f'/api/pedidos/{self.order}/escalas/{self.scale}',dict(status='falta',motivo='Teste não deve alterar'))[0],400)
    def test_pending_blocks_close_stale_review_and_past_replacement(self):
        self.seed(True);p=self.closing();self.assertEqual(self.call('POST',f'/api/pedidos/{self.order}/encerrar',p)[0],400)
        self.call('PATCH',f'/api/pedidos/{self.order}/escalas/{self.scale}',dict(status='falta',motivo='Ausência realmente conferida'))
        self.assertEqual(self.call('POST',f'/api/pedidos/{self.order}/encerrar',p)[0],400)
        _,new=self.call('POST','/api/diaristas',{**SAMPLE,'nome':'Substituto fictício','cpf':'11144477735'})
        code,result=self.call('POST',f'/api/pedidos/{self.order}/escalas/{self.scale}/substituir',dict(diarista_id=new['id'],motivo='Não pode repor passado',disponibilidade_confirmada=True));self.assertEqual(code,400,result)
        self.assertEqual(self.call('POST',f'/api/pedidos/{self.order}/encerrar',self.closing())[0],200);self.assertEqual(self.call('GET',f'/api/diaristas/{self.worker}/historico-escalas')[1][0]['status'],'falta');self.assertEqual(self.call('GET',f'/api/diaristas/{self.worker}/diarias')[1],[])
    def test_current_and_calendar_cutoff(self):
        o=dict(id=1,situacao='em_selecao',quantidade_diaristas=1,turnos=[dict(data='2026-10-12'),dict(data='2026-10-13')]);rows=[dict(id=1,pedido_id=1,data='2026-10-12',status='falta'),dict(id=2,pedido_id=1,data='2026-10-13',status='escalada')]
        self.assertEqual(lifecycle.state(o,rows,'2026-10-13')['situacao'],'confirmado');self.assertFalse(lifecycle.state(o,rows,'2026-10-14')['encerravel']);rows[1]['status']='desistiu';self.assertTrue(lifecycle.state(o,rows,'2026-10-14')['encerravel'])
