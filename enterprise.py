"""Typed business records and transactions for the loopback development API.

No external provider, bank transfer or outbound messaging. Published execution
uses the corresponding PostgreSQL RPCs and database authorization.
"""
import hashlib
import json
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SCHEMA=json.loads((Path(__file__).parent/'static/enterprise-schema.json').read_text())
ENTITIES=SCHEMA['entities']
NATIVE={'pedido':'pedidos','diarista':'diaristas','loja':'lojas','cobranca':'cobrancas'}
RELATIONS=('cliente_id','campanha_id','pedido_id','diarista_id','loja_id')
IMMUTABLE={'movimento':{'registrado'},'movimento_caixa':{'registrado'},'orcamento':{'aprovado'},'ciencia':{'confirmado'},'leitura_aviso':{'lido'},'briefing':{'publicado'},'proposta':{'enviada','aprovada','perdida','convertida'},'checklist':{'concluido'},'fechamento':{'fechado'},'relatorio':{'aprovado'},'pagamento_revisao':{'registrado'}}

def company_today():return datetime.now(ZoneInfo('America/Fortaleza')).date()

def now():return datetime.now(timezone.utc).isoformat()

def ensure_schema(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS direct_staff(email TEXT PRIMARY KEY,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS empresa_registros(
      id INTEGER PRIMARY KEY AUTOINCREMENT,tipo TEXT NOT NULL,titulo TEXT NOT NULL,
      status TEXT NOT NULL,dados TEXT NOT NULL,cliente_id INTEGER REFERENCES empresa_registros(id),
      campanha_id INTEGER REFERENCES empresa_registros(id),pedido_id INTEGER REFERENCES pedidos(id),
      diarista_id INTEGER REFERENCES diaristas(id),loja_id INTEGER REFERENCES lojas(id),
      chave TEXT NOT NULL UNIQUE,versao INTEGER NOT NULL DEFAULT 1,autor TEXT NOT NULL,
      criado_em TEXT NOT NULL,atualizado_em TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS empresa_tipo_cliente ON empresa_registros(tipo,cliente_id,id);
    CREATE INDEX IF NOT EXISTS empresa_pedido ON empresa_registros(pedido_id,tipo);
    CREATE INDEX IF NOT EXISTS empresa_campanha ON empresa_registros(campanha_id,tipo);
    CREATE INDEX IF NOT EXISTS empresa_diarista ON empresa_registros(diarista_id,tipo);
    CREATE TABLE IF NOT EXISTS empresa_extrato(
      id INTEGER PRIMARY KEY AUTOINCREMENT,conta_id INTEGER NOT NULL REFERENCES empresa_registros(id),
      chave TEXT NOT NULL UNIQUE,data TEXT NOT NULL,valor_centavos INTEGER NOT NULL,
      descricao TEXT NOT NULL,identificador TEXT NOT NULL DEFAULT '',estado TEXT NOT NULL DEFAULT 'pendente',
      destino_tipo TEXT,destino_id INTEGER,motivo TEXT NOT NULL DEFAULT '',versao INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL,atualizado_em TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS empresa_extrato_conta_data ON empresa_extrato(conta_id,data,id);
    CREATE TABLE IF NOT EXISTS empresa_anexos(
      id INTEGER PRIMARY KEY AUTOINCREMENT,registro_id INTEGER NOT NULL REFERENCES empresa_registros(id),
      nome TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,caminho TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,criado_em TEXT NOT NULL,autor TEXT NOT NULL);
    ''')
    columns={r['name'] for r in db.execute('PRAGMA table_info(financeiro_lancamentos)')}
    if 'empresa_registro_id' not in columns:db.execute('ALTER TABLE financeiro_lancamentos ADD COLUMN empresa_registro_id INTEGER REFERENCES empresa_registros(id)')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS financeiro_empresa_unico ON financeiro_lancamentos(empresa_registro_id) WHERE empresa_registro_id IS NOT NULL')
    db.executescript("""
    CREATE TRIGGER IF NOT EXISTS empresa_finance_guard_update BEFORE UPDATE ON financeiro_lancamentos WHEN OLD.empresa_registro_id IS NOT NULL BEGIN
     SELECT CASE WHEN NEW.empresa_registro_id IS NOT OLD.empresa_registro_id OR NEW.tipo<>OLD.tipo OR NEW.valor_centavos<>OLD.valor_centavos OR NEW.vencimento<>OLD.vencimento OR NEW.categoria<>OLD.categoria OR NEW.contraparte<>OLD.contraparte OR NEW.descricao<>OLD.descricao THEN RAISE(ABORT,'Preserve os dados da despesa aprovada.') END;
     SELECT CASE WHEN EXISTS(SELECT 1 FROM empresa_extrato WHERE destino_tipo='lancamento' AND destino_id=OLD.id AND estado='conciliado') AND (NEW.data_pagamento IS NOT OLD.data_pagamento OR NEW.forma_pagamento<>OLD.forma_pagamento) THEN RAISE(ABORT,'Pagamento já conciliado; preserve a conferência.') END;
    END;
    CREATE TRIGGER IF NOT EXISTS empresa_finance_guard_delete BEFORE DELETE ON financeiro_lancamentos WHEN OLD.empresa_registro_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Preserve a despesa aprovada e seu lançamento.');END;
    CREATE TRIGGER IF NOT EXISTS empresa_finance_sync AFTER UPDATE ON financeiro_lancamentos WHEN NEW.empresa_registro_id IS NOT NULL BEGIN
     UPDATE empresa_registros SET status=CASE WHEN NEW.data_pagamento IS NULL THEN 'aprovada' ELSE 'paga' END,dados=CASE WHEN NEW.data_pagamento IS NULL THEN json_remove(dados,'$.data_pagamento','$.forma') ELSE json_set(dados,'$.data_pagamento',NEW.data_pagamento,'$.forma',NEW.forma_pagamento) END,versao=versao+1,atualizado_em=NEW.atualizado_em WHERE id=NEW.empresa_registro_id AND (status IS NOT CASE WHEN NEW.data_pagamento IS NULL THEN 'aprovada' ELSE 'paga' END OR json_extract(dados,'$.data_pagamento') IS NOT NEW.data_pagamento OR coalesce(json_extract(dados,'$.forma'),'')<>NEW.forma_pagamento);
    END;
    """)
    for table in ('empresa_registros','empresa_extrato','empresa_anexos'):
        cols=[r['name'] for r in db.execute('PRAGMA table_info('+table+')')]
        for event in ('INSERT','UPDATE','DELETE'):
            old='json_object('+','.join("'"+c+"',OLD."+c for c in cols)+')' if event!='INSERT' else 'NULL'
            new='json_object('+','.join("'"+c+"',NEW."+c for c in cols)+')' if event!='DELETE' else 'NULL'
            db.execute(f"CREATE TRIGGER IF NOT EXISTS audit_{table}_{event.lower()} AFTER {event} ON {table} BEGIN INSERT INTO direct_auditoria(tabela,registro_id,operacao,antes,depois) VALUES('{table}',{'OLD' if event=='DELETE' else 'NEW'}.id,'{event}',{old},{new}); END")
    import enterprise_actions
    enterprise_actions.schema(db)
    for name in ('Transporte','Alimentação','Materiais','Administração'):
        key='seed:categoria:'+name
        if not db.execute('SELECT 1 FROM empresa_registros WHERE chave=?',(key,)).fetchone():
            db.execute('INSERT INTO empresa_registros(tipo,titulo,status,dados,chave,autor,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?)',('categoria',name,'ativo',json.dumps({'tipo':'despesa','centro_custo':'Serviços' if name!='Administração' else 'Administração'}),key,'Sistema',now(),now()))
    for row in db.execute('SELECT DISTINCT rede FROM lojas').fetchall():
        key='seed:rede:'+row['rede']
        if not db.execute('SELECT 1 FROM empresa_registros WHERE chave=?',(key,)).fetchone():
            db.execute('INSERT INTO empresa_registros(tipo,titulo,status,dados,chave,autor,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?)',('rede',row['rede'],'ativo','{"tipo":"supermercado"}',key,'Sistema',now(),now()))

def view(row):
    if not row:return None
    result=dict(row)
    result['dados']=json.loads(result['dados'])
    return result

def get(db,id,kind=None):
    row=db.execute('SELECT * FROM empresa_registros WHERE id=?',(id,)).fetchone()
    if not row or kind and row['tipo']!=kind:raise ValueError('Registro relacionado não encontrado. Atualize e confira.')
    return view(row)

def validate(p,db,role='admin'):
    if not isinstance(p,dict) or p.get('tipo') not in ENTITIES:raise ValueError('Tipo de registro inválido.')
    spec=ENTITIES[p['tipo']]
    if role not in spec['write']:raise PermissionError('Seu perfil não pode alterar esta informação.')
    title=p.get('titulo');state=p.get('status',spec['statuses'][0]);raw=p.get('dados',{})
    if not isinstance(title,str) or not 1<=len(title.strip())<=180:raise ValueError('Informe um título de até 180 caracteres.')
    if state not in spec['statuses'] or not isinstance(raw,dict):raise ValueError('Situação ou dados inválidos.')
    fields={f['name']:f for f in spec['fields']}
    if set(raw)-set(fields):raise ValueError('Há campos não reconhecidos neste formulário.')
    out={}
    for name,f in fields.items():
        value=raw.get(name)
        if value in (None,'',[]):
            if f['required']:raise ValueError('Preencha '+f['label']+'.')
            continue
        t=f['type']
        if t in ('integer','money','ref'):
            if not isinstance(value,int) or isinstance(value,bool) or value<f.get('min',1) or value>f.get('max',9007199254740991):raise ValueError('Valor inválido: '+f['label']+'.')
        elif t in ('lines','ids','answers'):
            if not isinstance(value,list) or len(value)>100:raise ValueError('Confira '+f['label']+'.')
            if t=='ids' and (len(set(value))!=len(value) or any(not isinstance(v,int) or isinstance(v,bool) or v<1 for v in value)):raise ValueError('Lista de diárias inválida.')
            if t=='lines' and any(not isinstance(v,str) or not 1<=len(v.strip())<=500 for v in value):raise ValueError('Perguntas inválidas.')
            if t=='answers' and any(not isinstance(v,dict) or set(v)-{'pergunta','resposta'} or not isinstance(v.get('pergunta'),str) or not isinstance(v.get('resposta'),str) or len(v['pergunta'])>500 or len(v['resposta'])>2000 for v in value):raise ValueError('Respostas inválidas.')
        else:
            if not isinstance(value,str) or len(value)>f.get('maxLength',4000 if t=='textarea' else 180):raise ValueError('Confira '+f['label']+'.')
            value=value.strip()
            if t=='choice' and value not in f['options']:raise ValueError('Opção inválida: '+f['label']+'.')
            if t=='date':date.fromisoformat(value)
            if t=='datetime':
                parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
                if parsed.tzinfo is None:raise ValueError('Informe data/hora com fuso horário.')
            if t=='time' and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',value):raise ValueError('Horário inválido.')
            if t=='email' and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',value):raise ValueError('E-mail inválido.')
        if t=='ref':
            target=f['target']
            if target in NATIVE:
                if not db.execute('SELECT 1 FROM '+NATIVE[target]+' WHERE id=?',(value,)).fetchone():raise ValueError('Confira '+f['label']+'.')
            else:get(db,value,target)
        out[name]=value
    for a,b in [('inicio','fim')]:
        if a in out and b in out and out[a]>out[b]:raise ValueError('O início deve ocorrer antes do fim.')
    if 'campanha_id' in out:
        parent=get(db,out['campanha_id'],'campanha');cid=parent['dados']['cliente_id']
        if out.get('cliente_id') and out['cliente_id']!=cid:raise ValueError('O cliente deve ser o contratante da campanha.')
        out['cliente_id']=cid
    return p['tipo'],title.strip(),state,out

def all_records(db,kind=None):
    rows=db.execute('SELECT * FROM empresa_registros'+(' WHERE tipo=?' if kind else '')+' ORDER BY id', (kind,) if kind else ()).fetchall()
    return [view(r) for r in rows]

def json_fields(data,spec):
    return {f['name']:data[f['name']] for f in spec['fields'] if f['name'] in data}

def stock(db,id):
    material=get(db,id,'material');balance=material['dados']['quantidade_inicial']
    for r in db.execute("SELECT dados FROM empresa_registros WHERE tipo='movimento' AND json_extract(dados,'$.material_id')=?",(id,)):
        d=json.loads(r[0]);balance+=d['quantidade']*(1 if d['tipo'] in ('entrada','devolucao') else -1)
    return balance

def closing_issues(db,d):
    where=['s.data=?',"p.situacao<>'cancelado'"];args=[d['data']]
    if d.get('pedido_id'):where.append('p.id=?');args.append(d['pedido_id'])
    if d.get('campanha_id'):where.append("exists(select 1 from empresa_registros v where v.tipo='vinculo' and v.pedido_id=p.id and v.campanha_id=?)");args.append(d['campanha_id'])
    if d.get('cliente_id'):where.append("exists(select 1 from empresa_registros v where v.tipo='vinculo' and v.pedido_id=p.id and v.cliente_id=?)");args.append(d['cliente_id'])
    scope=' AND '.join(where)
    pending=db.execute("SELECT count(*) FROM pedido_escalas s JOIN pedidos p ON p.id=s.pedido_id WHERE "+scope+" AND s.status='escalada'",args).fetchone()[0]
    values=db.execute("SELECT count(*) FROM diarias d JOIN pedido_escalas s ON s.id=d.pedido_escala_id JOIN pedidos p ON p.id=s.pedido_id WHERE "+scope+" AND (d.valor_centavos IS NULL OR d.valor_recebido_centavos IS NULL)",args).fetchone()[0]
    orders=dashboard(db,{'inicio':[d['data']],'fim':[d['data']],**{k:[str(d[k])] for k in ('cliente_id','campanha_id') if d.get(k)}},role='consulta')['pedidos']
    scope_orders=[r['id'] for r in orders if not d.get('pedido_id') or r['id']==d['pedido_id']];ids=','.join('?' for _ in scope_orders) or 'NULL'
    vacancies=0
    for oid in scope_orders:
        order=db.execute('SELECT quantidade_diaristas,turnos FROM pedidos WHERE id=?',(oid,)).fetchone()
        demand=sum(order['quantidade_diaristas'] for t in json.loads(order['turnos']) if t['data']==d['data'])
        assigned=db.execute("SELECT count(*) FROM pedido_escalas WHERE pedido_id=? AND data=? AND status NOT IN ('falta','desistiu')",(oid,d['data'])).fetchone()[0]
        vacancies+=max(0,demand-assigned)
    occurrences=db.execute("SELECT count(*) FROM ocorrencias WHERE estado='aberta' AND pedido_id IN ("+ids+')',scope_orders).fetchone()[0]
    checks=db.execute("SELECT count(*) FROM loja_validacoes v JOIN pedido_escalas s ON s.id=v.escala_id WHERE v.estado='pendente' AND s.data=? AND s.pedido_id IN ("+ids+')',(d['data'],*scope_orders)).fetchone()[0]
    return {'vagas_pendentes':vacancies,'presencas_pendentes':pending,'valores_incompletos':values,'ocorrencias_abertas':occurrences,'conferencias_loja':checks}

def business(db,kind,state,d,old,role):
    if old and old['status'] in IMMUTABLE.get(kind,set()):
        allowed={'proposta':{'enviada':{'enviada','aprovada','perdida'},'aprovada':{'aprovada'},'perdida':{'perdida'},'convertida':{'convertida'}}}.get(kind,{}).get(old['status'],{old['status']})
        if state not in allowed or json_fields(old['dados'],ENTITIES[kind])!=json_fields(d,ENTITIES[kind]):raise ValueError('Esta versão está preservada. Crie uma nova versão para corrigir.')
    if kind=='movimento_caixa' and d['valor_centavos']<=0:raise ValueError('Informe um valor maior que zero.')
    if kind=='relatorio' and state=='aprovado' and not d.get('aprovado_por'):raise ValueError('Registre quem revisou o relatório.')
    if kind=='feedback' and not 1<=d['nota']<=5:raise ValueError('A nota deve ficar entre 1 e 5.')
    if kind=='tarefa' and state=='concluida' and len(d.get('resolucao',''))<5:raise ValueError('Registre a resolução da tarefa.')
    if kind=='visita' and state=='realizada' and not d.get('resultado'):raise ValueError('Registre o resultado da visita.')
    if kind=='fechamento' and state=='fechado':
        if d['data']>company_today().isoformat():raise ValueError('Feche somente um dia já iniciado.')
        d['pendencias']=closing_issues(db,d)
        if any(d['pendencias'].values()) and len(d.get('justificativa',''))<8:raise ValueError('Há pendências. Resolva ou registre uma justificativa com pelo menos 8 caracteres.')
    if kind=='ciencia' and get(db,d['briefing_id'],'briefing')['status']!='publicado':raise ValueError('Confirme uma versão publicada das orientações.')
    if kind=='checklist':
        template=get(db,d['modelo_id'],'checklist_modelo')['dados']['perguntas'];answers={a['pergunta']:a['resposta'].strip() for a in d['respostas']}
        if any(a['pergunta'] not in template for a in d['respostas']) or len(answers)!=len(d['respostas']):raise ValueError('Respostas não correspondem ao modelo.')
        if state=='concluido':
            for q in template:
                condition=re.search(r'\[se (.+?)=(.+?)\]',q)
                applicable=not condition or answers.get(condition[1].strip(),'').lower()==condition[2].strip().lower()
                if q.startswith('*') and applicable and not answers.get(q):raise ValueError('Responda todas as perguntas obrigatórias aplicáveis.')
        d['perguntas_snapshot']=template
    if kind=='amostra':
        balance=d['saldo_inicial']+d['recebidas']-d['distribuidas']-d['perdas']-d['devolvidas']
        if balance<0:raise ValueError('Distribuição, perdas e devoluções excedem as unidades disponíveis.')
        if d.get('vendas') and not d.get('fonte_vendas'):raise ValueError('Informe a origem das vendas observadas.')
        d['saldo_final']=balance
    if kind=='movimento' and not old:
        if d['quantidade']<=0:raise ValueError('Informe uma quantidade maior que zero.')
        if d['tipo'] not in ('entrada','devolucao') and d['quantidade']>stock(db,d['material_id']):raise ValueError('Saldo insuficiente do material.')
        if d.get('lote_id'):
            lot=get(db,d['lote_id'],'lote')
            if lot['dados']['material_id']!=d['material_id']:raise ValueError('O lote pertence a outro material.')
            if d['tipo'] in ('entrega','consumo') and lot['dados']['validade']<d['data']:raise ValueError('O lote está vencido para esta saída.')
        if d['tipo']=='devolucao':
            held=0
            for r in all_records(db,'movimento'):
                v=r['dados']
                if v['material_id']==d['material_id'] and v.get('diarista_id')==d.get('diarista_id') and v.get('campanha_id')==d.get('campanha_id'):
                    held+=v['quantidade']*(1 if v['tipo']=='entrega' else -1 if v['tipo']=='devolucao' else 0)
            if d['quantidade']>held:raise ValueError('A devolução excede o material entregue a esta pessoa/campanha.')
    if kind=='material' and old and old['dados']['quantidade_inicial']!=d['quantidade_inicial']:
        if db.execute("SELECT 1 FROM empresa_registros WHERE tipo='movimento' AND json_extract(dados,'$.material_id')=?",(old['id'],)).fetchone():raise ValueError('Preserve o saldo inicial após movimentações. Registre uma entrada ou perda.')
    if kind=='despesa':
        if d['valor_centavos']<=0:raise ValueError('Informe um valor maior que zero.')
        if get(db,d['categoria_id'],'categoria')['dados']['tipo']!='despesa':raise ValueError('Escolha uma categoria de despesa.')
        if state in ('aprovada','recusada','paga') and role not in ('admin','financeiro'):raise PermissionError('Somente Financeiro/Admin pode revisar ou pagar despesas.')
        if not old and state not in ('rascunho','enviada'):raise ValueError('Envie a despesa antes de aprovar.')
        if old:
            transitions={'rascunho':{'rascunho','enviada'},'enviada':{'enviada','aprovada','recusada'},'recusada':{'recusada','rascunho','enviada'},'aprovada':{'aprovada','paga'},'paga':{'paga'}}
            if state not in transitions[old['status']]:raise ValueError('Transição de despesa inválida.')
            if old['status'] in ('aprovada','paga') and any(old['dados'].get(k)!=d.get(k) for k in ('valor_centavos','categoria_id','data','vencimento','contraparte','pedido_id','campanha_id','cliente_id')):raise ValueError('Preserve a despesa aprovada. Correções precisam de registro financeiro separado.')
        if state=='recusada' and len(d.get('motivo',''))<5:raise ValueError('Explique a recusa.')
        if state=='paga' and (not d.get('data_pagamento') or not d.get('forma')):raise ValueError('Informe data e forma do pagamento.')
    if kind=='pagamento_revisao':
        if state=='registrado':raise ValueError('Use Registrar pagamento para concluir uma conferência aprovada.')
        daily=list(db.execute('SELECT id,diarista_id,valor_centavos,data_pagamento FROM diarias WHERE id IN ('+','.join('?'*len(d['diaria_ids']))+')',d['diaria_ids']))
        if len(daily)!=len(d['diaria_ids']) or any(r['diarista_id']!=d['diarista_id'] or r['valor_centavos'] is None or r['data_pagamento'] for r in daily):raise ValueError('Confira beneficiário e diárias pendentes com valores completos.')
        snapshot=[dict(r) for r in sorted(daily,key=lambda r:r['id'])]
        if state=='aprovado' and (not old or old['status']!='preparado' or old['dados'].get('diarias_snapshot')!=snapshot):raise ValueError('Prepare novamente: as diárias mudaram ou não foram conferidas.')
        d['valor_conferido_centavos']=sum(r['valor_centavos'] for r in daily)
        d['diarias_snapshot']=snapshot
    if kind=='proposta':
        if not 1<=d['dias']<=90 or not 1<=d['pessoas']<=100 or d['hora_inicio']>=d['hora_fim']:raise ValueError('Confira dias, pessoas e horário da proposta.')
        if not old and state!='rascunho':raise ValueError('Prepare a proposta antes de enviá-la.')
        if state=='convertida':raise ValueError('Utilize Gerar pedido para converter a proposta aprovada.')
        d['receita_prevista_centavos']=d['dias']*d['pessoas']*d['valor_unitario_centavos']
        d['custo_previsto_centavos']=d['dias']*d['pessoas']*d['custo_unitario_centavos']+d['extras_centavos']
    return d

def save(db,p,role='admin',actor='Servidor local'):
    kind,title,state,d=validate(p,db,role)
    id=p.get('id');old=get(db,id,kind) if id else None
    if old and old['versao']!=p.get('versao'):raise RuntimeError('Outra pessoa alterou este registro. Atualize e compare antes de salvar.')
    key=p.get('chave','')
    if not old and not re.fullmatch(r'[A-Za-z0-9:_-]{8,180}',key):raise ValueError('Chave de envio inválida.')
    existing=db.execute('SELECT * FROM empresa_registros WHERE chave=?',(key,)).fetchone() if not old else None
    if existing:
        prev=view(existing)
        if (kind,title,state,json_fields(d,ENTITIES[kind]))!=(prev['tipo'],prev['titulo'],prev['status'],json_fields(prev['dados'],ENTITIES[kind])):raise RuntimeError('Este envio já foi registrado com outros dados.')
        return prev
    if old and old['status'] in IMMUTABLE.get(kind,set()) and title!=old['titulo']:raise ValueError('Esta versão está preservada. Crie uma nova versão para corrigir.')
    if kind=='rede' and old and title!=old['titulo'] and db.execute('SELECT 1 FROM lojas WHERE rede=?',(old['titulo'],)).fetchone():raise ValueError('Preserve o nome da rede vinculada às lojas e links existentes.')
    if kind=='leitura_aviso':d['autor']=actor
    if kind=='acesso':
        employee=db.execute('SELECT 1 FROM direct_staff WHERE lower(email)=lower(?) AND active',(d['email'],)).fetchone()
        if not employee:raise ValueError('Escolha um funcionário ativo cadastrado.')
    unique=ENTITIES[kind].get('unique',[])
    if unique:
        for candidate in all_records(db,kind):
            if candidate['id']!=id and all(candidate['dados'].get(k)==d.get(k) for k in unique):
                if kind=='leitura_aviso':return candidate
                raise RuntimeError('Este vínculo já existe. Abra o registro atual.')
    d=business(db,kind,state,d,old,role)
    values=[d.get(k) for k in RELATIONS];stamp=now()
    if old:
        db.execute('UPDATE empresa_registros SET titulo=?,status=?,dados=?,cliente_id=?,campanha_id=?,pedido_id=?,diarista_id=?,loja_id=?,versao=versao+1,atualizado_em=? WHERE id=?',(title,state,json.dumps(d,ensure_ascii=False),*values,stamp,id))
    else:
        id=db.execute('INSERT INTO empresa_registros(tipo,titulo,status,dados,cliente_id,campanha_id,pedido_id,diarista_id,loja_id,chave,autor,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(kind,title,state,json.dumps(d,ensure_ascii=False),*values,key,actor,stamp,stamp)).lastrowid
    if kind=='despesa' and state in ('aprovada','paga'):
        category=get(db,d['categoria_id'],'categoria')['titulo']
        db.execute('''INSERT OR IGNORE INTO financeiro_lancamentos(tipo,descricao,categoria,contraparte,valor_centavos,vencimento,data_pagamento,forma_pagamento,observacoes,criado_em,atualizado_em,empresa_registro_id)
          VALUES('despesa',?,?,?,?,?,?,?,?,?,?,?)''',(title,category,d['contraparte'],d['valor_centavos'],d['vencimento'],d.get('data_pagamento'),d.get('forma',''),d['justificativa'],stamp,stamp,id))
        if state=='paga':db.execute('UPDATE financeiro_lancamentos SET data_pagamento=?,forma_pagamento=?,atualizado_em=? WHERE empresa_registro_id=?',(d['data_pagamento'],d['forma'],stamp,id))
    return get(db,id)

def listing(db,q,role='admin'):
    kind=q.get('tipo',[''])[0]
    if kind not in ENTITIES or role not in ENTITIES[kind]['read']:raise PermissionError('Seu perfil não pode consultar esta área.')
    page=max(1,int(q.get('pagina',['1'])[0]));size=min(50,max(1,int(q.get('tamanho',['25'])[0])));search=q.get('busca',[''])[0].strip()
    cond=['tipo=?'];args=[kind]
    if search:cond.append('(titulo LIKE ? OR dados LIKE ?)');args.extend(['%'+search+'%']*2)
    for field in ('status','cliente_id','campanha_id','pedido_id'):
        value=q.get(field,[''])[0]
        if value:cond.append(field+'=?');args.append(value)
    where=' AND '.join(cond);total=db.execute('SELECT count(*) FROM empresa_registros WHERE '+where,args).fetchone()[0]
    items=[view(r) for r in db.execute('SELECT * FROM empresa_registros WHERE '+where+' ORDER BY id DESC LIMIT ? OFFSET ?',(*args,size,(page-1)*size))]
    return dict(items=items,total=total,pagina=page,tamanho=size)

def options(db,kind,search='',selected=None):
    if kind in NATIVE:
        table=NATIVE[kind];cols={'pedido':"id,'Pedido #'||id||' · '||supermercado||' · '||unidade titulo",'diarista':'id,nome titulo','loja':"id,rede||' · '||nome titulo",'cobranca':"id,'Cobrança #'||id||' · '||rede titulo"}[kind]
        expr={'pedido':"cast(id AS TEXT)||' '||supermercado||' '||unidade",'diarista':"nome||' '||cpf",'loja':"rede||' '||nome",'cobranca':"cast(id AS TEXT)||' '||rede"}[kind]
        if selected:return [dict(r) for r in db.execute('SELECT '+cols+' FROM '+table+' WHERE id=?',(int(selected),))]
        return [dict(r) for r in db.execute('SELECT '+cols+' FROM '+table+' WHERE '+expr+' LIKE ? ORDER BY id DESC LIMIT 100',('%'+search+'%',))]
    if kind not in ENTITIES:raise ValueError('Tipo de busca inválido.')
    if selected:return [dict(r) for r in db.execute('SELECT id,titulo,status FROM empresa_registros WHERE tipo=? AND id=?',(kind,int(selected)))]
    return [dict(r) for r in db.execute("SELECT id,titulo,status FROM empresa_registros WHERE tipo=? AND status NOT IN ('arquivado','cancelada') AND titulo LIKE ? ORDER BY titulo LIMIT 100",(kind,'%'+search+'%'))]

def period(q):
    today=company_today();start=q.get('inicio',[today.replace(day=1).isoformat()])[0];end=q.get('fim',[today.isoformat()])[0]
    if date.fromisoformat(start)>date.fromisoformat(end) or (date.fromisoformat(end)-date.fromisoformat(start)).days>366:raise ValueError('Escolha um período de até 366 dias em ordem crescente.')
    return start,end

def dashboard(db,q,role='admin'):
    start,end=period(q);client=q.get('cliente_id',[''])[0];camp=q.get('campanha_id',[''])[0]
    scope='';args=[]
    for field,column in [('rede','supermercado'),('loja','unidade'),('setor','setor')]:
        if q.get(field,[''])[0]:scope+=' AND p.'+column+'=?';args.append(q[field][0])
    if camp:scope+=" AND exists(select 1 from empresa_registros v where v.tipo='vinculo' and v.pedido_id=p.id and v.campanha_id=?)";args.append(int(camp))
    elif client:scope+=" AND exists(select 1 from empresa_registros v where v.tipo='vinculo' and v.pedido_id=p.id and v.cliente_id=?)";args.append(int(client))
    orders=[dict(r) for r in db.execute("SELECT p.id,p.supermercado,p.unidade,p.setor,p.quantidade_diaristas,p.turnos,p.situacao FROM pedidos p WHERE p.situacao<>'cancelado'"+scope,args)]
    demand=sum(o['quantidade_diaristas'] for o in orders for t in json.loads(o['turnos']) if start<=t['data']<=end)
    scale_sql=" FROM pedido_escalas s JOIN pedidos p ON p.id=s.pedido_id WHERE s.data BETWEEN ? AND ? AND p.situacao<>'cancelado'"+scope
    scales=[dict(r) for r in db.execute('SELECT s.id,s.pedido_id,s.diarista_id,s.data,s.status,s.confirmacao'+scale_sql,(start,end,*args))]
    daily=db.execute('SELECT coalesce(sum(d.valor_recebido_centavos),0) receita,coalesce(sum(d.valor_centavos),0) custo,count(*) diarias,sum(CASE WHEN d.valor_recebido_centavos IS NULL OR d.valor_centavos IS NULL THEN 1 ELSE 0 END) incompletos FROM diarias d JOIN pedido_escalas s ON s.id=d.pedido_escala_id JOIN pedidos p ON p.id=s.pedido_id WHERE d.data BETWEEN ? AND ?'+scope,(start,end,*args)).fetchone()
    result={'inicio':start,'fim':end,'gerado_em':now(),'demanda':demand,'preenchidas':sum(s['status'] not in ('falta','desistiu') for s in scales),'presencas':sum(s['status']=='presente' for s in scales),'faltas':sum(s['status']=='falta' for s in scales),'presencas_pendentes':sum(s['status']=='escalada' and s['data']<=company_today().isoformat() for s in scales),'pedidos':[dict(id=o['id'],titulo=f"#{o['id']} · {o['supermercado']} · {o['unidade']}") for o in orders if any(start<=t['data']<=end for t in json.loads(o['turnos']))],'fontes':['Pedidos','Escalas e presenças','Diárias vinculadas'],'registros_considerados':len(scales)}
    execution={}
    for o in orders:
        for t in json.loads(o['turnos']):
            if not start<=t['data']<=end:continue
            k=(o['supermercado'],t['data']);r=execution.setdefault(k,dict(rede=k[0],data=k[1],demanda=0,preenchidas=0,presencas=0,confirmadas=0,fechado=False));r['demanda']+=o['quantidade_diaristas']
            own=[s for s in scales if s['pedido_id']==o['id'] and s['data']==t['data']]
            r['preenchidas']+=sum(s['status'] not in ('falta','desistiu') for s in own);r['presencas']+=sum(s['status']=='presente' for s in own);r['confirmadas']+=sum(s['confirmacao']=='confirmada' for s in own)
            r['fechado']=any(c['status']=='fechado' and c['dados']['data']==t['data'] and c['pedido_id'] is None and c['campanha_id']==(int(camp) if camp else None) and c['cliente_id']==(int(client) if client else None) for c in all_records(db,'fechamento'))
    result['execucao']=sorted(execution.values(),key=lambda r:(r['data'],r['rede']))[:200]
    if role in ('admin','financeiro'):
        estimated=sum(r['dados']['orcamento_custo_centavos'] for r in all_records(db,'orcamento') if r['status']=='aprovado' and (not camp or r['campanha_id']==int(camp)) and (not client or r['cliente_id']==int(client)))
        contracted=planned=0
        for r in all_records(db,'proposta'):
            if r['status']!='convertida':continue
            o=next((o for o in orders if o['id']==r['pedido_id']),None)
            if not o:continue
            contracted+=sum(o['quantidade_diaristas']*r['dados']['custo_unitario_centavos'] for t in json.loads(o['turnos']) if start<=t['data']<=end)
            planned+=sum(r['dados']['custo_unitario_centavos'] for s in scales if s['pedido_id']==o['id'] and s['status'] not in ('falta','desistiu'))
        result.update(custo_estimado_campanhas_centavos=estimated,custo_contratado_propostas_centavos=contracted,custo_planejado_propostas_centavos=planned)
        records=[r for r in all_records(db,'despesa') if get(db,r['dados']['categoria_id'],'categoria')['dados'].get('centro_custo','Serviços').lower() not in ('administração','administracao') and (not any(q.get(k,[''])[0] for k in ('rede','loja','setor')) or r['pedido_id'] in {o['id'] for o in orders})];expenses=sum(r['dados']['valor_centavos'] for r in records if r['status'] in ('aprovada','paga') and start<=r['dados']['data']<=end and (not client or r['cliente_id']==int(client)) and (not camp or r['campanha_id']==int(camp)))
        overdue_scope=' AND exists(select 1 from cobranca_itens i where i.cobranca_id=c.id and i.pedido_id in ('+','.join('?' for _ in orders)+'))' if (camp or client or scope) else ''
        overdue=db.execute("SELECT count(*) n,coalesce(sum(c.valor_centavos-coalesce((SELECT sum(r.valor_centavos) FROM cobranca_recebimentos r WHERE r.cobranca_id=c.id AND NOT r.estornado),0)),0) saldo FROM cobrancas c WHERE c.status='aberta' AND c.vencimento<?"+overdue_scope,(company_today().isoformat(),*([o['id'] for o in orders] if overdue_scope else []))).fetchone()
        capital=[r for r in all_records(db,'movimento_caixa') if start<=r['dados']['data']<=end];result['aportes_centavos']=sum(r['dados']['valor_centavos'] for r in capital if r['dados']['tipo']=='aporte');result['retiradas_centavos']=sum(r['dados']['valor_centavos'] for r in capital if r['dados']['tipo']=='retirada')
        result.update(receita_real_centavos=daily['receita'],diarias_custo_centavos=daily['custo'],despesas_aprovadas_centavos=expenses,margem_contribuicao_centavos=daily['receita']-daily['custo']-expenses,valores_incompletos=daily['incompletos'] or 0,cobrancas_atrasadas=overdue['n'],saldo_atrasado_centavos=overdue['saldo'])
    return result

def import_statement(db,p):
    account=get(db,p.get('conta_id'),'conta')
    rows=p.get('linhas')
    if account['status']!='ativo' or not isinstance(rows,list) or not 1<=len(rows)<=500:raise ValueError('Escolha uma conta ativa e importe de 1 a 500 linhas por envio.')
    inserted=skipped=0;duplicates={};stamp=now()
    for r in rows:
        if not isinstance(r,dict) or set(r)-{'data','valor_centavos','descricao','identificador'}:raise ValueError('Linha de extrato inválida.')
        day=r.get('data');date.fromisoformat(day)
        amount=r.get('valor_centavos');desc=r.get('descricao','');identifier=r.get('identificador','')
        if not isinstance(amount,int) or isinstance(amount,bool) or amount==0 or abs(amount)>1000000000 or not isinstance(desc,str) or len(desc)>500 or not isinstance(identifier,str) or len(identifier)>180:raise ValueError('Confira data, valor e descrição de todas as linhas.')
        canonical=json.dumps([day,amount,desc.strip()],ensure_ascii=False,separators=(',',':'))
        duplicates[canonical]=duplicates.get(canonical,0)+1
        token=identifier or canonical+'#'+str(duplicates[canonical])
        key=hashlib.md5((str(account['id'])+':'+token).encode()).hexdigest()
        old=db.execute('SELECT * FROM empresa_extrato WHERE chave=?',(key,)).fetchone()
        if old:
            if (old['data'],old['valor_centavos'],old['descricao'])!=(day,amount,desc.strip()):raise ValueError('O identificador bancário já foi importado com outros dados.')
            skipped+=1;continue
        db.execute('INSERT INTO empresa_extrato(conta_id,chave,data,valor_centavos,descricao,identificador,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?)',(account['id'],key,day,amount,desc.strip(),identifier,stamp,stamp));inserted+=1
    return {'importadas':inserted,'repetidas':skipped}

def reconcile(db,p,core):
    line=db.execute('SELECT * FROM empresa_extrato WHERE id=?',(p.get('id'),)).fetchone()
    if not line or line['versao']!=p.get('versao') or line['estado']!='pendente':raise RuntimeError('Linha já conferida ou alterada. Atualize o extrato.')
    target=p.get('destino_tipo');id=p.get('destino_id');amount=line['valor_centavos']
    if target=='ignorar':
        if len(p.get('motivo',''))<8:raise ValueError('Explique por que esta linha não será vinculada.')
    elif target=='cobranca':
        if amount<=0:raise ValueError('Escolha uma entrada para recebimento de cobrança.')
        invoice=db.execute("SELECT * FROM cobrancas WHERE id=? AND status='aberta'",(id,)).fetchone()
        received=db.execute('SELECT coalesce(sum(valor_centavos),0) FROM cobranca_recebimentos WHERE cobranca_id=? AND NOT estornado',(id,)).fetchone()[0]
        if not invoice or received+amount>invoice['valor_centavos']:raise ValueError('O recebimento ultrapassa o saldo da cobrança.')
        db.execute('INSERT INTO cobranca_recebimentos(cobranca_id,valor_centavos,data_recebimento,forma,criado_em) VALUES(?,?,?,?,?)',(id,amount,line['data'],'Extrato conferido',now()))
    elif target=='lancamento':
        row=db.execute('SELECT * FROM financeiro_lancamentos WHERE id=?',(id,)).fetchone()
        if not row or row['valor_centavos']!=abs(amount) or (row['tipo']=='receita')!=(amount>0):raise ValueError('O lançamento deve ter o mesmo valor e sentido da linha.')
        if row['data_pagamento'] and row['data_pagamento']!=line['data']:raise ValueError('A data registrada é diferente do extrato. Confira antes de vincular.')
        if db.execute("SELECT 1 FROM empresa_extrato WHERE destino_tipo='lancamento' AND destino_id=? AND estado='conciliado'",(id,)).fetchone():raise ValueError('Este lançamento já está vinculado a outra linha.')
        db.execute('UPDATE financeiro_lancamentos SET data_pagamento=?,forma_pagamento=?,atualizado_em=? WHERE id=?',(line['data'],'Extrato conferido',now(),id))
    elif target=='lote_pagamento':
        row=db.execute("SELECT * FROM pagamento_lotes WHERE id=? AND status='pago'",(id,)).fetchone()
        if amount>=0 or not row or row['valor_centavos']!=-amount or row['data_pagamento']!=line['data']:raise ValueError('Escolha o lote pago com o mesmo valor e data.')
        if db.execute("SELECT 1 FROM empresa_extrato WHERE destino_tipo='lote_pagamento' AND destino_id=? AND estado='conciliado'",(id,)).fetchone():raise ValueError('Este lote já foi conciliado.')
    else:raise ValueError('Tipo de vínculo inválido.')
    db.execute('UPDATE empresa_extrato SET estado=?,destino_tipo=?,destino_id=?,motivo=?,versao=versao+1,atualizado_em=? WHERE id=?',('ignorada' if target=='ignorar' else 'conciliado',target,id,p.get('motivo',''),now(),line['id']))
    return dict(db.execute('SELECT * FROM empresa_extrato WHERE id=?',(line['id'],)).fetchone())

def handle(handler,method,core):
    import enterprise_actions as actions
    parsed=urlparse(handler.path)
    if not parsed.path.startswith('/api/empresa/') and parsed.path!='/api/relatorio-publico':return False
    action='relatorio-publico' if parsed.path=='/api/relatorio-publico' else parsed.path.removeprefix('/api/empresa/');q=parse_qs(parsed.query)
    try:
        with core.connect() as db:
            if method!='GET':db.execute('BEGIN IMMEDIATE')
            if method=='GET':
                if action=='lista':result=listing(db,q)
                elif action=='registro':result=get(db,int(q['id'][0]))
                elif action=='opcoes':result=options(db,q.get('tipo',[''])[0],q.get('busca',[''])[0],q.get('id',[None])[0])
                elif action=='painel':result=dashboard(db,q)
                elif action=='alertas':result=actions.alerts(db,q.get('data',[company_today().isoformat()])[0])
                elif action=='candidatos-extrato':result=actions.bank_candidates(db,{k:v[0] for k,v in q.items()},core)
                elif action=='diarias-pendentes':result=[dict(r) for r in db.execute('SELECT d.id,d.data,d.local,d.setor,d.valor_centavos,d.diarista_id,w.nome FROM diarias d JOIN diaristas w ON w.id=d.diarista_id WHERE d.data_pagamento IS NULL AND d.pagamento_lote_id IS NULL AND d.valor_centavos>0 AND (?=0 OR d.diarista_id=?) ORDER BY d.data,d.id LIMIT 500',(int(q.get('diarista_id',['0'])[0]),)*2)]
                elif action=='reservas':result=actions.reserve(db,{k:v[0] for k,v in q.items()},core)
                elif action=='historico':result=actions.history(db,q,'admin')
                elif action=='cobrancas':result=actions.invoices(db,core,q)
                elif action=='relatorio-publico':result=actions.public_report(db,q.get('codigo',[''])[0])
                elif action=='foto':
                    item=db.execute('SELECT * FROM empresa_anexos WHERE id=?',(int(q.get('id',['0'])[0]),)).fetchone()
                    if not item:raise ValueError('Foto não encontrada.')
                    get(db,item['registro_id']);content=(Path(core.DB_PATH).parent/'empresa-anexos'/item['caminho']).read_bytes();handler.respond(200,content,item['mime']);return True
                elif action=='anexos':result=[dict(r) for r in db.execute('SELECT * FROM empresa_anexos WHERE registro_id=?',(int(q.get('registro_id',['0'])[0]),))]
                elif action=='saldo':result={'saldo':stock(db,int(q['material_id'][0]))}
                elif action=='extrato':
                    account=int(q.get('conta_id',['0'])[0]);page=max(1,int(q.get('pagina',['1'])[0]));rows=[dict(r) for r in db.execute('SELECT * FROM empresa_extrato WHERE conta_id=? ORDER BY data DESC,id DESC LIMIT 50 OFFSET ?',(account,(page-1)*50))]
                    count=db.execute('SELECT count(*) FROM empresa_extrato WHERE conta_id=?',(account,)).fetchone()[0]
                    result={'items':rows,'total':count,'pagina':page}
                else:raise ValueError('Consulta não encontrada.')
            else:
                p=handler.read_json(max_length=1500000)
                if action=='registro':result=save(db,p)
                elif action=='importar-extrato':result=import_statement(db,p)
                elif action=='conciliar':result=reconcile(db,p,core)
                elif action=='configurar-rede':
                    network=get(db,p.get('rede_id'),'rede');income=p.get('valor_recebido_centavos');cost=p.get('valor_padrao_centavos')
                    if any(isinstance(v,bool) or not isinstance(v,int) or not 0<v<=1000000000 for v in (income,cost)):raise ValueError('Informe valores válidos maiores que zero.')
                    db.execute('INSERT INTO tarifas_redes(rede,valor_recebido_centavos,valor_padrao_centavos,atualizado_em) VALUES(?,?,?,?) ON CONFLICT(rede) DO UPDATE SET valor_recebido_centavos=excluded.valor_recebido_centavos,valor_padrao_centavos=excluded.valor_padrao_centavos,atualizado_em=excluded.atualizado_em',(network['titulo'],income,cost,now()));result={'ok':True}
                elif action=='registrar-pagamento':result=actions.payment(db,p,core)
                elif action=='converter-proposta':result=actions.convert(db,p,core)
                elif action=='compartilhar-relatorio':result=actions.share(db,p)
                elif action=='anexo':result=actions.attach(db,p,Path(core.DB_PATH).parent/'empresa-anexos')
                else:raise ValueError('Operação não encontrada.')
        handler.respond(200,result)
    except PermissionError as e:handler.respond(403,{'erro':str(e)})
    except RuntimeError as e:handler.respond(409,{'erro':str(e)})
    except (ValueError,KeyError,TypeError,sqlite3.IntegrityError) as e:handler.respond(400,{'erro':str(e) if isinstance(e,(ValueError,RuntimeError)) else 'Confira os dados e seus vínculos.'})
    return True
