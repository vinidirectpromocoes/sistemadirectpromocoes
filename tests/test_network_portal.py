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
        ours,other,link=self.setup_link();token=link['token']
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

    def test_renew_revoke_and_expire(self):
        _,_,link=self.setup_link();old=link['token']
        new=self.call('POST','/api/redes-links',{'rede':'super do povo','acao':'renovar'})[1]
        self.assertNotEqual(old,new['token']);self.assertEqual(self.call('POST','/api/rede-portal/context',{'p_token':old})[0],400)
        self.call('POST','/api/redes-links',{'rede':'Super do Povo','acao':'revogar'})
        self.assertEqual(self.call('POST','/api/rede-portal/context',{'p_token':new['token']})[0],400)
        listed=self.call('GET','/api/redes-links')[1];self.assertIsNone(next(r for r in listed if r['rede']=='Super do Povo')['token'])
        self.assertIsNone(self.call('POST','/api/redes-links',{'rede':'Super do Povo'})[1]['token'])
        renewed=self.call('POST','/api/redes-links',{'rede':'Super do Povo','acao':'renovar'})[1]
        with server.connect() as db:db.execute("UPDATE rede_links SET expira_em='2000-01-01' WHERE token=?",(renewed['token'],))
        self.assertEqual(self.call('POST','/api/rede-portal/context',{'p_token':renewed['token']})[0],400)
        self.assertEqual(self.call('POST','/api/redes-links',{'rede':'Rede inexistente'})[0],400)

    def test_invalid_data_and_store_checks(self):
        ours,other,link=self.setup_link()
        args={'p_token':link['token'],'p_loja_id':ours[0]['id'],'p_dados':self.payload(),'p_chave':str(uuid.uuid4())}
        args['p_dados']['quantidade_diaristas']=0;self.assertEqual(self.call('POST','/api/rede-portal/submit',args)[0],400)
        args['p_dados']=self.payload();args['p_dados']['setor']='Setor inexistente';self.assertEqual(self.call('POST','/api/rede-portal/submit',args)[0],400)
        self.assertEqual(self.call('POST','/api/rede-portal/check',{'p_token':link['token'],'p_loja_id':other['id'],'p_escala_id':1,'p_presenca':'presente'})[0],400)
