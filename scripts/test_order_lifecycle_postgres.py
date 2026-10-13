"""Real PostgreSQL, historical fixtures and role guards; disposable data only."""
import json
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from enterprise_postgres_qa import ROOT,start,initialize,psycopg2
ADMIN='00000000-0000-4000-8000-000000000001';STAFF='00000000-0000-4000-8000-000000000002'
def run():
    pg=start()
    try:
        db=psycopg2.connect(initialize(pg,ROOT/'tests/fixtures/enterprise_migration_history.json'));c=db.cursor()
        for f in ['20261008185515_enterprise_operational_platform.sql','20261009140901_withdrawal_remaining_scope.sql','20261012131722_supervisor_daily_closing.sql']:c.execute((ROOT/'supabase/migrations'/f).read_text())
        c.execute("INSERT INTO auth.users(id,email) VALUES(%s,'admin@example.invalid'),(%s,'staff@example.invalid')",(ADMIN,STAFF));c.execute("INSERT INTO public.direct_admins VALUES('admin@example.invalid');INSERT INTO public.direct_staff(email,role,active) VALUES('staff@example.invalid','financeiro',true)")
        def claims(role='admin'):
            c.execute('reset role');c.execute('set local role authenticated');c.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=ADMIN if role=='admin' else STAFF,email='admin@example.invalid' if role=='admin' else 'staff@example.invalid')),))
        c.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=ADMIN,email='admin@example.invalid')),))
        workers=[]
        for name,cpf in [('Original fictício','52998224725'),('Reposição fictícia','11144477735')]:
            c.execute('INSERT INTO public.diaristas(nome,cpf) VALUES(%s,%s) RETURNING id',(name,cpf));workers.append(c.fetchone()[0])
        today=datetime.now(ZoneInfo('America/Fortaleza')).date();dates=[(today+timedelta(days=i)).isoformat() for i in [-4,-3,-2,-1]]
        def order(days):
            c.execute("INSERT INTO public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) VALUES('Super do Povo','Loja fictícia','Eventos',1,%s::jsonb) RETURNING id",(json.dumps([dict(data=d,inicio='07:00',fim='15:20') for d in days]),));return c.fetchone()[0]
        def scale(oid,wid,day,status='escalada'):
            c.execute('INSERT INTO public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) VALUES(%s,%s,%s,true) RETURNING id',(oid,wid,day));sid=c.fetchone()[0]
            if status!='escalada':c.execute("UPDATE public.pedido_escalas SET status=%s,falta_motivo=case when %s='falta' then 'Ausência realmente conferida' else null end,desistencia_motivo=case when %s='desistiu' then 'Não pode continuar' else null end WHERE id=%s",(status,status,status,sid))
            return sid
        historic=order(dates);original=[]
        for day,status in zip(dates,['presente','falta','desistiu','desistiu']):original.append(scale(historic,workers[0],day,status))
        for origin,day in zip(original[-2:],dates[-2:]):
            sid=scale(historic,workers[1],day,'presente');c.execute('UPDATE public.pedido_escalas SET substituida_por_escala_id=%s WHERE id=%s',(sid,origin))
        pending=order([dates[-1]]);waiting=scale(pending,workers[0],dates[-1]);active=order([dates[-1],today.isoformat(),(today+timedelta(days=1)).isoformat()]);scale(active,workers[0],dates[-1],'falta');current=scale(active,workers[0],today.isoformat());scale(active,workers[0],(today+timedelta(days=1)).isoformat())
        c.execute('SELECT md5(coalesce(jsonb_agg(to_jsonb(d) order by id),\'[]\')::text) FROM public.diarias d');money=c.fetchone()[0]
        c.execute((ROOT/'supabase/migrations/20261013125243_order_lifecycle_closing.sql').read_text());db.commit();claims()
        def info(oid):c.execute('SELECT direct_private.order_lifecycle(%s)',(oid,));return c.fetchone()[0]
        def payload(oid):
            c.execute('SELECT atualizado_em FROM public.pedidos WHERE id=%s',(oid,));stamp=c.fetchone()[0]
            c.execute("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'atualizado_em',atualizado_em) order by id),'[]') FROM public.pedido_escalas WHERE pedido_id=%s",(oid,));return [oid,stamp,json.dumps(c.fetchone()[0])]
        def close(p):c.execute('SELECT public.direct_close_order(%s,%s,%s::jsonb)',p);return c.fetchone()[0]
        def fail(fn,text):
            c.execute('SAVEPOINT denied')
            try:fn()
            except Exception as e:assert text.lower() in str(e).lower(),str(e);c.execute('ROLLBACK TO SAVEPOINT denied');return
            raise AssertionError('Expected denial')
        assert info(historic)['encerravel'] and info(historic)['faltas']==1 and info(historic)['presencas']==3
        assert info(active)['situacao']=='confirmado' and info(active)['vagas_atuais']==0
        p=payload(pending);fail(lambda:close(p),'presenças pendentes')
        fail(lambda:close(payload(active)),'último dia')
        fail(lambda:c.execute("UPDATE public.pedidos SET situacao='concluido' WHERE id=%s",(active,)),'último dia')
        fail(lambda:c.execute('SELECT public.direct_replace_order_worker(%s,%s,%s,%s,true)',(historic,original[1],workers[1],'Não pode repor passado')),'passado')
        claims('financeiro');fail(lambda:close(payload(historic)),'permissão');claims()
        saved=close(payload(historic));assert saved['situacao']=='concluido'
        fail(lambda:c.execute("UPDATE public.pedido_escalas SET status='falta',falta_motivo='Alteração não permitida' WHERE id=%s",(original[0],)),'encerrado')
        c.execute("UPDATE public.pedido_escalas SET status='falta',falta_motivo='Ausência realmente conferida' WHERE id=%s",(waiting,));fail(lambda:close(p),'mudaram');close(payload(pending))
        c.execute("UPDATE public.pedido_escalas SET status='desistiu',desistencia_motivo='Não pode continuar' WHERE id=%s",(current,));assert info(active)['situacao']=='em_selecao'
        c.execute('SELECT public.direct_replace_order_remaining(%s,%s,%s,%s,true)',(active,current,workers[1],'Reposição realmente confirmada'));assert len(c.fetchone()[0])==2;assert info(active)['situacao']=='confirmado'
        c.execute('SELECT md5(coalesce(jsonb_agg(to_jsonb(d) order by id),\'[]\')::text) FROM public.diarias d');assert c.fetchone()[0]==money
        c.execute("select has_function_privilege('anon','public.direct_close_order(bigint,timestamptz,jsonb)','execute')");assert not c.fetchone()[0]
        c.execute('SELECT count(*) FROM public.cobrancas');assert c.fetchone()[0]==0
        db.rollback();db.close();print('PostgreSQL: past gaps, replacement chains, period cutoff, pending/stale/role guards, closure and financial preservation passed.')
    finally:pg.cleanup()
if __name__=='__main__':run()
