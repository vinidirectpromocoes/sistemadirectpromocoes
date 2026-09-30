import unittest
import uuid
from datetime import datetime, timedelta
import server
import test_server as fixtures
SAMPLE = fixtures.SAMPLE

class ExtendedTests(unittest.TestCase):
    setUp = fixtures.CadastroTest.setUp
    tearDown = fixtures.CadastroTest.tearDown
    call = fixtures.CadastroTest.call

    def fixtures(self):
        self.day = (datetime.now(server.FORTALEZA).date()-timedelta(days=1)).isoformat()
        _, self.worker = self.call('POST','/api/diaristas',{**SAMPLE, 'disponibilidade':[{'dia':d,'inicio':'00:00','fim':'23:59'} for d in ['segunda','terca','quarta','quinta','sexta','sabado','domingo']]})
        self.order_data={'supermercado':'Super do Povo','unidade':'Meireles','setor':'Operador de caixa','quantidade_diaristas':1,'turnos':[{'data':self.day,'inicio':'07:00','fim':'15:20'}]}
        _, self.order=self.call('POST','/api/pedidos',self.order_data)
        _, self.scale=self.call('POST',f"/api/pedidos/{self.order['id']}/escalas",{'diarista_id':self.worker['id'],'data':self.day})

    def test_confirmation_validation_and_reversal(self):
        self.fixtures(); route=f"/api/operacao/escalas/{self.scale['id']}"
        code,s=self.call('PATCH',route,{'acao':'confirmacao','confirmacao':'confirmou'})
        self.assertEqual(code,200); self.assertTrue(s['confirmacao_em']);self.assertEqual(s['confirmacao_por'],'Servidor local')
        valid={'acao':'validacao','loja_validacao':'validado','loja_responsavel':'Ana da loja','chegada_em':self.day+'T07:05:00-03:00','saida_em':self.day+'T15:20:00-03:00'}
        self.assertEqual(self.call('PATCH',route,valid)[0],400)
        scale_route=f"/api/pedidos/{self.order['id']}/escalas/{self.scale['id']}"
        self.assertEqual(self.call('PATCH',scale_route,{'status':'presente'})[0],200)
        self.assertEqual(self.call('PATCH',route,{**valid,'saida_em':self.day+'T06:00:00-03:00'})[0],400)
        self.assertEqual(self.call('PATCH',route,valid)[0],200)
        self.assertEqual(self.call('PATCH',route,{'acao':'confirmacao','confirmacao':'recusou'})[0],400)
        code,s=self.call('PATCH',scale_route,{'status':'falta','motivo':'Não compareceu ao local'})
        self.assertEqual(code,200);self.assertEqual(s['loja_validacao'],'pendente');self.assertIsNone(s['chegada_em'])
        self.assertEqual(self.call('GET','/api/financeiro')[1],[])

    def test_contract_versions_snapshot_and_overlap_atomicity(self):
        self.fixtures();p={'rede':'Super do Povo','loja':'Meireles','setor':'Operador de caixa','inicio':self.day,'valor_recebido':'150.00','valor_pago':'95.00'}
        code,c=self.call('POST','/api/contratos',p);self.assertEqual(code,200)
        self.assertEqual(self.call('POST','/api/contratos',p)[0],400)
        self.call('PATCH',f"/api/pedidos/{self.order['id']}/escalas/{self.scale['id']}",{'status':'presente'})
        daily=self.call('GET','/api/financeiro')[1][0];self.assertEqual((daily['valor_centavos'],daily['valor_recebido_centavos'],daily['contrato_id']),(9500,15000,c['id']))
        tomorrow=(datetime.fromisoformat(self.day)+timedelta(days=1)).date().isoformat()
        code,new=self.call('POST','/api/contratos',{**p,'inicio':tomorrow,'valor_pago':'100','versao_anterior_id':c['id']})
        self.assertEqual(code,200);self.assertEqual(new['versao_anterior_id'],c['id'])
        self.assertEqual(self.call('GET','/api/financeiro')[1][0]['valor_centavos'],9500)
        rows=self.call('GET','/api/contratos')[1];self.assertEqual(next(x for x in rows if x['id']==c['id'])['fim'],self.day)
        self.assertEqual(self.call('POST','/api/contratos',{**p,'inicio':tomorrow,'versao_anterior_id':c['id']})[0],400)
        self.assertEqual(self.call('GET','/api/contratos')[1],rows)

    def test_occurrence_links_immutable_resolution_and_history(self):
        self.fixtures();p={'pedido_id':self.order['id'],'escala_id':self.scale['id'],'tipo':'elogio','descricao':'Bom atendimento registrado'}
        self.assertEqual(self.call('POST','/api/ocorrencias',{**p,'pedido_id':999})[0],400)
        code,o=self.call('POST','/api/ocorrencias',p);self.assertEqual(code,200)
        self.assertEqual(self.call('DELETE',f"/api/pedidos/{self.order['id']}")[0],409)
        self.assertEqual(self.call('PATCH',f"/api/ocorrencias/{o['id']}",{'resolucao':'Comunicado à equipe'})[0],200)
        self.assertEqual(self.call('PATCH',f"/api/ocorrencias/{o['id']}",{'resolucao':'Nova resolução indevida'})[0],400)
        self.assertEqual(self.call('GET','/api/ocorrencias')[1][0]['descricao'],p['descricao'])

    def test_reserve_phone_and_invoice_contestation_keeps_amount(self):
        self.fixtures();route=f"/api/operacao/diaristas/{self.worker['id']}"
        self.assertEqual(self.call('PATCH',route,{'telefone':'123','reserva':True})[0],400)
        code,w=self.call('PATCH',route,{'telefone':'(85) 99999-1234','reserva':True})
        self.assertEqual(code,200);self.assertEqual(w['telefone'],'85999991234');self.assertTrue(w['disponibilidade_confirmada_em'])
        self.call('PATCH',f"/api/pedidos/{self.order['id']}/escalas/{self.scale['id']}",{'status':'presente'})
        code,invoice=self.call('POST','/api/cobrancas',{'rede':'Super do Povo','periodo_inicio':self.day,'periodo_fim':self.day,'vencimento':self.day,'numero_nota':'QA'})
        self.assertEqual(code,201)
        review=f"/api/operacao/cobrancas/{invoice['id']}"
        self.assertEqual(self.call('PATCH',review,{'conferencia':'contestada','responsavel':'Marcos','motivo':''})[0],400)
        self.assertEqual(self.call('PATCH',review,{'conferencia':'contestada','responsavel':'Marcos','motivo':'Loja solicitou conferir o horário'})[0],200)
        i=self.call('GET','/api/cobrancas')[1][0];self.assertEqual(i['conferencia'],'contestada');self.assertEqual(i['valor_centavos'],13400);self.assertEqual(i['valor_recebido_centavos'],0)

    def test_order_retry_key_is_idempotent_but_distinct_keys_are_orders(self):
        self.fixtures();p={**self.order_data,'chave_operacao':str(uuid.uuid4())}
        a=self.call('POST','/api/pedidos',p)[1];b=self.call('POST','/api/pedidos',p)[1];self.assertEqual(a['id'],b['id'])
        self.assertEqual(self.call('POST','/api/pedidos',{**p,'setor':'ASG'})[0],400)
        self.assertEqual(self.call('POST','/api/pedidos',{**p,'chave_operacao':'invalid-key'})[0],400)
        c=self.call('POST','/api/pedidos',{**p,'chave_operacao':str(uuid.uuid4())})[1];self.assertNotEqual(c['id'],a['id'])
        self.assertEqual(len(self.call('GET','/api/pedidos')[1]),3)
