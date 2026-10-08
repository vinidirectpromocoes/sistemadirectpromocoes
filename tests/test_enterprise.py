import json
import tempfile
import unittest
from pathlib import Path
from datetime import timedelta
from uuid import uuid4

import enterprise as e
import enterprise_actions as a
import server
from test_server import SAMPLE

class EnterpriseTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.oldpath=server.DB_PATH
        server.DB_PATH=Path(self.temp.name)/'qa.db';server.init_db();self.db=server.connect()
        data=server.validate(SAMPLE);stamp=e.now();self.worker=self.db.execute('INSERT INTO diaristas('+','.join(data)+',criado_em,atualizado_em) VALUES('+','.join('?' for _ in range(len(data)+2))+')',(*data.values(),stamp,stamp)).lastrowid
        self.store=self.db.execute('SELECT id FROM lojas LIMIT 1').fetchone()[0]
        self.native={'diarista':self.worker,'loja':self.store}
        self.client=self.save('cliente',{'segmento':'eventos'},'Cliente de teste')
        self.parents={'cliente':self.client};self.today=e.company_today().isoformat()
        self.db.commit()

    def tearDown(self):
        self.db.close();server.DB_PATH=self.oldpath;self.temp.cleanup()

    def save(self,kind,data,title=None,state=None,record=None,role='admin',key=None):
        payload=dict(tipo=kind,titulo=title or kind,status=state or e.ENTITIES[kind]['statuses'][0],dados=data,chave=key or str(uuid4()))
        if record:payload.update(id=record['id'],versao=record['versao'])
        return e.save(self.db,payload,role)

    def order(self):
        s=self.db.execute('SELECT * FROM lojas WHERE id=?',(self.store,)).fetchone()
        data=server.validate_order(dict(supermercado=s['rede'],unidade=s['nome'],setor='Eventos',quantidade_diaristas=1,turnos=[dict(data=self.today,inicio='07:00',fim='15:20')]))
        return self.db.execute('INSERT INTO pedidos('+','.join(data)+',criado_em,atualizado_em) VALUES('+','.join('?' for _ in range(len(data)+2))+')',(*data.values(),e.now(),e.now())).lastrowid

    def default(self,kind):
        if kind in self.parents:return self.parents[kind]
        if kind in self.native:return {'id':self.native[kind]}
        if kind=='pedido':self.native[kind]=self.order();return {'id':self.native[kind]}
        if kind=='cobranca':
            self.native[kind]=self.db.execute("INSERT INTO cobrancas(rede,periodo_inicio,periodo_fim,vencimento,valor_centavos,criado_em,atualizado_em) VALUES('Super Lagoa',?,?,?,?,?,?)",(self.today,self.today,self.today,10000,e.now(),e.now())).lastrowid;return {'id':self.native[kind]}
        data={}
        for f in e.ENTITIES[kind]['fields']:
            if not f['required']:continue
            t=f['type'];n=f['name']
            if t=='ref':data[n]=self.default(f['target'])['id']
            elif t=='choice':data[n]=f['options'][0]
            elif t=='date':data[n]=self.today
            elif t=='datetime':data[n]=e.now()
            elif t=='time':data[n]='07:00' if 'inicio' in n else '15:20'
            elif t in ('integer','money'):data[n]=2 if t=='integer' else 3000
            elif t=='lines':data[n]=['*Conferiu o uniforme?']
            elif t=='answers':data[n]=[{'pergunta':'*Conferiu o uniforme?','resposta':'Sim'}]
            elif t=='email':data[n]='equipe@example.invalid'
            elif t=='ids':
                id=self.db.execute('INSERT INTO diarias(diarista_id,data,local,setor,valor_centavos,criado_em) VALUES(?,?,?,?,?,?)',(self.worker,self.today,'Teste','Eventos',3000,e.now())).lastrowid;data[n]=[id]
            else:data[n]='Informação de teste conferida'
        if kind=='categoria':data['tipo']='despesa'
        if kind=='amostra':data.update(saldo_inicial=20,recebidas=0,distribuidas=5,perdas=1,devolvidas=2,vendas=0)
        if kind=='movimento':data.update(tipo='entrada',quantidade=5)
        if kind=='acesso':self.db.execute("INSERT INTO direct_staff(email,role,active) VALUES('equipe@example.invalid','operacao',1)")
        if kind=='ciencia':
            b=self.parents['briefing'];self.parents['briefing']=self.save('briefing',e.json_fields(b['dados'],e.ENTITIES['briefing']),state='publicado',record=b)
        record=self.save(kind,data);self.parents[kind]=record;return record

    def test_all_typed_forms_persist_and_reject_unknown_fields(self):
        for kind in e.ENTITIES:
            with self.subTest(kind=kind):
                r=self.default(kind);self.assertEqual(e.get(self.db,r['id'])['tipo'],kind)
                with self.assertRaises(ValueError):self.save(kind,{'unexpected':'value'})

    def test_expense_approval_creates_exactly_one_ledger_and_rejects_operation_approval(self):
        r=self.default('despesa');data=e.json_fields(r['dados'],e.ENTITIES['despesa'])
        sent=self.save('despesa',data,record=r,state='enviada')
        with self.assertRaises(PermissionError):self.save('despesa',data,record=sent,state='aprovada',role='operacao')
        approved=self.save('despesa',data,record=sent,state='aprovada')
        self.save('despesa',data,record=approved,state='aprovada')
        self.assertEqual(self.db.execute('SELECT count(*) FROM financeiro_lancamentos WHERE empresa_registro_id=?',(r['id'],)).fetchone()[0],1)
        with self.assertRaises(ValueError):self.save('despesa',{**data,'valor_centavos':4000},record=e.get(self.db,r['id']),state='aprovada')

    def test_material_prevents_negative_stock_and_excess_return_and_expired_lot(self):
        m=self.default('material');data=dict(material_id=m['id'],data=self.today,tipo='entrega',quantidade=2,responsavel='Teste',diarista_id=self.worker)
        self.save('movimento',data);self.assertEqual(e.stock(self.db,m['id']),0)
        with self.assertRaises(ValueError):self.save('movimento',{**data,'quantidade':1})
        with self.assertRaises(ValueError):self.save('movimento',{**data,'tipo':'devolucao','quantidade':3})
        self.save('movimento',{**data,'tipo':'devolucao','quantidade':2});self.assertEqual(e.stock(self.db,m['id']),2)
        lot=self.save('lote',dict(material_id=m['id'],codigo='A',validade=(e.company_today()-timedelta(days=1)).isoformat(),antecedencia_dias=1))
        with self.assertRaises(ValueError):self.save('movimento',{**data,'lote_id':lot['id']})

    def test_quote_versions_convert_once_and_snapshot_real_attendance_prices(self):
        r=self.default('proposta');data=e.json_fields(r['dados'],e.ENTITIES['proposta'])
        r=self.save('proposta',data,record=r,state='enviada')
        with self.assertRaises(ValueError):self.save('proposta',{**data,'pessoas':5},record=r,state='enviada')
        r=self.save('proposta',data,record=r,state='aprovada');p={'id':r['id'],'versao':r['versao']}
        result=a.convert(self.db,p,server);repeated=a.convert(self.db,p,server)
        self.assertEqual(result['pedido_id'],repeated['pedido_id']);self.assertEqual(a.contracted(self.db,result['pedido_id'])['custo_unitario_centavos'],3000)
        count=self.db.execute('SELECT count(*) FROM pedidos').fetchone()[0];self.assertEqual(count,1)
        id=self.db.execute('INSERT INTO pedido_escalas(pedido_id,diarista_id,data,criado_em,atualizado_em) VALUES(?,?,?,?,?)',(result['pedido_id'],self.worker,self.today,e.now(),e.now())).lastrowid
        server.apply_local_attendance(self.db,result['pedido_id'],id,{'status':'presente'})
        daily=self.db.execute('SELECT * FROM diarias WHERE pedido_escala_id=?',(id,)).fetchone();self.assertEqual((daily['valor_centavos'],daily['valor_recebido_centavos']),(3000,3000))

    def test_import_is_idempotent_and_partial_receipt_atomic_and_duplicate_rejected(self):
        account=self.default('conta');invoice=self.default('cobranca')['id'];p=dict(conta_id=account['id'],linhas=[dict(data=self.today,valor_centavos=3000,descricao='Crédito teste',identificador='FITID-1')])
        first=e.import_statement(self.db,p);second=e.import_statement(self.db,p);self.assertEqual((first['importadas'],second['repetidas']),(1,1))
        line=dict(self.db.execute('SELECT * FROM empresa_extrato').fetchone())
        e.reconcile(self.db,dict(id=line['id'],versao=1,destino_tipo='cobranca',destino_id=invoice),server)
        self.assertEqual(self.db.execute('SELECT sum(valor_centavos) FROM cobranca_recebimentos WHERE cobranca_id=?',(invoice,)).fetchone()[0],3000)
        with self.assertRaises(RuntimeError):e.reconcile(self.db,dict(id=line['id'],versao=1,destino_tipo='cobranca',destino_id=invoice),server)
        self.assertEqual(self.db.execute('SELECT valor_centavos FROM cobrancas WHERE id=?',(invoice,)).fetchone()[0],10000)

    def test_review_payment_detects_changed_amount(self):
        r=self.default('pagamento_revisao');data=e.json_fields(r['dados'],e.ENTITIES['pagamento_revisao']);self.db.execute('UPDATE diarias SET valor_centavos=4000 WHERE id=?',(data['diaria_ids'][0],))
        with self.assertRaises(ValueError):self.save('pagamento_revisao',data,state='aprovado',record=r)

    def test_report_public_projection_excludes_contacts_and_finance(self):
        r=self.default('relatorio');data={**e.json_fields(r['dados'],e.ENTITIES['relatorio']),'aprovado_por':'Supervisão'}
        with self.assertRaises(ValueError):a.share(self.db,dict(id=r['id'],versao=r['versao']))
        r=self.save('relatorio',data,record=r,state='aprovado');code=a.share(self.db,dict(id=r['id'],versao=r['versao']))['codigo']
        result=a.public_report(self.db,code);self.assertEqual(set(result),{'titulo','inicio','fim','resumo','resultado','versao','aprovado_em'})
        with self.assertRaises(PermissionError):a.public_report(self.db,'invalid')

    def test_optimistic_lock_and_scoped_campaign_references(self):
        r=self.default('tarefa');data=e.json_fields(r['dados'],e.ENTITIES['tarefa']);self.save('tarefa',data,record=r)
        with self.assertRaises(RuntimeError):self.save('tarefa',data,record=r)
        camp=self.default('campanha');other=self.save('cliente',{'segmento':'marca'},'Outra empresa')
        with self.assertRaises(ValueError):self.save('tarefa',{**data,'campanha_id':camp['id'],'cliente_id':other['id']})

    def test_completed_checklist_preserves_questions(self):
        r=self.default('checklist');data=e.json_fields(r['dados'],e.ENTITIES['checklist'])
        with self.assertRaises(ValueError):self.save('checklist',{**data,'respostas':[dict(pergunta='*Conferiu o uniforme?',resposta='')]},record=r,state='concluido')
        r=self.save('checklist',data,record=r,state='concluido');self.assertEqual(r['dados']['perguntas_snapshot'],['*Conferiu o uniforme?'])
        with self.assertRaises(ValueError):self.save('checklist',{**data,'responsavel':'Outro'},record=r,state='concluido')

    def test_payment_review_registers_native_batch_once_and_preserves_beneficiary(self):
        r=self.default('pagamento_revisao');data=e.json_fields(r['dados'],e.ENTITIES['pagamento_revisao']);r=self.save('pagamento_revisao',data,state='aprovado',record=r)
        p=dict(id=r['id'],versao=r['versao'],data_pagamento=self.today,forma='Pix de teste');result=a.payment(self.db,p,server)
        self.assertEqual(a.payment(self.db,p,server)['lote_id'],result['lote_id'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM pagamento_lotes').fetchone()[0],1)
        row=self.db.execute('SELECT diarista_id,data_pagamento,pagamento_lote_id FROM diarias WHERE id=?',(data['diaria_ids'][0],)).fetchone()
        self.assertEqual(tuple(row),(self.worker,self.today,result['lote_id']))

    def test_dynamic_network_store_validation_and_bound_name_preservation(self):
        with self.assertRaises(ValueError):server.validate_store(dict(rede='Rede inexistente'))
        r=self.save('rede',{'tipo':'supermercado'},'Rede QA nova');self.db.commit()
        d=server.validate_store(dict(rede=r['titulo'],nome='Loja QA',endereco='Rua Teste',cidade='Fortaleza'));self.assertEqual(d['rede'],r['titulo'])
        self.db.execute('INSERT INTO lojas(rede,nome,endereco,cidade,criado_em,atualizado_em,situacao) VALUES(?,?,?,?,?,?,?)',(r['titulo'],'Loja QA','Rua QA','Fortaleza',e.now(),e.now(),'confirmado'))
        with self.assertRaises(ValueError):self.save('rede',{'tipo':'supermercado'},'Outro nome',record=r)

    def test_configured_advance_notice_escalates_without_external_message(self):
        self.save('regra',dict(tipo='tarefa_vencida',antecedencia_dias=3,responsavel='Supervisão QA',acao='Conferir e reagendar a execução'))
        task=self.save('tarefa',dict(prazo=(e.company_today()+timedelta(days=2)).isoformat()+'T12:00:00-03:00',responsavel='Equipe QA',prioridade='normal',proxima_acao='Conferir execução'))
        alert=next(x for x in a.alerts(self.db,self.today) if x['id']==task['id']);self.assertIn('Supervisão QA',alert['responsavel']);self.assertIn('reagendar',alert['motivo'])

    def test_dashboard_tolerates_legacy_optional_cost_center_and_excludes_capital_from_margin(self):
        self.default('despesa');capital=self.default('movimento_caixa');panel=e.dashboard(self.db,{'inicio':[self.today],'fim':[self.today]})
        self.assertEqual(panel['aportes_centavos'],capital['dados']['valor_centavos']);self.assertEqual(panel['margem_contribuicao_centavos'],0)

    def test_notice_acknowledgment_is_personal_and_repeated_click_is_safe(self):
        notice=self.default('aviso');data={'aviso_id':notice['id']}
        first=self.save('leitura_aviso',data,title='Leitura: aviso');second=self.save('leitura_aviso',data,title='Leitura: aviso');self.assertEqual(first['id'],second['id'])
        self.assertEqual(len(e.all_records(self.db,'leitura_aviso')),1)

    def test_closing_detects_vacancy_without_any_assignment(self):
        oid=self.default('pedido')['id'];issues=e.closing_issues(self.db,{'data':self.today,'pedido_id':oid});self.assertEqual(issues['vagas_pendentes'],1)
        with self.assertRaises(ValueError):self.save('fechamento',dict(data=self.today,pedido_id=oid,responsavel='Supervisão'),state='fechado')
        r=self.save('fechamento',dict(data=self.today,pedido_id=oid,responsavel='Supervisão',justificativa='Vaga ainda aberta e acompanhada'),state='fechado');self.assertEqual(r['dados']['pendencias']['vagas_pendentes'],1)

    def test_financial_values_not_in_consultation_dashboard(self):
        self.default('pedido');panel=e.dashboard(self.db,{'inicio':[self.today],'fim':[self.today]},role='consulta');self.assertEqual(panel['demanda'],1);self.assertNotIn('receita_real_centavos',panel)

if __name__=='__main__':unittest.main()
