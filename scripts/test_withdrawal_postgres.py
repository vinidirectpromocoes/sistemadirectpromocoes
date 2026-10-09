"""Exercise withdrawal and replacement RPCs/RLS in a disposable PostgreSQL."""
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from enterprise_postgres_qa import ROOT, start, initialize, psycopg2


def run():
    pg = start()
    try:
        uri = initialize(pg, ROOT / 'tests/fixtures/enterprise_migration_history.json')
        db = psycopg2.connect(uri)
        c = db.cursor()
        c.execute((ROOT / 'supabase/migrations/20261008185515_enterprise_operational_platform.sql').read_text())
        c.execute((ROOT / 'supabase/migrations/20261009140901_withdrawal_remaining_scope.sql').read_text())
        admin = '00000000-0000-4000-8000-000000000001'
        staff = '00000000-0000-4000-8000-000000000002'
        c.execute("insert into auth.users(id,email) values(%s,'admin@example.invalid'),(%s,'finance@example.invalid')", (admin, staff))
        c.execute("insert into public.direct_admins values('admin@example.invalid');insert into public.direct_staff(email,role,active) values('finance@example.invalid','financeiro',true)")
        today = datetime.now(ZoneInfo('America/Fortaleza')).date()
        dates = [(today + timedelta(days=i)).isoformat() for i in [-1, 0, 1, 2, 3, 4]]
        names = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo']
        availability = [dict(dia=d, inicio='00:00', fim='23:59') for d in names if d != names[(today + timedelta(days=3)).weekday()]]
        workers = []
        for name, cpf in [('Original QA', '52998224725'), ('Substituto QA', '11144477735'), ('Outra pessoa QA', '12345678909')]:
            c.execute('insert into public.diaristas(nome,cpf,disponibilidade) values(%s,%s,%s::jsonb) returning id', (name, cpf, json.dumps(availability)))
            workers.append(c.fetchone()[0])
        orders = []
        for _ in range(2):
            c.execute("insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Super do Povo','Meireles','FLV',1,%s::jsonb) returning id", (json.dumps([dict(data=d, inicio='07:00', fim='15:20') for d in dates]),))
            orders.append(c.fetchone()[0])
            for day in dates[:4]:
                c.execute('insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(%s,%s,%s,true)', (orders[-1], workers[0], day))
        db.commit()

        def claims(finance=False):
            c.execute('reset role'); c.execute('set local role authenticated')
            c.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=staff if finance else admin, email='finance@example.invalid' if finance else 'admin@example.invalid')),))

        def rpc(name, args):
            c.execute('select public.' + name + '(' + ','.join(['%s'] * len(args)) + ')', args)
            return c.fetchone()[0]

        def fail(fn, message):
            c.execute('savepoint expected_failure')
            try:
                fn()
            except Exception as error:
                assert message.lower() in str(error).lower(), str(error)
                c.execute('rollback to savepoint expected_failure')
                return
            raise AssertionError('Expected rejection did not occur')

        claims()
        c.execute('select id from public.pedido_escalas where pedido_id=%s order by data', (orders[0],)); ids = [r[0] for r in c.fetchall()]
        c.execute("update public.pedido_escalas set status='presente' where id=%s", (ids[0],))
        rpc('direct_replace_order_worker', [orders[0], ids[3], workers[2], 'Troca já concluída', True])
        c.execute('insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(%s,%s,%s,true)', (orders[0], workers[2], dates[5]))
        c.execute('select count(*) from public.diarias'); money_count = c.fetchone()[0]
        c.execute('select atualizado_em from public.pedido_escalas where id=%s', (ids[1],)); version = c.fetchone()[0]
        fail(lambda: rpc('direct_withdraw_order_remaining', [orders[0], ids[1], 'Não poderá continuar', '2000-01-01']), 'mudou')
        fail(lambda: rpc('direct_withdraw_order_remaining', [orders[0], ids[1], 'x', version]), 'motivo')
        claims(True); fail(lambda: rpc('direct_withdraw_order_remaining', [orders[0], ids[1], 'Não poderá continuar', None]), 'permissão'); claims()
        result = rpc('direct_withdraw_order_remaining', [orders[0], ids[1], 'Não poderá continuar', version])
        assert result['desistencias_registradas'] == 2, result
        c.execute('select count(*) from public.pedido_escalas where pedido_id=%s and status=\'escalada\'', (orders[1],)); assert c.fetchone()[0] == 4
        c.execute('select status from public.pedido_escalas where id=%s', (ids[0],)); assert c.fetchone()[0] == 'presente'
        c.execute('select desistencia_por,desistencia_em from public.pedido_escalas where id=%s', (ids[2],)); assert c.fetchone()[0] == 'admin@example.invalid'
        assert rpc('direct_withdraw_order_remaining', [orders[0], ids[1], '', None])['desistencias_registradas'] == 0
        single = rpc('direct_replace_order_worker', [orders[0], ids[1], workers[1], '', True])
        c.execute('select count(*) from public.pedido_escalas where pedido_id=%s and diarista_id=%s', (orders[0], workers[1])); assert c.fetchone()[0] == 1
        c.execute('savepoint before_late_conflict')
        c.execute('insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(%s,%s,%s,true) returning id', (orders[0], workers[1], dates[4])); conflict = c.fetchone()[0]
        c.execute("update public.pedido_escalas set status='desistiu',desistencia_motivo='Histórico que impede duplicação' where id=%s", (conflict,))
        fail(lambda: rpc('direct_replace_order_remaining', [orders[0], ids[1], workers[1], '', True]), 'duplicate key')
        c.execute('select count(*) from public.pedido_escalas where pedido_id=%s and diarista_id=%s', (orders[0], workers[1])); assert c.fetchone()[0] == 2, 'Partial batch persisted'
        c.execute('rollback to savepoint before_late_conflict')
        result = rpc('direct_replace_order_remaining', [orders[0], ids[1], workers[1], '', True])
        assert [r['data'] for r in result] == [dates[1], dates[2], dates[4]], result
        assert rpc('direct_replace_order_remaining', [orders[0], ids[1], workers[1], '', True])
        c.execute('select count(*) from public.pedido_escalas where pedido_id=%s and diarista_id=%s', (orders[0], workers[1])); assert c.fetchone()[0] == 3
        c.execute('select count(*) from public.diarias'); assert c.fetchone()[0] == money_count
        c.execute("select has_function_privilege('anon','public.direct_withdraw_order_remaining(bigint,bigint,text,timestamptz)','execute')"); assert not c.fetchone()[0]
        db.rollback(); db.close()
        print('PostgreSQL: withdrawal, audit, history, scope, version, both replacement choices, empty days, rollback, permissions and financial preservation OK.')
    finally:
        pg.cleanup()


if __name__ == '__main__':
    run()
