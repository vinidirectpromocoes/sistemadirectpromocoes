"""Exercise the real supervisor RPCs in disposable PostgreSQL; no production data."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.enterprise_postgres_qa import start,initialize,psycopg2,ROOT
ADMIN='00000000-0000-4000-8000-000000000001'
STAFF='00000000-0000-4000-8000-000000000002'
def run():
    pg=start()
    try:
        uri=initialize(pg,ROOT/'tests/fixtures/enterprise_migration_history.json');db=psycopg2.connect(uri);c=db.cursor()
        c.execute((ROOT/'supabase/migrations/20261008185515_enterprise_operational_platform.sql').read_text())
        c.execute("INSERT INTO auth.users(id,email) VALUES(%s,'admin@example.invalid'),(%s,'staff@example.invalid')",(ADMIN,STAFF));c.execute("INSERT INTO public.direct_admins VALUES('admin@example.invalid');INSERT INTO public.direct_staff(email,role,active) VALUES('staff@example.invalid','operacao',true)")
        c.execute("INSERT INTO public.diaristas(nome,cpf,setores,cep,logradouro,numero,bairro) VALUES('Pessoa fictícia','52998224725','[\"Eventos\"]','','','','') RETURNING id");worker=c.fetchone()[0]
        c.execute("SELECT (now() at time zone 'America/Fortaleza')::date::text");day=c.fetchone()[0]
        c.execute("INSERT INTO public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) VALUES('Super Lagoa','Loja fictícia','Eventos',1,%s::jsonb) RETURNING id",(json.dumps([dict(data=day,inicio='07:00',fim='15:20')]),));order=c.fetchone()[0]
        c.execute("INSERT INTO public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) VALUES(%s,%s,%s,true) RETURNING id",(order,worker,day));scale=c.fetchone()[0]
        c.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=ADMIN,email='admin@example.invalid')),))
        c.execute("UPDATE public.pedido_escalas SET status='presente' WHERE id=%s",(scale,))
        c.execute("UPDATE public.diarias SET valor_centavos=10000,valor_recebido_centavos=16000 WHERE pedido_escala_id=%s RETURNING id",(scale,));daily=c.fetchone()[0]
        c.execute('SELECT md5(jsonb_agg(to_jsonb(d))::text) FROM public.diarias d');before=c.fetchone()[0]
        c.execute((ROOT/'supabase/migrations/20261012131722_supervisor_daily_closing.sql').read_text())
        c.execute('SELECT md5(jsonb_agg(to_jsonb(d))::text) FROM public.diarias d');assert c.fetchone()[0]==before,'Migration changed old daily values'
        db.commit()
        def claims(role='admin'):
            c.execute('reset role');c.execute('set local role authenticated');c.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=ADMIN if role=='admin' else STAFF,email='admin@example.invalid' if role=='admin' else 'staff@example.invalid')),))
        def rpc(name,p):c.execute('select public.direct_supervisor_'+name+'(%s::jsonb)',(json.dumps(p),));return c.fetchone()[0]
        def fail(fn,pattern=''):
            c.execute('savepoint expected_failure')
            try:fn()
            except Exception as ex:
                assert pattern.lower() in str(ex).lower(),str(ex);c.execute('rollback to savepoint expected_failure');return
            raise AssertionError('Expected denial did not occur')
        claims();base=dict(diarista_id=worker,pedido_id=order,data=day,forma='Pix fictício',motivo='Teste isolado')
        advance=rpc('registro',dict(**base,tipo='adiantamento',valor_centavos=3000,chave='qa:advance:0001'));assert rpc('registro',dict(**base,tipo='adiantamento',valor_centavos=3000,chave='qa:advance:0001'))['id']==advance['id']
        fail(lambda:rpc('registro',dict(**base,tipo='adiantamento',valor_centavos=4000,chave='qa:advance:0001')),'outra operação')
        fail(lambda:rpc('registro',dict(**base,tipo='adiantamento',chave='qa:noamount:0001')),'inválido')
        passage=rpc('registro',dict(**base,tipo='passagem',valor_centavos=2000,chave='qa:passage:0001'))
        plan=rpc('acerto',base);assert plan['saldo_centavos']==9000 and plan['caixa_diarias'][str(daily)]==7000
        fail(lambda:rpc('registro',dict(**base,tipo='acerto',conferencia={**plan,'saldo_centavos':10000},chave='qa:stale:0001')),'saldo mudou')
        fail(lambda:c.execute('UPDATE public.diarias SET data_pagamento=%s WHERE id=%s',(day,daily)),'Extrato')
        settlement=rpc('registro',dict(**{k:v for k,v in base.items() if k!='motivo'},tipo='acerto',conferencia=plan,chave='qa:settle:0001'))
        c.execute('SELECT valor_centavos,valor_recebido_centavos,data_pagamento FROM public.diarias WHERE id=%s',(daily,));wage,revenue,paid=c.fetchone();assert (wage,revenue)==(10000,16000) and paid is not None
        assert rpc('acerto',base)['saldo_centavos']==0
        fail(lambda:rpc('registro',dict(tipo='estorno',registro_id=advance['id'],motivo='Errado',chave='qa:voidused:0001')),'utilizado')
        fail(lambda:c.execute('UPDATE public.diarias SET data_pagamento=NULL WHERE id=%s',(daily,)),'Reabra o fechamento')
        c.execute('SELECT pagamento_lote_id FROM public.diarias WHERE id=%s',(daily,));batch=c.fetchone()[0]
        fail(lambda:c.execute('SELECT public.direct_reopen_payment_batch(%s,%s)',(batch,'Teste isolado de proteção')),'Acerto preservado')
        c.execute('SELECT status FROM public.pagamento_lotes WHERE id=%s',(batch,));assert c.fetchone()[0]=='pago'
        preview=rpc('fechamento',dict(inicio=day,fim=day,rede='Super Lagoa'));assert preview['pendencias']==[] and preview['totais']['receita_centavos']==16000
        close=rpc('registro',dict(tipo='fechamento',inicio=day,fim=day,rede='Super Lagoa',assinatura=preview['assinatura'],chave='qa:closing:0001'))
        assert close['dados']['totais']['adiantamentos_centavos']==3000
        c.execute('select public.direct_backup_snapshot_v11()');backup=c.fetchone()[0];assert backup['format']=='direct-data-v11' and backup['snapshot']['counts']['supervisor_registros']==4
        claims('operacao');assert rpc('registros',{})==[];fail(lambda:rpc('acerto',base),'Somente');fail(lambda:rpc('registro',dict(**base,tipo='passagem',valor_centavos=1000,chave='qa:denied:0001')),'Somente')
        c.execute('reset role');c.execute('set local role anon');fail(lambda:rpc('registros',{}),'permission denied')
        c.execute('reset role');c.execute('select count(*) from public.cobrancas');assert c.fetchone()[0]==0
        db.rollback();db.close();print('SQL: additive preservation, exact net settlement, repeat/stale/role guards, immutable snapshots and v11 backup passed.')
    finally:pg.cleanup()
if __name__=='__main__':run()
