import unittest, json
from datetime import datetime,timezone,timedelta
import server, test_server as fixtures
class UsabilityTests(unittest.TestCase):
    setUp=fixtures.CadastroTest.setUp
    tearDown=fixtures.CadastroTest.tearDown
    call=fixtures.CadastroTest.call
    def worker(self,cpf,name):return self.call('POST','/api/diaristas',{'nome':name,'cpf':cpf,'setores':['FLV'],'pode_se_deslocar':True,'disponibilidade':[{'dia':d,'inicio':'00:00','fim':'23:59'} for d in server.DAYS]})[1]
    def test_search_accent_cpf_limits_and_no_cpf_leak(self):
        w=self.worker('52998224725','Pessoa João Pesquisa')
        for query in ['joao','529.982.247-25']:
            from urllib.parse import quote
            code,rows=self.call('GET','/api/busca?q='+quote(query));self.assertEqual(code,200);self.assertTrue(any(r['id']==w['id'] and r['kind']=='diarista' for r in rows));self.assertNotIn(w['cpf'],json.dumps(rows))
        self.assertEqual(self.call('GET','/api/busca?q=x')[1],[])
        self.assertEqual(self.call('GET','/api/busca?q='+'a'*121)[0],400)
        self.assertTrue(any(r['kind']=='loja' for r in self.call('GET','/api/busca?q=Meireles')[1]))
    def test_pending_cas_and_invalid_deadline(self):
        w=self.worker('52998224725','Pessoa Organização');p={'chave':f"cadastro:{w['id']}",'responsavel':'Operação','proxima_acao':'Completar telefone'}
        code,first=self.call('PUT','/api/pendencias-acoes',p);self.assertEqual(code,200,first)
        self.assertEqual(self.call('PUT','/api/pendencias-acoes',p)[0],409)
        p['expected_updated_at']=first['atualizado_em'];p['adiada_ate']=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat();code,second=self.call('PUT','/api/pendencias-acoes',p);self.assertEqual(code,200,second)
        p['expected_updated_at']=second['atualizado_em'];p['adiada_ate']=(datetime.now(timezone.utc)+timedelta(days=31)).isoformat();self.assertEqual(self.call('PUT','/api/pendencias-acoes',p)[0],400)
        self.assertEqual(len(self.call('GET','/api/pendencias-acoes')[1]),1)
    def test_whole_replacement_atomic_and_response_no_payment(self):
        old=self.worker('52998224725','Original');new=self.worker('11144477735','Substituta');dates=[(datetime.now(server.FORTALEZA).date()+timedelta(days=i)).isoformat() for i in range(3)]
        p={'supermercado':'Hipermarket','unidade':'Vila União','setor':'FLV','quantidade_diaristas':1,'turnos':[{'data':d,'inicio':'07:00','fim':'15:20'} for d in dates]}
        code,o=self.call('POST','/api/pedidos',p);self.assertEqual(code,201,o)
        self.assertEqual(self.call('POST',f"/api/pedidos/{o['id']}/escalas",{'datas':dates,'diarista_id':old['id'],'disponibilidade_confirmada':True})[0],201)
        scales=self.call('GET','/api/escalas')[1];route=f"/api/pedidos/{o['id']}/escalas/{scales[0]['id']}/substituir"
        code,response=self.call('POST','/api/substituicao-contatos',{'escala_id':scales[0]['id'],'diarista_id':new['id'],'resposta':'confirmou'});self.assertEqual(code,200,response)
        self.assertEqual(self.call('POST','/api/substituicao-contatos',{'escala_id':scales[0]['id'],'diarista_id':new['id'],'resposta':'recusou'})[0],409)
        self.assertEqual(self.call('POST','/api/substituicao-contatos',{'escala_id':scales[0]['id'],'diarista_id':new['id'],'resposta':'recusou','expected_updated_at':response['atualizado_em'],'datas':['2039-01-01']})[0],400)
        with server.connect() as db:self.assertEqual(db.execute('select count(*) from diarias').fetchone()[0],0)
        # Occupy the third date elsewhere; the first two replacements must also roll back.
        _,other=self.call('POST','/api/pedidos',{**p,'turnos':[p['turnos'][2]]});self.call('POST',f"/api/pedidos/{other['id']}/escalas",{'data':dates[2],'diarista_id':new['id'],'disponibilidade_confirmada':True})
        code,result=self.call('POST',route,{'diarista_id':new['id'],'todos_restantes':True,'disponibilidade_confirmada':True,'motivo':'Troca solicitada pela pessoa'});self.assertEqual(code,400,result)
        scales=self.call('GET',f"/api/pedidos/{o['id']}/escalas")[1];self.assertEqual(len(scales),3);self.assertTrue(all(s['status']=='escalada' for s in scales))
        other_scale=self.call('GET',f"/api/pedidos/{other['id']}/escalas")[1][0];self.call('DELETE',f"/api/pedidos/{other['id']}/escalas/{other_scale['id']}");self.call('DELETE',f"/api/pedidos/{other['id']}")
        code,result=self.call('POST',route,{'diarista_id':new['id'],'todos_restantes':True,'disponibilidade_confirmada':True,'motivo':'Troca solicitada pela pessoa'});self.assertEqual(code,200,result);self.assertEqual(len(result),3)
        scales=self.call('GET',f"/api/pedidos/{o['id']}/escalas")[1];self.assertEqual(sum(s['status']=='desistiu' for s in scales),3);self.assertTrue(all(s['substituida_por_escala_id'] for s in scales if s['diarista_id']==old['id']))
        with server.connect() as db:self.assertEqual(db.execute('select count(*) from diarias').fetchone()[0],0)
