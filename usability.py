"""Search and queue controls for the loopback development server."""
import json, re, sqlite3, unicodedata
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, parse_qs

def normal(value):
    return ''.join(c for c in unicodedata.normalize('NFD',str(value or '')) if not unicodedata.combining(c)).lower()

def ensure_schema(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS pendencia_acoes(id INTEGER PRIMARY KEY AUTOINCREMENT,chave TEXT NOT NULL UNIQUE,area TEXT NOT NULL,responsavel TEXT NOT NULL DEFAULT '',proxima_acao TEXT NOT NULL DEFAULT '',adiada_ate TEXT,atualizado_em TEXT NOT NULL,autor TEXT);
    CREATE TABLE IF NOT EXISTS substituicao_contatos(id INTEGER PRIMARY KEY AUTOINCREMENT,escala_id INTEGER NOT NULL REFERENCES pedido_escalas(id) ON DELETE CASCADE,diarista_id INTEGER NOT NULL REFERENCES diaristas(id) ON DELETE CASCADE,datas TEXT NOT NULL DEFAULT '[]',resposta TEXT NOT NULL CHECK(resposta IN ('aguardando','confirmou','recusou')),atualizado_em TEXT NOT NULL,UNIQUE(escala_id,diarista_id));
    CREATE INDEX IF NOT EXISTS substituicao_contatos_diarista ON substituicao_contatos(diarista_id);''')

    if 'datas' not in {r['name'] for r in db.execute('PRAGMA table_info(substituicao_contatos)')}:db.execute("ALTER TABLE substituicao_contatos ADD COLUMN datas TEXT NOT NULL DEFAULT '[]'")
    for table in ('pendencia_acoes','substituicao_contatos'):
        columns=[r['name'] for r in db.execute('PRAGMA table_info('+table+')')]
        for event in ('INSERT','UPDATE','DELETE'):
            old="json_object("+','.join("'"+c+"',OLD."+c for c in columns)+")" if event!='INSERT' else 'NULL'
            new="json_object("+','.join("'"+c+"',NEW."+c for c in columns)+")" if event!='DELETE' else 'NULL'
            db.execute(f"CREATE TRIGGER IF NOT EXISTS audit_{table}_{event.lower()} AFTER {event} ON {table} BEGIN INSERT INTO direct_auditoria(tabela,registro_id,operacao,antes,depois) VALUES('{table}',{'OLD' if event=='DELETE' else 'NEW'}.id,'{event}',{old},{new}); END")

def contact_view(row):
    result=dict(row);result['datas']=json.loads(result['datas']);return result

def search(db,query):
    q=normal(query.strip())
    if re.fullmatch(r"[0-9. /-]+",q):q=re.sub(r"[^0-9]","",q)
    if len(q)>120:raise ValueError('Busca muito longa.')
    if len(q)<2:return []
    result=[]
    for w in db.execute('SELECT id,nome,cpf,bairro,bloqueada FROM diaristas'):
        if q in normal(w['nome']+' '+w['cpf']):result.append(dict(kind='diarista',id=w['id'],title=w['nome'],detail=w['bairro'] or '',status='Bloqueado' if w['bloqueada'] else 'Cadastro'))
    for s in db.execute('SELECT id,rede,nome,endereco,bairro,cidade FROM lojas'):
        if q in normal(' '.join(str(s[k] or '') for k in ('rede','nome','endereco','bairro','cidade'))):result.append(dict(kind='loja',id=s['id'],title=s['rede']+' · '+s['nome'],detail=s['endereco'],status='Loja'))
    names={}
    for s in db.execute('SELECT s.pedido_id,w.nome FROM pedido_escalas s JOIN diaristas w ON w.id=s.diarista_id'):names.setdefault(s['pedido_id'],[]).append(s['nome'])
    for o in db.execute('SELECT * FROM pedidos'):
        if q in normal(' '.join(str(o[k]) for k in ('id','supermercado','unidade','setor'))+' '+' '.join(names.get(o['id'],[]))):result.append(dict(kind='pedido',id=o['id'],title=f"Pedido #{o['id']} · {o['supermercado']}",detail=o['unidade']+' · '+o['setor'],status=o['situacao']))
    return sorted(result,key=lambda x:(not normal(x['title']).startswith(q),x['kind'],x['title'],x['id']))[:30]

def pending_save(db,p):
    if not isinstance(p,dict):raise ValueError('Dados inválidos.')
    key=p.get('chave','');area='operacao' if re.fullmatch(r'(pedido|ocorrencia):\d+',key) else 'cadastros' if re.fullmatch(r'(cadastro|leitura):\d+',key) else 'financeiro' if re.fullmatch(r'(finance:[a-z]+|pagamentos|faturar-pedido|cobranca|contrato):[a-zA-Z0-9_-]+',key) else None
    if not area:raise ValueError('Pendência inválida.')
    texts=[p.get(k,'') for k in ('responsavel','proxima_acao')]
    if any(not isinstance(v,str) or len(v)>n for v,n in zip(texts,(100,300))):raise ValueError('Texto muito longo.')
    now=datetime.now(timezone.utc);due=p.get('adiada_ate')
    if due:
        value=datetime.fromisoformat(due.replace('Z','+00:00'))
        if value.tzinfo is None or value<now or value>now+timedelta(days=30):raise ValueError('Escolha um prazo futuro de até 30 dias.')
    old=db.execute('SELECT * FROM pendencia_acoes WHERE chave=?',(key,)).fetchone()
    if old and old['atualizado_em']!=p.get('expected_updated_at'):raise RuntimeError('Outra pessoa alterou esta organização. Atualize e compare antes de salvar.')
    db.execute('INSERT INTO pendencia_acoes(chave,area,responsavel,proxima_acao,adiada_ate,atualizado_em) VALUES(?,?,?,?,?,?) ON CONFLICT(chave) DO UPDATE SET responsavel=excluded.responsavel,proxima_acao=excluded.proxima_acao,adiada_ate=excluded.adiada_ate,atualizado_em=excluded.atualizado_em',(key,area,*texts,due or None,now.isoformat()))
    return dict(db.execute('SELECT * FROM pendencia_acoes WHERE chave=?',(key,)).fetchone())

def response_save(db,p):
    if not isinstance(p,dict) or p.get('resposta') not in ('aguardando','confirmou','recusou'):raise ValueError('Resposta inválida.')
    scale=db.execute("SELECT s.* FROM pedido_escalas s JOIN pedidos o ON o.id=s.pedido_id WHERE s.id=? AND s.status<>'presente' AND s.substituida_por_escala_id IS NULL AND o.situacao NOT IN ('cancelado','concluido')",(p.get('escala_id'),)).fetchone()
    worker=db.execute('SELECT id FROM diaristas WHERE id=? AND NOT bloqueada',(p.get('diarista_id'),)).fetchone()
    if not scale or not worker:raise ValueError('Substituição indisponível.')
    dates=p.get('datas',[scale['data']])
    if not isinstance(dates,list) or not 1<=len(dates)<=90 or any(not isinstance(d,str) for d in dates) or len(set(dates))!=len(dates) or scale['data'] not in dates:raise ValueError('Confira as datas da resposta.')
    valid={r['data'] for r in db.execute("SELECT data FROM pedido_escalas WHERE pedido_id=? AND diarista_id=? AND data>=? AND status<>'presente' AND substituida_por_escala_id IS NULL",(scale['pedido_id'],scale['diarista_id'],scale['data']))}
    if not set(dates)<=valid:raise ValueError('Datas indisponíveis para esta substituição.')
    old=db.execute('SELECT * FROM substituicao_contatos WHERE escala_id=? AND diarista_id=?',(scale['id'],worker['id'])).fetchone()
    if old and old['atualizado_em']!=p.get('expected_updated_at'):raise RuntimeError('Outra pessoa alterou a resposta. Atualize antes de salvar.')
    db.execute('INSERT INTO substituicao_contatos(escala_id,diarista_id,resposta,atualizado_em,datas) VALUES(?,?,?,?,?) ON CONFLICT(escala_id,diarista_id) DO UPDATE SET resposta=excluded.resposta,atualizado_em=excluded.atualizado_em,datas=excluded.datas',(scale['id'],worker['id'],p['resposta'],datetime.now(timezone.utc).isoformat(),json.dumps(dates)))
    return contact_view(db.execute('SELECT * FROM substituicao_contatos WHERE escala_id=? AND diarista_id=?',(scale['id'],worker['id'])).fetchone())

def replace_remaining(db,order_id,scale_id,p,core):
    old=db.execute('SELECT * FROM pedido_escalas WHERE id=? AND pedido_id=?',(scale_id,order_id)).fetchone()
    if not old:raise ValueError('Escala não encontrada.')
    slots=db.execute("SELECT id FROM pedido_escalas WHERE pedido_id=? AND diarista_id=? AND data>=? AND status<>'presente' AND substituida_por_escala_id IS NULL ORDER BY data,id",(order_id,old['diarista_id'],old['data'])).fetchall()
    if not slots:raise ValueError('Nenhum dia para substituir.')
    return [core.scale_lifecycle.replace(db,order_id,s['id'],p,core) for s in slots]

def handle(handler,method,core):
    path=urlparse(handler.path).path
    if path not in ('/api/busca','/api/pendencias-acoes','/api/substituicao-contatos'):return False
    try:
        with core.connect() as db:
            if method=='GET':result=search(db,parse_qs(urlparse(handler.path).query).get('q',[''])[0]) if path=='/api/busca' else [(contact_view(r) if path=='/api/substituicao-contatos' else dict(r)) for r in db.execute('SELECT * FROM '+('pendencia_acoes' if path=='/api/pendencias-acoes' else 'substituicao_contatos')+' ORDER BY id')]
            elif method=='PUT' and path=='/api/pendencias-acoes':db.execute('BEGIN IMMEDIATE');result=pending_save(db,handler.read_json())
            elif method=='POST' and path=='/api/substituicao-contatos':db.execute('BEGIN IMMEDIATE');result=response_save(db,handler.read_json())
            else:handler.respond(405,{'erro':'Método não permitido.'});return True
        handler.respond(200,result)
    except RuntimeError as e:handler.respond(409,{'erro':str(e)})
    except (ValueError,TypeError,sqlite3.IntegrityError) as e:handler.respond(400,{'erro':str(e)})
    return True
