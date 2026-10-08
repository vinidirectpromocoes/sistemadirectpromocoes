"""Local test implementation of the scoped store portal; production uses guarded Postgres RPCs."""
import json, re, secrets, sqlite3, uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse


def ensure_schema(db):
    db.execute("CREATE TABLE IF NOT EXISTS rede_links(id INTEGER PRIMARY KEY AUTOINCREMENT,rede TEXT NOT NULL COLLATE NOCASE UNIQUE,token TEXT NOT NULL UNIQUE,ativo INTEGER NOT NULL DEFAULT 1,expira_em TEXT NOT NULL,criado_em TEXT NOT NULL,atualizado_em TEXT NOT NULL)")
    if 'codigo' not in [row[1] for row in db.execute('PRAGMA table_info(rede_links)')]:
        db.execute('ALTER TABLE rede_links ADD COLUMN codigo TEXT')
    for row in db.execute('SELECT id FROM rede_links WHERE codigo IS NULL').fetchall():
        db.execute('UPDATE rede_links SET codigo=? WHERE id=?',(secrets.token_urlsafe(12),row[0]))
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS rede_links_codigo ON rede_links(codigo)')
    db.execute("CREATE TABLE IF NOT EXISTS loja_links(id INTEGER PRIMARY KEY AUTOINCREMENT,loja_id INTEGER NOT NULL UNIQUE REFERENCES lojas(id),token TEXT NOT NULL UNIQUE,ativo INTEGER NOT NULL DEFAULT 1,expira_em TEXT NOT NULL,criado_em TEXT NOT NULL,atualizado_em TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS loja_solicitacoes(id INTEGER PRIMARY KEY AUTOINCREMENT,loja_id INTEGER NOT NULL REFERENCES lojas(id),chave TEXT NOT NULL,dados TEXT NOT NULL,estado TEXT NOT NULL DEFAULT 'pendente',pedido_id INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,motivo TEXT NOT NULL DEFAULT '',criado_em TEXT NOT NULL,atualizado_em TEXT NOT NULL,UNIQUE(loja_id,chave))")
    db.execute("CREATE TABLE IF NOT EXISTS loja_validacoes(id INTEGER PRIMARY KEY AUTOINCREMENT,loja_id INTEGER NOT NULL REFERENCES lojas(id),escala_id INTEGER NOT NULL UNIQUE REFERENCES pedido_escalas(id) ON DELETE CASCADE,presenca TEXT NOT NULL,observacao TEXT NOT NULL DEFAULT '',estado TEXT NOT NULL DEFAULT 'pendente',motivo TEXT NOT NULL DEFAULT '',criado_em TEXT NOT NULL,atualizado_em TEXT NOT NULL)")

    for table, fields in {'loja_solicitacoes':('id','loja_id','estado','pedido_id','dados'), 'loja_validacoes':('id','loja_id','escala_id','presenca','estado','observacao')}.items():
        for event in ('INSERT','UPDATE','DELETE'):
            def record(prefix): return 'json_object('+', '.join("'"+f+"', "+prefix+'.'+f for f in fields)+')'
            old=record('OLD') if event!='INSERT' else 'NULL'; new=record('NEW') if event!='DELETE' else 'NULL'; row='OLD.id' if event=='DELETE' else 'NEW.id'
            db.execute(f"CREATE TRIGGER IF NOT EXISTS audit_{table}_{event.lower()} AFTER {event} ON {table} BEGIN INSERT INTO direct_auditoria(tabela,registro_id,operacao,antes,depois) VALUES('{table}',{row},'{event}',{old},{new}); END")


def now(): return datetime.now(timezone.utc).isoformat()


def store_for(db, token):
    if not re.fullmatch('[a-f0-9]{64}', str(token or '')): raise ValueError('Link inválido ou expirado. Peça um novo link à Direct.')
    s=db.execute('SELECT l.* FROM lojas l JOIN loja_links x ON x.loja_id=l.id WHERE x.token=? AND x.ativo=1 AND x.expira_em>?',(token,now())).fetchone()
    if not s: raise ValueError('Link inválido ou expirado. Peça um novo link à Direct.')
    return s


def draft(db, data, store, api):
    payload={**data,'supermercado':store['rede'],'unidade':store['nome'],'situacao':'novo'}
    valid=api.validate_order(payload)
    if not db.execute('SELECT 1 FROM tarifas_setores WHERE lower(setor)=lower(?)',(valid['setor'],)).fetchone(): raise ValueError('Escolha um setor cadastrado.')
    valid['turnos']=json.loads(valid['turnos']);return valid


def review_request(db, id_, data):
    r=db.execute('SELECT r.*,l.rede,l.nome FROM loja_solicitacoes r JOIN lojas l ON l.id=r.loja_id WHERE r.id=?',(id_,)).fetchone()
    if not r or r['estado']!='pendente': raise ValueError('Solicitação já revisada ou inexistente. Atualize a lista.')
    if data['supermercado'].lower()!=r['rede'].lower() or data['unidade'].lower()!=r['nome'].lower(): raise ValueError('A loja precisa corresponder à solicitação recebida.')
    return r


def handle(handler, method, api):
    path=urlparse(handler.path).path
    match=re.fullmatch(r'/api/lojas/(\d+)/link',path)
    networks=path=='/api/redes-links'
    network_external=re.fullmatch(r'/api/rede-portal/(context|orders|submit|check)',path)
    external=re.fullmatch(r'/api/loja-portal/(context|orders|submit|check)',path)
    req=re.fullmatch(r'/api/solicitacoes-lojas/(\d+)',path)
    check=re.fullmatch(r'/api/conferencias-lojas/(\d+)',path)
    listing=path in ('/api/solicitacoes-lojas','/api/conferencias-lojas')
    if not (networks or network_external or match or external or req or check or listing): return False
    try:
        p=handler.read_json() if method!='GET' else {}
        with api.connect() as db:
            if method!='GET': db.execute('BEGIN IMMEDIATE')
            if networks:
                if method=='POST' and p.get('acao','consultar')!='consultar':raise ValueError('O link da rede é fixo e não precisa de renovação.')
                if method not in ('GET','POST'):raise ValueError('Rota indisponível.')
                rows=db.execute('SELECT min(rede) rede,count(*) lojas FROM lojas GROUP BY lower(trim(rede)) ORDER BY rede').fetchall()
                result=[]
                for row in rows:
                    db.execute('INSERT OR IGNORE INTO rede_links(rede,token,codigo,expira_em,criado_em,atualizado_em) VALUES(?,?,?,?,?,?)',(row['rede'],secrets.token_hex(32),secrets.token_urlsafe(12),'',now(),now()))
                    link=db.execute('SELECT * FROM rede_links WHERE lower(trim(rede))=lower(trim(?))',(row['rede'],)).fetchone()
                    result.append({'rede':row['rede'],'lojas':row['lojas'],'codigo':link['codigo'],'token':link['token'] if link['ativo'] else None,'ativo':True,'expira_em':None})
                if method=='POST':
                    result=next((row for row in result if row['rede'].lower()==str(p.get('rede','')).strip().lower()),None)
                    if not result:raise ValueError('Rede sem lojas cadastradas.')
            elif listing and method=='GET':
                table='loja_solicitacoes' if path.endswith('solicitacoes-lojas') else 'loja_validacoes'
                rows=[dict(r) for r in db.execute(f'SELECT * FROM {table} ORDER BY id DESC')]
                if table=='loja_solicitacoes':
                    for r in rows:r['dados']=json.loads(r['dados'])
                else:
                    for r in rows:
                        r['escala']=dict(db.execute('SELECT e.pedido_id,e.data,d.nome as diarista_nome FROM pedido_escalas e JOIN diaristas d ON d.id=e.diarista_id WHERE e.id=?',(r['escala_id'],)).fetchone())
                result=rows
            elif match and method=='POST':
                id_=int(match.group(1));action=p.get('acao','consultar')
                if action not in ('consultar','renovar','revogar'): raise ValueError('Ação inválida.')
                if not db.execute('SELECT 1 FROM lojas WHERE id=?',(id_,)).fetchone(): raise ValueError('Loja não encontrada.')
                db.execute('INSERT OR IGNORE INTO loja_links(loja_id,token,expira_em,criado_em,atualizado_em) VALUES(?,?,?,?,?)',(id_,secrets.token_hex(32),(datetime.now(timezone.utc)+timedelta(days=90)).isoformat(),now(),now()))
                if action=='renovar': db.execute('UPDATE loja_links SET token=?,ativo=1,expira_em=?,atualizado_em=? WHERE loja_id=?',(secrets.token_hex(32),(datetime.now(timezone.utc)+timedelta(days=90)).isoformat(),now(),id_))
                if action=='revogar': db.execute('UPDATE loja_links SET ativo=0,atualizado_em=? WHERE loja_id=?',(now(),id_))
                result=dict(db.execute('SELECT * FROM loja_links WHERE loja_id=?',(id_,)).fetchone())
                if not result['ativo'] or result['expira_em']<=now():result['token']=None
            elif (external or network_external) and method=='POST':
                action=(external or network_external).group(1)
                if network_external:
                    token=p.get('p_token')
                    if not re.fullmatch(r'(?:[A-Za-z0-9_-]{16}|[a-f0-9]{64})',str(token or '')):raise ValueError('Link inválido ou expirado. Peça um novo link à Direct.')
                    link=db.execute('SELECT * FROM rede_links WHERE codigo=? OR (token=? AND ativo=1)',(token,token)).fetchone()
                    if not link:raise ValueError('Link inválido ou expirado. Peça um novo link à Direct.')
                    if action=='context':
                        result={'rede':link['rede'],'lojas':[dict(row) for row in db.execute('SELECT id,rede,nome,endereco,cidade,uf FROM lojas WHERE lower(trim(rede))=lower(trim(?)) ORDER BY nome,cidade',(link['rede'],))],'setores':[row[0] for row in db.execute('SELECT DISTINCT setor FROM tarifas_setores ORDER BY setor')]}
                        handler.respond(200,result);return True
                    s=db.execute('SELECT * FROM lojas WHERE id=? AND lower(trim(rede))=lower(trim(?))',(p.get('p_loja_id'),link['rede'])).fetchone()
                    if not s:raise ValueError('Escolha uma loja desta rede.')
                else:s=store_for(db,p.get('p_token'))
                if action=='context': result={'loja':{k:s[k] for k in ('id','rede','nome','endereco','cidade','uf')},'setores':[r[0] for r in db.execute('SELECT DISTINCT setor FROM tarifas_setores ORDER BY setor')]}
                elif action=='orders':
                    orders=[api.public_order(r) for r in db.execute('SELECT * FROM pedidos WHERE lower(supermercado)=lower(?) AND lower(unidade)=lower(?) ORDER BY id DESC LIMIT 200',(s['rede'],s['nome']))]
                    for o in orders:
                        o['escalas']=[]
                        for e in api.order_scale_rows(db,o['id']):
                            conf=db.execute('SELECT presenca,estado FROM loja_validacoes WHERE escala_id=?',(e['id'],)).fetchone()
                            o['escalas'].append({'id':e['id'],'data':e['data'],'nome':e['diarista_nome'],'status':e['status'],'confirmacao':e.get('confirmacao'),'conferencia':dict(conf) if conf else None})
                        for key in tuple(o):
                            if key not in ('id','setor','quantidade_diaristas','turnos','situacao','escalas'):del o[key]
                    requests=[dict(r) for r in db.execute('SELECT id,dados,estado,pedido_id,motivo,criado_em FROM loja_solicitacoes WHERE loja_id=? ORDER BY id DESC LIMIT 200',(s['id'],))]
                    for r in requests:r['dados']=json.loads(r['dados'])
                    result={'pedidos':orders,'solicitacoes':requests}
                elif action=='submit':
                    data=draft(db,p.get('p_dados'),s,api);key=str(uuid.UUID(p.get('p_chave','')))
                    old=db.execute('SELECT * FROM loja_solicitacoes WHERE loja_id=? AND chave=?',(s['id'],key)).fetchone()
                    if old:
                        if json.loads(old['dados'])!=data:raise ValueError('Esta solicitação já foi enviada com outros dados.')
                        result={'id':old['id'],'estado':old['estado']}
                    else:
                        today=datetime.now(api.FORTALEZA).date()
                        if any(not today<=datetime.strptime(t['data'],'%Y-%m-%d').date()<=today+timedelta(days=366) for t in data['turnos']):raise ValueError('Envie datas de hoje até um ano à frente.')
                        if db.execute('SELECT count(*) FROM loja_solicitacoes WHERE loja_id=? AND criado_em>?',(s['id'],(datetime.now(timezone.utc)-timedelta(days=1)).isoformat())).fetchone()[0]>=60:raise ValueError('Limite de solicitações atingido. Fale com a Direct.')
                        cur=db.execute('INSERT INTO loja_solicitacoes(loja_id,chave,dados,criado_em,atualizado_em) VALUES(?,?,?,?,?)',(s['id'],key,json.dumps(data,ensure_ascii=False),now(),now()));result={'id':cur.lastrowid,'estado':'pendente'}
                else:
                    e=db.execute("SELECT e.* FROM pedido_escalas e JOIN pedidos o ON o.id=e.pedido_id WHERE e.id=? AND lower(o.supermercado)=lower(?) AND lower(o.unidade)=lower(?) AND o.situacao<>'cancelado'",(p.get('p_escala_id'),s['rede'],s['nome'])).fetchone()
                    if not e or e['status']=='desistiu':raise ValueError('Atendimento não disponível nesta loja.')
                    if e['data']>datetime.now(api.FORTALEZA).date().isoformat():raise ValueError('Confira o atendimento após o dia da diária.')
                    status=p.get('p_presenca');obs=api.clean_text(p.get('p_observacao',''),'a observação',500,False)
                    if status not in ('presente','falta'):raise ValueError('Conferência inválida.')
                    old=db.execute('SELECT * FROM loja_validacoes WHERE escala_id=?',(e['id'],)).fetchone()
                    if old and old['estado']=='aplicada':raise ValueError('Conferência já aplicada. Fale com a Direct para corrigir.')
                    db.execute("INSERT INTO loja_validacoes(loja_id,escala_id,presenca,observacao,criado_em,atualizado_em) VALUES(?,?,?,?,?,?) ON CONFLICT(escala_id) DO UPDATE SET presenca=excluded.presenca,observacao=excluded.observacao,estado='pendente',motivo='',atualizado_em=excluded.atualizado_em",(s['id'],e['id'],status,obs,now(),now()))
                    result={'id':db.execute('SELECT id FROM loja_validacoes WHERE escala_id=?',(e['id'],)).fetchone()[0],'estado':'pendente'}
            elif req and method=='PATCH':
                reason=api.clean_text(p.get('motivo'),'o motivo',500)
                if len(reason)<8:raise ValueError('Explique a recusa (8 a 500 caracteres).')
                cur=db.execute("UPDATE loja_solicitacoes SET estado='recusada',motivo=?,atualizado_em=? WHERE id=? AND estado='pendente'",(reason,now(),int(req.group(1))))
                if not cur.rowcount:raise ValueError('Solicitação já revisada ou inexistente.')
                result={'ok':True}
            elif check and method=='PATCH':
                v=db.execute('SELECT * FROM loja_validacoes WHERE id=?',(int(check.group(1)),)).fetchone()
                if not v or v['estado']!='pendente':raise ValueError('Conferência já revisada ou inexistente.')
                if not isinstance(p.get('aceitar'),bool):raise ValueError('Escolha aplicar ou recusar.')
                if p['aceitar']:
                    e=db.execute('SELECT * FROM pedido_escalas WHERE id=?',(v['escala_id'],)).fetchone()
                    o=db.execute('SELECT * FROM pedidos WHERE id=?',(e['pedido_id'],)).fetchone()
                    s=db.execute('SELECT * FROM lojas WHERE id=?',(v['loja_id'],)).fetchone()
                    if o['situacao']=='cancelado' or o['supermercado'].lower()!=s['rede'].lower() or o['unidade'].lower()!=s['nome'].lower():raise ValueError('Pedido/escala mudou. Revise a conferência.')
                    api.apply_local_attendance(db,e['pedido_id'],e['id'],{'status':v['presenca'],'motivo':v['observacao'][:300] if len(v['observacao'].strip())>=5 else 'Falta informada pela loja no link privado'})
                    if v['presenca']=='presente': db.execute("UPDATE pedido_escalas SET loja_validacao=?,loja_responsavel='Conferência por link da loja',loja_observacao=? WHERE id=?",('validado' if v['presenca']=='presente' else 'divergencia',v['observacao'],e['id']))
                    db.execute("UPDATE loja_validacoes SET estado='aplicada',atualizado_em=? WHERE id=?",(now(),v['id']));result={'ok':True,'pedido_id':e['pedido_id']}
                else:
                    reason=api.clean_text(p.get('motivo'),'o motivo',500)
                    if len(reason)<8:raise ValueError('Explique a recusa (8 a 500 caracteres).')
                    db.execute("UPDATE loja_validacoes SET estado='recusada',motivo=?,atualizado_em=? WHERE id=?",(reason,now(),v['id']));result={'ok':True}
            else:raise ValueError('Rota indisponível.')
        handler.respond(200,result)
    except (ValueError,TypeError,json.JSONDecodeError,sqlite3.IntegrityError) as e:handler.respond(400,{'erro':str(e)})
    return True
