import uuid
import unittest
from datetime import datetime
import server
import test_server as fixtures

class NetworkPortalTest(unittest.TestCase):
    setUp=fixtures.CadastroTest.setUp
    tearDown=fixtures.CadastroTest.tearDown
    call=fixtures.CadastroTest.call

    def setup_link(self):
        stores=self.call('GET','/api/lojas')[1]
        ours=[s for s in stores if s['rede']=='Super do Povo']
        other=next(s for s in stores if s['rede']=='Hipermarket')
        link=self.call('POST','/api/redes-links',{'rede':'Super do Povo'})[1]
        return ours,other,link

    def payload(self):
        return {'supermercado':'Hipermarket','unidade':'Loja falsificada','setor':'Repositor de FLV','quantidade_diaristas':2,'turnos':[{'data':datetime.now(server.FORTALEZA).date().isoformat(),'inicio':'07:00','fim':'15:20'}],'contato':'Responsável teste','observacoes':'Entrada principal'}

    def test_scope_and_idempotency(self):
        ours,other,link=self.setup_link();token=link['codigo']
        status,context=self.call('POST','/api/rede-portal/context',{'p_token':token})
        self.assertEqual(status,200);self.assertEqual(len(context['lojas']),len(ours));self.assertTrue(all(s['rede']=='Super do Povo' for s in context['lojas']))
        args={'p_token':token,'p_loja_id':other['id'],'p_dados':self.payload(),'p_chave':str(uuid.uuid4())}
        self.assertEqual(self.call('POST','/api/rede-portal/submit',args)[0],400)
        args['p_loja_id']=ours[0]['id'];status,result=self.call('POST','/api/rede-portal/submit',args)
        self.assertEqual(status,200,result);self.assertEqual(self.call('POST','/api/rede-portal/submit',args)[1]['id'],result['id'])
        requests=self.call('GET','/api/solicitacoes-lojas')[1];self.assertEqual(len(requests),1);self.assertEqual(requests[0]['dados']['supermercado'],'Super do Povo');self.assertEqual(requests[0]['dados']['unidade'],ours[0]['nome']);self.assertEqual(self.call('GET','/api/pedidos')[1],[])
        view=self.call('POST','/api/rede-portal/orders',{'p_token':token,'p_loja_id':ours[1]['id']})[1];self.assertEqual(view['solicitacoes'],[])
        self.assertEqual(self.call('POST','/api/rede-portal/orders',{'p_token':token,'p_loja_id':other['id']})[0],400)
        args['p_dados']['quantidade_diaristas']=3;self.assertEqual(self.call('POST','/api/rede-portal/submit',args)[0],400)

    def test_fixed_short_links_survive_expiry_refresh_and_upgrade(self):
        _,_,link=self.setup_link();code=link['codigo'];self.assertRegex(code,r'^[A-Za-z0-9_-]{16}$')
        for action in ('renovar','revogar'):
            self.assertEqual(self.call('POST','/api/redes-links',{'rede':'Super do Povo','acao':action})[0],400)
        for _ in range(2):
            listed=self.call('GET','/api/redes-links')[1]
            self.assertEqual(next(r for r in listed if r['rede']=='Super do Povo')['codigo'],code)
            self.assertEqual(self.call('POST','/api/redes-links',{'rede':'super do povo'})[1]['codigo'],code)
        with server.connect() as db:
            db.execute("UPDATE rede_links SET expira_em='2000-01-01' WHERE codigo=?",(code,))
            import store_portal
            store_portal.ensure_schema(db)
        for token in (code,link['token']):self.assertEqual(self.call('POST','/api/rede-portal/context',{'p_token':token})[0],200)
        with server.connect() as db:db.execute('UPDATE rede_links SET ativo=0 WHERE codigo=?',(code,))
        self.assertEqual(self.call('POST','/api/rede-portal/context',{'p_token':code})[0],200)
        self.assertEqual(self.call('POST','/api/rede-portal/context',{'p_token':link['token']})[0],400)
        self.assertEqual(self.call('POST','/api/redes-links',{'rede':'Rede inexistente'})[0],400)
        for token in ('invalid','a'*16,'a'*64):self.assertEqual(self.call('POST','/api/rede-portal/context',{'p_token':token})[0],400)

    def test_invalid_data_and_store_checks(self):
        ours,other,link=self.setup_link()
        args={'p_token':link['token'],'p_loja_id':ours[0]['id'],'p_dados':self.payload(),'p_chave':str(uuid.uuid4())}
        args['p_dados']['quantidade_diaristas']=0;self.assertEqual(self.call('POST','/api/rede-portal/submit',args)[0],400)
        args['p_dados']=self.payload();args['p_dados']['setor']='Setor inexistente';self.assertEqual(self.call('POST','/api/rede-portal/submit',args)[0],400)
        self.assertEqual(self.call('POST','/api/rede-portal/check',{'p_token':link['token'],'p_loja_id':other['id'],'p_escala_id':1,'p_presenca':'presente'})[0],400)
