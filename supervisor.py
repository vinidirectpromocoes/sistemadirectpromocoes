"""Supervisor ledger and immutable closing snapshots; legacy amounts are never rewritten."""
import hashlib,json,re,sqlite3
from urllib.parse import urlparse,parse_qs
from datetime import date
import enterprise as e


def ensure_schema(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS supervisor_registros(
      id INTEGER PRIMARY KEY AUTOINCREMENT,tipo TEXT NOT NULL CHECK(tipo IN ('adiantamento','passagem','acerto','fechamento','estorno')),
      pedido_id INTEGER REFERENCES pedidos(id),diarista_id INTEGER REFERENCES diaristas(id),
      dados TEXT NOT NULL,chave TEXT NOT NULL UNIQUE,autor TEXT NOT NULL,criado_em TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS supervisor_worker_order ON supervisor_registros(diarista_id,pedido_id,id);
      CREATE TRIGGER IF NOT EXISTS supervisor_settled_guard BEFORE UPDATE ON diarias
      WHEN OLD.data_pagamento IS NOT NULL AND EXISTS(SELECT 1 FROM supervisor_registros r,json_each(r.dados,'$.diaria_ids') x WHERE r.tipo='acerto' AND x.value=OLD.id) AND (NEW.data_pagamento IS NOT OLD.data_pagamento OR NEW.valor_centavos IS NOT OLD.valor_centavos OR NEW.pagamento_lote_id IS NOT OLD.pagamento_lote_id)
      BEGIN SELECT RAISE(ABORT,'Acerto preservado no extrato. Não altere por outra tela.');END;
    ''')


def records(db):
    return [{**dict(r),'dados':json.loads(r['dados'])} for r in db.execute('SELECT * FROM supervisor_registros ORDER BY id')]


def context(db,core):
    workers=[dict(r) for r in db.execute('SELECT id,nome,cpf,telefone FROM diaristas ORDER BY id')]
    orders=[{**dict(r),'turnos':json.loads(r['turnos'])} for r in db.execute('SELECT * FROM pedidos ORDER BY id')]
    dailies=[dict(r) for r in db.execute('SELECT d.*,s.pedido_id FROM diarias d LEFT JOIN pedido_escalas s ON s.id=d.pedido_escala_id ORDER BY d.id')]
    return dict(workers=workers,orders=orders,dailies=dailies,scales=core.all_scale_rows(db),ledger=records(db))


def active(ledger):
    voided={r['dados']['registro_id'] for r in ledger if r['tipo']=='estorno'}
    return [r for r in ledger if r['id'] not in voided]


def check_payment(db,worker,daily_ids):
    rows=active(records(db));ids=set(daily_ids)
    settled={did for r in rows if r['tipo']=='acerto' for did in r['dados']['diaria_ids']}
    for d in db.execute('SELECT d.id,s.pedido_id FROM diarias d JOIN pedido_escalas s ON s.id=d.pedido_escala_id WHERE d.diarista_id=?',(worker,)):
        if d['id'] in ids and d['id'] not in settled and any(r['diarista_id']==worker and r['pedido_id']==d['pedido_id'] and r['tipo'] in ('adiantamento','passagem') for r in rows):
            raise ValueError('Confira adiantamentos e passagens no Extrato do diarista antes de pagar.')


def plan(db,worker,order):
    rows=[dict(r) for r in db.execute('SELECT d.* FROM diarias d JOIN pedido_escalas s ON s.id=d.pedido_escala_id WHERE d.diarista_id=? AND s.pedido_id=? AND d.data_pagamento IS NULL ORDER BY d.data,d.id',(worker,order))]
    if any(r['valor_centavos'] is None for r in rows):raise ValueError('Complete os valores das diárias antes de conferir o acerto.')
    ledger=active(records(db));used={};paid_passages=set()
    for r in ledger:
        if r['tipo']=='acerto':
            for x in r['dados'].get('abatimentos',[]):used[x['id']]=used.get(x['id'],0)+x['valor_centavos']
            paid_passages.update(r['dados'].get('passagem_ids',[]))
    extras=[r for r in ledger if r['diarista_id']==worker and r['pedido_id']==order]
    passages=[r for r in extras if r['tipo']=='passagem' and r['id'] not in paid_passages]
    advances=[r for r in extras if r['tipo']=='adiantamento' and r['dados']['valor_centavos']>used.get(r['id'],0)]
    gross=sum(r['valor_centavos'] for r in rows);travel=sum(r['dados']['valor_centavos'] for r in passages)
    remaining=gross+travel;deductions=[]
    for r in advances:
        value=min(remaining,r['dados']['valor_centavos']-used.get(r['id'],0))
        if value:deductions.append(dict(id=r['id'],valor_centavos=value));remaining-=value
    credit=sum(r['dados']['valor_centavos']-used.get(r['id'],0) for r in advances)-sum(x['valor_centavos'] for x in deductions)
    # Allocate advance first to daily wages, then passages. Original daily values remain intact.
    discount=sum(x['valor_centavos'] for x in deductions);cash={}
    for r in rows:
        take=min(discount,r['valor_centavos']);cash[str(r['id'])]=r['valor_centavos']-take;discount-=take
    passage_cash={}
    for r in passages:
        take=min(discount,r['dados']['valor_centavos']);passage_cash[str(r['id'])]=r['dados']['valor_centavos']-take;discount-=take
    return dict(diarista_id=worker,pedido_id=order,diaria_ids=[r['id'] for r in rows],passagem_ids=[r['id'] for r in passages],diarias_centavos=gross,passagens_centavos=travel,abatimentos=deductions,adiantamentos_centavos=sum(x['valor_centavos'] for x in deductions),saldo_centavos=remaining,credito_remanescente_centavos=credit,caixa_diarias=cash,caixa_passagens=passage_cash)


def preview(db,p,core):
    start=core.validate_date(p.get('inicio'),'o início');end=core.validate_date(p.get('fim'),'o fim');network=core.clean_text(p.get('rede',''),'a rede',180,False)
    if start>end or (date.fromisoformat(end)-date.fromisoformat(start)).days>366:raise ValueError('Escolha um período em ordem crescente de até 366 dias.')
    c=context(db,core);orders={r['id']:r for r in c['orders']};workers={r['id']:r for r in c['workers']};ledger=active(c['ledger']);today=e.company_today().isoformat()
    chosen=lambda o:not network or o['supermercado']==network
    rows=[];missing=[]
    for r in c['dailies']:
        if not start<=r['data']<=end:continue
        o=orders.get(r['pedido_id']);net=o['supermercado'] if o else r['local']
        if network and net!=network:continue
        worker=workers[r['diarista_id']]
        row=dict(id=r['id'],pedido_id=r['pedido_id'],diarista_id=r['diarista_id'],nome=worker['nome'],cpf=worker['cpf'],rede=net,loja=o['unidade'] if o else r['local'],setor=r['setor'],data=r['data'],valor_centavos=r['valor_centavos'],receita_centavos=r.get('valor_recebido_centavos'),data_pagamento=r['data_pagamento'])
        if r['valor_centavos'] is None or r.get('valor_recebido_centavos') is None:missing.append('Diária #'+str(r['id'])+' com valor incompleto.')
        rows.append(row)
    demand=attended=closed_demand=closed_attended=absences=withdrawals=pending=0
    for o in c['orders']:
        if not chosen(o):continue
        for shift in o['turnos']:
            if not start<=shift['data']<=end or shift['data']>today:continue
            ss=[s for s in c['scales'] if s['pedido_id']==o['id'] and s['data']==shift['data']]
            present=sum(s['status']=='presente' for s in ss);wanted=present if o['situacao']=='cancelado' else o['quantidade_diaristas'];demand+=wanted;attended+=present
            if shift['data']<today:closed_demand+=wanted;closed_attended+=present
            absences+=sum(s['status']=='falta' for s in ss);withdrawals+=sum(s['status']=='desistiu' for s in ss);pending+=sum(s['status']=='escalada' for s in ss) if o['situacao']!='cancelado' else 0
    if pending:missing.append(f'{pending} presença(s) ainda a conferir no período.')
    if end>today:missing.append('O período inclui dias futuros; aguarde para concluir o fechamento.')
    selected=[r for r in ledger if r['tipo'] in ('adiantamento','passagem') and start<=r['dados']['data']<=end and chosen(orders[r['pedido_id']])]
    expenses=sum(r['valor_centavos'] for r in db.execute("SELECT l.* FROM financeiro_lancamentos l LEFT JOIN empresa_registros er ON er.id=l.empresa_registro_id LEFT JOIN pedidos o ON o.id=er.pedido_id WHERE l.tipo='despesa' AND coalesce(json_extract(er.dados,'$.data'),l.vencimento) BETWEEN ? AND ? AND (?='' OR o.supermercado=?)",(start,end,network,network)))
    result=dict(inicio=start,fim=end,rede=network or 'Todas as redes',diarias=rows,movimentos=selected,pendencias=missing,metricas=dict(solicitadas=demand,atendidas=attended,nao_atendidas=max(0,demand-attended),faltas=absences,desistencias=withdrawals,presencas_pendentes=pending,demanda_finalizada=closed_demand,atendidas_finalizadas=closed_attended),totais=dict(despesas_centavos=expenses,receita_centavos=sum(r['receita_centavos'] or 0 for r in rows),diarias_centavos=sum(r['valor_centavos'] or 0 for r in rows),passagens_centavos=sum(r['dados']['valor_centavos'] for r in selected if r['tipo']=='passagem'),adiantamentos_centavos=sum(r['dados']['valor_centavos'] for r in selected if r['tipo']=='adiantamento')))
    result['assinatura']=hashlib.sha256(json.dumps(result,sort_keys=True,ensure_ascii=False).encode()).hexdigest();return result


def save(db,p,core):
    if not isinstance(p,dict):raise ValueError('Dados inválidos.')
    key=core.clean_text(p.get('chave'),'a chave',120);kind=p.get('tipo')
    if not re.fullmatch(r'[A-Za-z0-9:_-]{8,120}',key):raise ValueError('Chave inválida.')
    prior=db.execute('SELECT * FROM supervisor_registros WHERE chave=?',(key,)).fetchone()
    request={k:v for k,v in p.items() if k!='chave'}
    if prior:
        old=json.loads(prior['dados'])
        if old.get('solicitacao')!=request:raise ValueError('Essa chave já foi usada para outra operação.')
        return {**dict(prior),'dados':old,'repetido':True}
    worker=order=None
    if kind in ('adiantamento','passagem','acerto'):
        worker=p.get('diarista_id');order=p.get('pedido_id')
        if isinstance(worker,bool) or isinstance(order,bool) or not isinstance(worker,int) or not isinstance(order,int):raise ValueError('Escolha o diarista e o pedido.')
        if not db.execute('SELECT 1 FROM pedido_escalas WHERE pedido_id=? AND diarista_id=?',(order,worker)).fetchone():raise ValueError('O diarista deve ter uma escala neste pedido.')
        day=core.validate_date(p.get('data'),'a data');method=core.clean_text(p.get('forma',''),'a forma de pagamento',80,kind in ('adiantamento','acerto'))
        if day>e.company_today().isoformat():raise ValueError('Registro realizado não pode ter data futura.')
        if kind=='acerto':
            data=plan(db,worker,order)
            if not data['diaria_ids'] and not data['passagem_ids']:raise ValueError('Não há valores pendentes para acertar.')
            if p.get('conferencia')!=data:raise ValueError('O saldo mudou. Atualize e confira novamente.')
        else:
            amount=p.get('valor_centavos')
            if isinstance(amount,bool) or not isinstance(amount,int) or not 1<=amount<=1000000000:raise ValueError('Informe um valor positivo com até duas casas decimais.')
            data=dict(valor_centavos=amount,motivo=core.clean_text(p.get('motivo'),'o motivo',500))
        data.update(data=day,forma=method,nome=db.execute('SELECT nome FROM diaristas WHERE id=?',(worker,)).fetchone()[0])
    elif kind=='fechamento':
        data=preview(db,p,core)
        if data['pendencias']:raise ValueError('Resolva as pendências antes de fechar: '+' '.join(data['pendencias']))
        if p.get('assinatura')!=data['assinatura']:raise ValueError('O levantamento mudou. Atualize e confira novamente.')
        data['observacoes']=core.clean_text(p.get('observacoes',''),'as observações',1000,False)
    elif kind=='estorno':
        target=db.execute('SELECT * FROM supervisor_registros WHERE id=?',(p.get('registro_id'),)).fetchone()
        if not target or target['tipo'] not in ('adiantamento','passagem'):raise ValueError('Escolha um movimento que possa ser anulado.')
        ledger=records(db)
        if any(r['tipo']=='estorno' and r['dados']['registro_id']==target['id'] or r['tipo']=='acerto' and (target['id'] in r['dados'].get('passagem_ids',[]) or any(x['id']==target['id'] for x in r['dados'].get('abatimentos',[]))) for r in ledger):raise ValueError('O movimento já foi anulado ou utilizado em acerto. Preserve seu histórico.')
        worker=target['diarista_id'];order=target['pedido_id'];data=dict(registro_id=target['id'],motivo=core.clean_text(p.get('motivo'),'o motivo da anulação',500))
    else:raise ValueError('Operação não reconhecida.')
    data['solicitacao']=request
    rid=db.execute('INSERT INTO supervisor_registros(tipo,pedido_id,diarista_id,dados,chave,autor,criado_em) VALUES(?,?,?,?,?,?,?)',(kind,order,worker,json.dumps(data,ensure_ascii=False),key,'Servidor local',e.now())).lastrowid
    if kind=='acerto':
        ids=data['diaria_ids'];batch=None
        if ids and data['saldo_centavos']:
            batch=db.execute('INSERT INTO pagamento_lotes(diarista_id,valor_centavos,data_pagamento,forma,quantidade,criado_em) VALUES(?,?,?,?,?,?)',(worker,data['saldo_centavos'],data['data'],data['forma'],len(ids),e.now())).lastrowid
        for daily in ids:db.execute('UPDATE diarias SET data_pagamento=?,forma_pagamento=?,pagamento_lote_id=? WHERE id=?',(data['data'],data['forma'],batch,daily))
    return {**dict(db.execute('SELECT * FROM supervisor_registros WHERE id=?',(rid,)).fetchone()),'dados':data}


def finance_projection(native,ledger,scales=()):
    rows=active(ledger);cash={};paid={}
    for r in rows:
        if r['tipo']=='acerto':
            for key,value in r['dados']['caixa_diarias'].items():cash[int(key)]=(value,r['id'])
            for key in r['dados']['passagem_ids']:paid[key]=r
    result=[dict(r) for r in native]
    used={}
    for record in rows:
        if record['tipo']=='acerto':
            for x in record['dados']['abatimentos']:used[x['id']]=used.get(x['id'],0)+x['valor_centavos']
    credits={}
    for record in rows:
        if record['tipo']=='adiantamento':
            k=(record['diarista_id'],record['pedido_id']);credits[k]=credits.get(k,0)+record['dados']['valor_centavos']-used.get(record['id'],0)
    by_daily={s['diaria']['id']:s['pedido_id'] for s in scales if s.get('diaria')}
    for r in sorted(result,key=lambda r:(r.get('referencia',''),r['id'])):
        if r['origem']=='diaria' and not r['data_pagamento'] and r['valor_centavos'] is not None:
            key=(r['diarista_id'],by_daily.get(r['id']));take=min(credits.get(key,0),r['valor_centavos'])
            if take:r['caixa_centavos']=r['valor_centavos']-take;credits[key]-=take
        if r['origem']=='diaria' and r['id'] in cash:r['caixa_centavos'],r['supervisor_acerto_id']=cash[r['id']]
    for r in rows:
        if r['tipo'] not in ('adiantamento','passagem'):continue
        settle=paid.get(r['id']);is_paid=r['tipo']=='adiantamento' or bool(settle)
        result.append(dict(id=r['id'],chave='supervisor:'+str(r['id']),origem='supervisor',tipo='despesa',descricao=r['tipo'].capitalize()+' · Pedido #'+str(r['pedido_id']),categoria='Adiantamento de diária' if r['tipo']=='adiantamento' else 'Passagem do serviço',contraparte=r['dados'].get('nome','Diarista #'+str(r['diarista_id'])),diarista_id=r['diarista_id'],pedido_id=r['pedido_id'],valor_centavos=r['dados']['valor_centavos'],caixa_centavos=settle['dados']['caixa_passagens'].get(str(r['id']),0) if settle else r['dados']['valor_centavos'],referencia=r['dados']['data'],vencimento=r['dados']['data'],data_pagamento=(settle['dados']['data'] if settle else r['dados']['data']) if is_paid else None,forma_pagamento=settle['dados']['forma'] if settle else r['dados']['forma'],observacoes=r['dados'].get('motivo','')))
    return result


def handle(handler,method,core):
    u=urlparse(handler.path)
    if not u.path.startswith('/api/supervisor/'):return False
    action=u.path.rsplit('/',1)[-1];q={k:v[0] for k,v in parse_qs(u.query).items()}
    try:
        with core.connect() as db:
            if method=='POST':db.execute('BEGIN IMMEDIATE')
            if action=='registros' and method=='GET':result=records(db)
            elif action=='acerto' and method=='GET':result=plan(db,int(q.get('diarista_id',0)),int(q.get('pedido_id',0)))
            elif action=='fechamento' and method=='GET':result=preview(db,q,core)
            elif action=='registro' and method=='POST':result=save(db,handler.read_json(),core)
            else:raise ValueError('Ação não disponível.')
        handler.respond(200,result)
    except (ValueError,TypeError,sqlite3.IntegrityError) as ex:handler.respond(400,{'erro':str(ex)})
    return True
