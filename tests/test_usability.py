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
    def test_sector_correction_preserves_scales_paid_history_and_version(self):
        w=self.worker('52998224725','Pessoa Correção Setor');day=datetime.now(server.FORTALEZA).date()
        p={'supermercado':'Super do Povo','unidade':'Meireles','setor':'frios ( dois)','quantidade_diaristas':1,'turnos':[{'data':(day+timedelta(days=i)).isoformat(),'inicio':'07:00','fim':'15:20'} for i in range(7)]}
        _,o=self.call('POST','/api/pedidos',p)
        self.assertEqual(self.call('POST',f"/api/pedidos/{o['id']}/escalas",{'datas':[s['data'] for s in p['turnos']],'diarista_id':w['id']})[0],201)
        route=f"/api/pedidos/{o['id']}";scales=self.call('GET',route+'/escalas')[1]
        self.assertEqual(self.call('PATCH',route+f"/escalas/{scales[0]['id']}",{'status':'presente'})[0],200)
        daily=self.call('GET',route+'/escalas')[1][0]['diaria']
        payment=f"/api/diaristas/{w['id']}/diarias/{daily['id']}/pagamento"
        self.assertEqual(self.call('PATCH',payment,{'data_pagamento':day.isoformat(),'forma_pagamento':'Pix'})[0],200)
        before=self.call('GET',route+'/escalas')[1];money_before=self.call('GET','/api/financeiro')[1]
        current=next(x for x in self.call('GET','/api/pedidos')[1] if x['id']==o['id'])
        correction={**p,'setor':'Balconista de frios','expected_updated_at':current['atualizado_em']}
        code,saved=self.call('PUT',route,correction);self.assertEqual(code,200,saved);self.assertEqual(saved['setor'],'Balconista de frios');self.assertEqual(saved['turnos'],p['turnos'])
        self.assertEqual(self.call('GET',route+'/escalas')[1],before);self.assertEqual(self.call('GET','/api/financeiro')[1],money_before)
        self.assertEqual(self.call('PUT',route,correction)[0],409)
        for change in [{'quantidade_diaristas':2},{'unidade':'Outra loja'},{'supermercado':'Hipermarket'},{'turnos':[dict(p['turnos'][0],inicio='06:00')]}]:
            self.assertEqual(self.call('PUT',route,{**p,'setor':'Balconista de frios',**change})[0],400)
    def test_pending_cas_and_invalid_deadline(self):
        w=self.worker('52998224725','Pessoa Organização');p={'chave':f"cadastro:{w['id']}",'responsavel':'Operação','proxima_acao':'Completar telefone'}
        code,first=self.call('PUT','/api/pendencias-acoes',p);self.assertEqual(code,200,first)
        self.assertEqual(self.call('PUT','/api/pendencias-acoes',p)[0],409)
        p['expected_updated_at']=first['atualizado_em'];p['adiada_ate']=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat();code,second=self.call('PUT','/api/pendencias-acoes',p);self.assertEqual(code,200,second)
        p['expected_updated_at']=second['atualizado_em'];p['adiada_ate']=(datetime.now(timezone.utc)+timedelta(days=31)).isoformat();self.assertEqual(self.call('PUT','/api/pendencias-acoes',p)[0],400)
        self.assertEqual(len(self.call('GET','/api/pendencias-acoes')[1]),1)
    def test_delete_planned_order_is_atomic_preserves_worker_and_other_order(self):
        w=self.worker('52998224725','Pessoa Exclusão');day=datetime.now(server.FORTALEZA).date()
        p={'supermercado':'Super do Povo','unidade':'Meireles','setor':'Balconista de frios','quantidade_diaristas':1,'turnos':[{'data':(day+timedelta(days=i)).isoformat(),'inicio':'07:00','fim':'15:20'} for i in range(7)]}
        orders=[]
        for start,end in [('07:00','15:20'),('13:40','22:00')]:
            _,o=self.call('POST','/api/pedidos',{**p,'turnos':[dict(t,inicio=start,fim=end) for t in p['turnos']]});orders.append(o)
            self.assertEqual(self.call('POST',f"/api/pedidos/{o['id']}/escalas",{'datas':[t['data'] for t in p['turnos']],'diarista_id':w['id']})[0],201)
        route=f"/api/pedidos/{orders[0]['id']}";remaining=self.call('GET',f"/api/pedidos/{orders[1]['id']}/escalas")[1]
        self.assertEqual(self.call('DELETE',route,{'expected_updated_at':'2000-01-01'})[0],409);self.assertEqual(len(self.call('GET','/api/escalas')[1]),14)
        current=next(o for o in self.call('GET','/api/pedidos')[1] if o['id']==orders[0]['id'])
        code,result=self.call('DELETE',route,{'expected_updated_at':current['atualizado_em']});self.assertEqual(code,200,result);self.assertEqual(result['escalas_removidas'],7)
        self.assertEqual(self.call('GET',f"/api/pedidos/{orders[1]['id']}/escalas")[1],remaining);self.assertEqual(self.call('GET','/api/diaristas')[1],[w]);self.assertEqual(self.call('GET','/api/financeiro')[1],[]);self.assertEqual(self.call('DELETE',route)[0],404)
    def test_delete_executed_order_never_removes_planned_days_or_financial_history(self):
        w=self.worker('52998224725','Pessoa Histórico');day=datetime.now(server.FORTALEZA).date()
        p={'supermercado':'Super do Povo','unidade':'Meireles','setor':'Balconista de frios','quantidade_diaristas':1,'turnos':[{'data':(day+timedelta(days=i)).isoformat(),'inicio':'07:00','fim':'15:20'} for i in range(7)]}
        for state in ['presente','falta','desistiu']:
            _,o=self.call('POST','/api/pedidos',p);route=f"/api/pedidos/{o['id']}"
            self.call('POST',route+'/escalas',{'datas':[t['data'] for t in p['turnos']],'diarista_id':w['id']});s=self.call('GET',route+'/escalas')[1][0]
            code,result=self.call('PATCH',route+f"/escalas/{s['id']}",{'status':state,'motivo':'Registro real de histórico'});self.assertEqual(code,200,result)
            before=self.call('GET',route+'/escalas')[1];money=self.call('GET','/api/financeiro')[1]
            code,result=self.call('DELETE',route);self.assertEqual(code,409,result);self.assertIn('Cancele',result['erro']);self.assertEqual(self.call('GET',route+'/escalas')[1],before);self.assertEqual(self.call('GET','/api/financeiro')[1],money)
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
        # Cadastro bloqueado impede a troca inteira, sem alterar a escala original.
        self.call('PATCH',f"/api/diaristas/{new['id']}/bloqueio",{'bloqueada':True})
        code,result=self.call('POST',route,{'diarista_id':new['id'],'todos_restantes':True,'motivo':'Troca solicitada pela pessoa'});self.assertEqual(code,400,result)
        scales=self.call('GET',f"/api/pedidos/{o['id']}/escalas")[1];self.assertEqual(len(scales),3);self.assertTrue(all(s['status']=='escalada' for s in scales))
        self.call('PATCH',f"/api/diaristas/{new['id']}/bloqueio",{'bloqueada':False})
        _,other=self.call('POST','/api/pedidos',{**p,'turnos':[p['turnos'][2]]});self.call('POST',f"/api/pedidos/{other['id']}/escalas",{'data':dates[2],'diarista_id':new['id']})
        code,result=self.call('POST',route,{'diarista_id':new['id'],'todos_restantes':True,'disponibilidade_confirmada':True,'motivo':'Troca solicitada pela pessoa'});self.assertEqual(code,200,result);self.assertEqual(len(result),3)
        scales=self.call('GET',f"/api/pedidos/{o['id']}/escalas")[1];self.assertEqual(sum(s['status']=='desistiu' for s in scales),3);self.assertTrue(all(s['substituida_por_escala_id'] for s in scales if s['diarista_id']==old['id']))
        with server.connect() as db:self.assertEqual(db.execute('select count(*) from diarias').fetchone()[0],0)
