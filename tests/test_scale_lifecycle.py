import unittest,json
from uuid import uuid4
import test_server as fixtures
import server

class LifecycleTests(unittest.TestCase):
    setUp=fixtures.CadastroTest.setUp
    tearDown=fixtures.CadastroTest.tearDown
    call=fixtures.CadastroTest.call
    def prepare(self,future=False):
        day=(server.datetime.now(server.FORTALEZA).date()+__import__('datetime').timedelta(days=int(future))).isoformat()
        payload={'pedido':{'supermercado':'Hipermarket','unidade':'Vila União','setor':'FLV','quantidade_diaristas':1,'turnos':[{'data':day,'inicio':'00:00','fim':'23:59'}]},'diarista':{'nome':'Pessoa Original','cpf':'52998224725'},'confirmar_cadastro':True,'chave_operacao':str(uuid4())}
        status,first=self.call('POST','/api/leitura/pedido-escalado',payload);self.assertEqual(status,200,first)
        _,worker=self.call('POST','/api/diaristas',{'nome':'Pessoa Substituta','cpf':'11144477735'})
        return first,worker,self.call('GET','/api/escalas')[1][0]
    def test_withdrawal_preserves_confirmation_and_replacement_creates_no_payment(self):
        first,worker,old=self.prepare();route=f"/api/pedidos/{first['pedido_id']}/escalas/{old['id']}"
        self.assertEqual(self.call('PATCH',f"/api/operacao/escalas/{old['id']}",{'acao':'confirmacao','confirmacao':'confirmou'})[0],200)
        self.assertEqual(self.call('PATCH',route,{'status':'desistiu','motivo':'x'})[0],400)
        status,withdrawn=self.call('PATCH',route,{'status':'desistiu','motivo':'Desistiu por motivo pessoal'});self.assertEqual(status,200,withdrawn);self.assertEqual(withdrawn['confirmacao'],'confirmou');self.assertTrue(withdrawn['desistencia_em']);self.assertEqual(self.call('GET','/api/pedidos')[1][0]['situacao'],'em_selecao')
        self.assertEqual(self.call('DELETE',route)[0],409)
        self.assertEqual(self.call('PATCH',route,{'status':'presente'})[0],400)
        status,replacement=self.call('POST',route+'/substituir',{'diarista_id':worker['id'],'disponibilidade_confirmada':True});self.assertEqual(status,200,replacement)
        scales=self.call('GET','/api/escalas')[1];self.assertEqual(len(scales),2);self.assertEqual(scales[0]['substituida_por_escala_id'],replacement['id']);self.assertEqual(self.call('GET','/api/pedidos')[1][0]['situacao'],'confirmado')
        self.assertEqual(self.call('POST',route+'/substituir',{'diarista_id':worker['id'],'disponibilidade_confirmada':True})[0],200);self.assertEqual(len(self.call('GET','/api/escalas')[1]),2)
        with server.connect() as db:self.assertEqual(db.execute('select count(*) from diarias').fetchone()[0],0)
        new_route=f"/api/pedidos/{first['pedido_id']}/escalas/{replacement['id']}"
        self.assertEqual(self.call('PATCH',new_route,{'status':'presente'})[0],200)
        with server.connect() as db:self.assertEqual(db.execute('select count(*) from diarias').fetchone()[0],1)
        self.assertEqual(self.call('PATCH',new_route,{'status':'desistiu','motivo':'Não pode apagar atendimento'})[0],400)
    def test_failed_replacement_rolls_back_withdrawal_and_releases_conflict_only_when_saved(self):
        first,worker,old=self.prepare();route=f"/api/pedidos/{first['pedido_id']}/escalas/{old['id']}/substituir"
        status,_=self.call('POST',route,{'diarista_id':worker['id'],'motivo':'Troca solicitada pela pessoa'});self.assertEqual(status,400)
        self.assertEqual(self.call('GET','/api/escalas')[1][0]['status'],'escalada')
        self.call('PATCH',f"/api/diaristas/{worker['id']}/bloqueio",{'bloqueada':True})
        self.assertEqual(self.call('POST',route,{'diarista_id':worker['id'],'motivo':'Troca solicitada','disponibilidade_confirmada':True})[0],400)
        self.assertEqual(self.call('GET','/api/escalas')[1][0]['status'],'escalada')
    def test_existing_sqlite_migration_keeps_history_and_ids(self):
        first,worker,old=self.prepare()
        with server.connect() as db:
            definition=db.execute("select sql from sqlite_master where name='pedido_escalas'").fetchone()[0].replace("'falta', 'desistiu'","'falta'")
            objects=[r[0] for r in db.execute("select sql from sqlite_master where tbl_name='pedido_escalas' and type in ('index','trigger') and sql is not null")]
            definition=definition.replace('CREATE TABLE pedido_escalas','CREATE TABLE old_scales',1)
            db.execute('PRAGMA foreign_keys=OFF');db.execute(definition);db.execute('insert into old_scales select * from pedido_escalas');db.execute('drop table pedido_escalas');db.execute('alter table old_scales rename to pedido_escalas')
            for sql in objects:db.execute(sql)
        server.init_db()
        self.assertEqual(self.call('GET','/api/escalas')[1][0]['id'],old['id'])
        self.assertEqual(self.call('PATCH',f"/api/pedidos/{first['pedido_id']}/escalas/{old['id']}",{'status':'desistiu','motivo':'Migração preservou dados'})[0],200)
        with server.connect() as db:self.assertFalse(db.execute('pragma foreign_key_check').fetchall())

    def test_future_withdrawal_is_distinct_from_future_absence(self):
        first,worker,old=self.prepare(future=True);route=f"/api/pedidos/{first['pedido_id']}/escalas/{old['id']}"
        self.assertEqual(self.call('PATCH',route,{'status':'falta','motivo':'Ainda não aconteceu'})[0],400)
        self.assertEqual(self.call('PATCH',route,{'status':'presente'})[0],400)
        self.assertEqual(self.call('PATCH',route,{'status':'desistiu','motivo':'Desistiu antes do início'})[0],200)
        self.assertEqual(self.call('POST',route+'/substituir',{'diarista_id':worker['id'],'disponibilidade_confirmada':True})[0],200)
        self.assertEqual(self.call('GET',route)[0],404)  # no write operation through GET
