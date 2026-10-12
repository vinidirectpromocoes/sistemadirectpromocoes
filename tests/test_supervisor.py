import json,sys,unittest
from uuid import uuid4
from datetime import timedelta
import test_enterprise as fixture
import server,supervisor as s,enterprise as e
class SupervisorTest(unittest.TestCase):
    setUp=fixture.EnterpriseTest.setUp
    tearDown=fixture.EnterpriseTest.tearDown
    save=fixture.EnterpriseTest.save
    order=fixture.EnterpriseTest.order
    def prepare(self):
        order=self.order();self.db.commit()
        # Real linked presence with explicit original amounts, only in the fictional database.
        stamp=e.now();day=self.today
        sid=self.db.execute("INSERT INTO pedido_escalas(pedido_id,diarista_id,data,status,criado_em,atualizado_em) VALUES(?,?,?,'presente',?,?)",(order,self.worker,day,stamp,stamp)).lastrowid
        did=self.db.execute('INSERT INTO diarias(diarista_id,data,local,setor,valor_centavos,valor_recebido_centavos,pedido_escala_id,criado_em) VALUES(?,?,?,?,?,?,?,?)',(self.worker,day,'Super Lagoa','Eventos',10000,16000,sid,stamp)).lastrowid;self.db.commit();return order,did
    def move(self,kind,order,value):return s.save(self.db,dict(tipo=kind,pedido_id=order,diarista_id=self.worker,data=self.today,forma='Pix de teste',motivo='Movimento fictício',valor_centavos=value,chave=str(uuid4())),server)
    def test_net_cash_and_preserved_originals(self):
        order,did=self.prepare();before=dict(self.db.execute('SELECT * FROM diarias WHERE id=?',(did,)).fetchone());advance=self.move('adiantamento',order,3000);passage=self.move('passagem',order,2000);self.db.commit();plan=s.plan(self.db,self.worker,order);self.assertEqual(plan['saldo_centavos'],9000)
        self.assertEqual(plan['caixa_diarias'][str(did)],7000);p=dict(tipo='acerto',diarista_id=self.worker,pedido_id=order,data=self.today,forma='Pix de teste',conferencia=plan,chave=str(uuid4()));settled=s.save(self.db,p,server);self.db.commit()
        after=dict(self.db.execute('SELECT * FROM diarias WHERE id=?',(did,)).fetchone());self.assertEqual(after['valor_centavos'],before['valor_centavos']);self.assertEqual(after['valor_recebido_centavos'],before['valor_recebido_centavos']);self.assertIsNotNone(after['data_pagamento']);self.assertEqual(s.save(self.db,p,server)['id'],settled['id']);self.assertEqual(s.plan(self.db,self.worker,order)['saldo_centavos'],0)
        projection=server.finance_rows();cash=sum(r.get('caixa_centavos',r['valor_centavos']) for r in projection if r['tipo']=='despesa' and r['data_pagamento']);self.assertEqual(cash,12000)
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('UPDATE diarias SET data_pagamento=NULL WHERE id=?',(did,))
    def test_stale_double_payment_void_and_credit(self):
        order,did=self.prepare();plan=s.plan(self.db,self.worker,order);advance=self.move('adiantamento',order,13000)
        with self.assertRaises(ValueError):s.save(self.db,dict(tipo='acerto',diarista_id=self.worker,pedido_id=order,data=self.today,forma='Pix',conferencia=plan,chave=str(uuid4())),server)
        plan=s.plan(self.db,self.worker,order);self.assertEqual(plan['saldo_centavos'],0);self.assertEqual(plan['credito_remanescente_centavos'],3000)
        with self.assertRaises(ValueError):s.check_payment(self.db,self.worker,[did])
        void=s.save(self.db,dict(tipo='estorno',registro_id=advance['id'],motivo='Registro incorreto de teste',chave=str(uuid4())),server);self.assertEqual(s.plan(self.db,self.worker,order)['saldo_centavos'],10000)
        with self.assertRaises(ValueError):s.save(self.db,dict(tipo='estorno',registro_id=advance['id'],motivo='Repetido',chave=str(uuid4())),server)
    def test_snapshot_does_not_create_invoice_and_requires_current_source(self):
        order,did=self.prepare();p=dict(inicio=self.today,fim=self.today,rede='');preview=s.preview(self.db,p,server);self.assertEqual(preview['totais']['receita_centavos'],16000);self.assertEqual(preview['pendencias'],[]);before=self.db.execute('SELECT count(*) FROM cobrancas').fetchone()[0]
        closed=s.save(self.db,dict(tipo='fechamento',**p,assinatura=preview['assinatura'],observacoes='Pacote para conferência',chave=str(uuid4())),server);self.assertEqual(self.db.execute('SELECT count(*) FROM cobrancas').fetchone()[0],before)
        self.move('passagem',order,1000)
        with self.assertRaises(ValueError):s.save(self.db,dict(tipo='fechamento',**p,assinatura=preview['assinatura'],chave=str(uuid4())),server)
        self.assertEqual(json.loads(self.db.execute('SELECT dados FROM supervisor_registros WHERE id=?',(closed['id'],)).fetchone()[0])['totais']['passagens_centavos'],0)
    def test_validation_and_no_legacy_side_effects(self):
        order,did=self.prepare();initial=[tuple(r) for r in self.db.execute('SELECT * FROM diarias')]
        for value in [True,-1,1.5,None]:
            with self.assertRaises(ValueError):self.move('adiantamento',order,value)
        self.assertEqual(initial,[tuple(r) for r in self.db.execute('SELECT * FROM diarias')]);self.assertEqual(s.preview(self.db,dict(inicio=self.today,fim=(e.company_today()+timedelta(days=1)).isoformat(),rede=''),server)['pendencias'][-1],'O período inclui dias futuros; aguarde para concluir o fechamento.')
import sqlite3
