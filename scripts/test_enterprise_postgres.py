"""Actual SQL/RLS/transaction checks against the disposable database only."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
from scripts.enterprise_postgres_qa import start,initialize,psycopg2,ROOT
from test_enterprise import EnterpriseTest
import enterprise as e

ADMIN='00000000-0000-4000-8000-000000000001'
STAFF='00000000-0000-4000-8000-000000000002'
def run():
    pg=start()
    try:
        uri=initialize(pg,ROOT/'tests/fixtures/enterprise_migration_history.json')
        db=psycopg2.connect(uri);c=db.cursor()
        c.execute((ROOT/'supabase/migrations/20261008185515_enterprise_operational_platform.sql').read_text())
        c.execute("INSERT INTO auth.users(id,email) VALUES(%s,'admin@example.invalid'),(%s,'equipe@example.invalid')",(ADMIN,STAFF))
        c.execute("INSERT INTO public.direct_admins VALUES('admin@example.invalid');INSERT INTO public.direct_staff(email,role,active) VALUES('equipe@example.invalid','operacao',true)")
        c.execute("INSERT INTO public.lojas(rede,nome,endereco,cidade,situacao) VALUES('Super Lagoa','Local QA','Rua QA','Fortaleza','confirmado') RETURNING id");store=c.fetchone()[0]
        c.execute("INSERT INTO public.diaristas(nome,cpf,setores,cep,logradouro,numero,bairro) VALUES('Pessoa QA','52998224725','[\"Eventos\"]','','','','') RETURNING id");worker=c.fetchone()[0]
        day=e.company_today().isoformat()
        c.execute("INSERT INTO public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) VALUES('Super Lagoa','Local QA','Eventos',1,%s::jsonb) RETURNING id",(json.dumps([dict(data=day,inicio='07:00',fim='15:20')]),));order=c.fetchone()[0]
        c.execute("INSERT INTO public.diarias(diarista_id,data,local,setor,valor_centavos,vencimento_pagamento) VALUES(%s,%s,'QA','Eventos',3000,%s) RETURNING id",(worker,day,day));daily=c.fetchone()[0]
        c.execute("INSERT INTO public.cobrancas(rede,periodo_inicio,periodo_fim,vencimento,valor_centavos) VALUES('Super Lagoa',%s,%s,%s,10000) RETURNING id",(day,day,day));invoice=c.fetchone()[0]
        db.commit()
        def claims(role='admin'):
            c.execute('reset role');c.execute('set local role authenticated')
            c.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=ADMIN if role=='admin' else STAFF,email='admin@example.invalid' if role=='admin' else 'equipe@example.invalid')),))
        def rpc(name,p):
            c.execute('select public.direct_empresa_'+name+'(%s::jsonb)',(json.dumps(p),));return c.fetchone()[0]
        def fail(fn,pattern=None):
            c.execute('savepoint expected_failure')
            try:fn()
            except Exception as ex:
                if pattern:assert pattern.lower() in str(ex).lower(),str(ex)
                c.execute('rollback to savepoint expected_failure');return
            raise AssertionError('Expected denial did not occur')
        claims();cases=EnterpriseTest();cases.setUp();mapping={};saved={}
        try:
            def register(kind):
                original=cases.default(kind)
                if (kind,original['id']) in mapping:return saved[kind]
                data=e.json_fields(original['dados'],e.ENTITIES[kind])
                for f in e.ENTITIES[kind]['fields']:
                    n=f['name'];target=f.get('target')
                    if n not in data:continue
                    if f['type']=='ref':
                        if target not in ('pedido','diarista','loja','cobranca') and (target,data[n]) not in mapping:register(target)
                        data[n]={'pedido':order,'diarista':worker,'loja':store,'cobranca':invoice}.get(target) or mapping[(target,data[n])]
                    if f['type']=='ids':data[n]=[daily]
                if kind=='ciencia':
                    briefing=saved['briefing'];saved['briefing']=rpc('registro',dict(id=briefing['id'],versao=briefing['versao'],tipo='briefing',titulo=briefing['titulo'],status='publicado',dados=briefing['dados']))
                p=dict(tipo=kind,titulo=original['titulo'],status=e.ENTITIES[kind]['statuses'][0],dados=data,chave='qa:'+kind+':12345678')
                r=rpc('registro',p);mapping[(kind,original['id'])]=r['id'];saved[kind]=r
                assert r['tipo']==kind,kind
                assert rpc('lista',dict(tipo=kind))['total']>0,kind
                assert rpc('registro',dict(id=r['id']))['id']==r['id'],kind
                assert rpc('registro',p)['id']==r['id'],kind
                fail(lambda:rpc('registro',{**p,'chave':'unknown:'+kind,'dados':{'unknown':True}}),'não reconhecidos')
                return r
            for kind in e.ENTITIES:register(kind)
            print('SQL: all 35 typed forms persisted, listed, read, replayed without duplication, and rejected unknown fields.')
        finally:cases.tearDown()
        def update(kind,state,extra=None):
            r=saved[kind];data=e.json_fields(r['dados'],e.ENTITIES[kind]);data.update(extra or {})
            r=rpc('registro',dict(id=r['id'],versao=r['versao'],tipo=kind,titulo=r['titulo'],status=state,dados=data));saved[kind]=r;return r
        expense=update('despesa','enviada',{'cliente_id':saved['cliente']['id']});claims('operacao')
        fail(lambda:update('despesa','aprovada'),'Financeiro')
        fail(lambda:rpc('extrato',dict(conta_id=saved['conta']['id'])),'Financeiro')
        assert rpc('painel',dict(inicio=day,fim=day)).get('receita_real_centavos') is None
        assert rpc('opcoes',dict(tipo='categoria'))
        claims();expense=update('despesa','aprovada');expense=update('despesa','aprovada')
        c.execute('select count(*) from public.financeiro_lancamentos where empresa_registro_id=%s',(expense['id'],));assert c.fetchone()[0]==1
        fail(lambda:update('despesa','aprovada',{'valor_centavos':9999}),'preserve')
        quote=update('proposta','enviada');fail(lambda:update('proposta','enviada',{'pessoas':5}),'preservada');quote=update('proposta','aprovada')
        p=dict(id=quote['id'],versao=quote['versao']);converted=rpc('converter_proposta',p);assert rpc('converter_proposta',p)['pedido_id']==converted['pedido_id']
        st=rpc('saldo',{'material_id':saved['material']['id']});assert st['saldo']==7
        fail(lambda:rpc('registro',dict(tipo='movimento',titulo='Saída impossível',status='registrado',chave='qa:negative:12345',dados=dict(material_id=saved['material']['id'],data=day,tipo='entrega',quantidade=100,responsavel='QA'))),'insuficiente')
        report=update('relatorio','aprovado',{'aprovado_por':'Supervisor QA'});code=rpc('compartilhar_relatorio',dict(id=report['id'],versao=report['versao']))['codigo']
        p=dict(conta_id=saved['conta']['id'],linhas=[dict(data=day,valor_centavos=3000,descricao='Crédito QA',identificador='qa-fitid-1')]);assert rpc('importar_extrato',p)['importadas']==1;assert rpc('importar_extrato',p)['repetidas']==1
        line=rpc('extrato',dict(conta_id=saved['conta']['id']))['items'][0];reconciled=rpc('conciliar',dict(id=line['id'],versao=line['versao'],destino_tipo='cobranca',destino_id=invoice));assert reconciled['estado']=='conciliado'
        fail(lambda:rpc('conciliar',dict(id=line['id'],versao=1,destino_tipo='cobranca',destino_id=invoice)),'conferida')
        c.execute('select sum(valor_centavos) from public.cobranca_recebimentos where cobranca_id=%s',(invoice,));assert c.fetchone()[0]==3000
        rpc('painel',dict(inicio=day,fim=day));rpc('alertas',{});rpc('reservas',dict(pedido_id=order));rpc('cobrancas',{});rpc('historico',dict(cliente_id=saved['cliente']['id']))
        # Approved review registers the existing native payment workflow, once.
        reviewed=update('pagamento_revisao','aprovado');pay=dict(id=reviewed['id'],versao=reviewed['versao'],data_pagamento=day,forma='Pix QA')
        batch=rpc('registrar_pagamento',pay);assert rpc('registrar_pagamento',pay)['lote_id']==batch['lote_id']
        c.execute('select pagamento_lote_id,data_pagamento from public.diarias where id=%s',(daily,));assert c.fetchone()[0]==batch['lote_id']
        # Newly configured networks receive real values only after Finance confirmation.
        network=saved['rede'];rpc('configurar_rede',dict(rede_id=network['id'],valor_recebido_centavos=15000,valor_padrao_centavos=10000))
        c.execute('select valor_recebido_centavos,valor_padrao_centavos from public.tarifas_redes where rede=%s',(network['titulo'],));assert c.fetchone()==(15000,10000)
        # Private evidence policy and metadata registration use trusted owner/record permissions.
        task=saved['tarefa'];digest='a'*64;path=str(task['id'])+'/'+digest
        c.execute("insert into storage.objects(bucket_id,name,owner_id,metadata) values('direct-evidencias',%s,%s,%s::jsonb)",(path,ADMIN,json.dumps({'size':100,'mimetype':'image/jpeg'})))
        photo=rpc('anexo',dict(registro_id=task['id'],nome='Foto QA',mime='image/jpeg',bytes=100,caminho=path,sha256=digest));assert photo['registro_id']==task['id']
        c.execute('select public.direct_backup_snapshot_v10()');backup=c.fetchone()[0];assert backup['format']=='direct-data-v10' and len(backup['tables'])==35 and backup['snapshot']['counts']['empresa_anexos']==1
        c.execute('select public.direct_backup_agent_create()');agent=c.fetchone()[0];run_id='00000000-0000-4000-8000-000000000010'
        c.execute('select public.direct_backup_bundle(%s,%s::uuid)',(agent['token'],run_id));assert c.fetchone()[0]['data']['format']=='direct-data-v10'
        c.execute('select public.direct_backup_attachment_manifest(%s,%s::uuid,%s::bigint[])',(agent['token'],run_id,[photo['id']]));assert c.fetchone()[0][0]['caminho']==path
        fail(lambda:c.execute('select public.direct_backup_attachment_manifest(%s,%s::uuid,%s::bigint[])',('0'*64,run_id,[photo['id']])), 'Credencial')
        # Unknown and wrong owner paths never become evidence links.
        fail(lambda:rpc('anexo',dict(registro_id=task['id'],nome='Foto inexistente',mime='image/jpeg',bytes=100,caminho=str(task['id'])+'/'+'b'*64,sha256='b'*64)))
        # One failed row rolls back the entire import, not only the offending row.
        before=rpc('extrato',dict(conta_id=saved['conta']['id']))['total']
        fail(lambda:rpc('importar_extrato',dict(conta_id=saved['conta']['id'],linhas=[dict(data=day,valor_centavos=500,descricao='Rollback QA',identificador='qa-rollback'),dict(data=day,valor_centavos=0,descricao='Inválido')])),'Confira')
        assert rpc('extrato',dict(conta_id=saved['conta']['id']))['total']==before
        # Scope records restrict both API reads and direct SELECT through RLS.
        access=saved['acesso'];claims('operacao');list_scoped=rpc('lista',dict(tipo='cliente'));assert list_scoped['total']==1
        fail(lambda:rpc('registro',dict(tipo='cliente',titulo='Fora do escopo',status='ativo',dados={'segmento':'marca'},chave='qa:scope:blocked')),'escopo')
        c.execute("select count(*) from public.empresa_registros where tipo='proposta'");assert c.fetchone()[0]==0
        fail(lambda:c.execute("insert into public.empresa_registros(tipo,titulo,status,dados,chave,autor) values('cliente','Bypass','ativo','{}','qa:bypass:123456','fake')"))
        c.execute('reset role');c.execute("update public.direct_staff set role='consulta' where email='equipe@example.invalid'");claims('consulta')
        fail(lambda:rpc('registro',dict(tipo='tarefa',titulo='Forbidden',status='aberta',dados={},chave='qa:readonly:12345')),'perfil')
        c.execute('reset role');c.execute('set local role anon');c.execute("select set_config('request.jwt.claims','{}',true)")
        fail(lambda:rpc('lista',dict(tipo='cliente')))
        public=rpc('relatorio_publico',dict(codigo=code));assert set(public)=={'titulo','inicio','fim','resumo','resultado','versao','aprovado_em'}
        fail(lambda:rpc('relatorio_publico',dict(codigo='not-valid')))
        claims();c.execute('reset role');c.execute("insert into public.empresa_registros(tipo,titulo,status,dados,chave,autor) select 'tarefa','Carga QA '||g,'aberta',jsonb_build_object('responsavel','QA','prazo',clock_timestamp(),'prioridade','normal','proxima_acao','Ensaio isolado'),'qa:load:'||g,'Carga QA' from generate_series(1,5000)g");claims()
        import time
        started=time.perf_counter();loaded=rpc('lista',dict(tipo='tarefa',tamanho=50));assert len(loaded['items'])==50 and loaded['total']>=5000;assert time.perf_counter()-started<5
        print('SQL: backup v10/credential gates, private evidence metadata, reviewed payment→native batch, atomic invalid import rollback, and 5,000-row paginated load passed.')
        db.rollback();db.close();print('SQL: role denials, client scope/RLS, expense→ledger, material balance, quotation versions/conversion, partial bank receipt and external report projection passed.')
    finally:pg.cleanup()
if __name__=='__main__':run()
