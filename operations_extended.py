"""Controles de operação e contratos para o servidor local de desenvolvimento."""
import json
import re
from datetime import datetime, timezone, timedelta, date
from urllib.parse import urlparse


def ensure_schema(db):
    additions = {
        'diaristas': {'telefone': "TEXT NOT NULL DEFAULT ''", 'reserva': 'INTEGER NOT NULL DEFAULT 0', 'disponibilidade_confirmada_em': 'TEXT'},
        'pedidos': {'chave_operacao': 'TEXT'},
        'pedido_escalas': {'confirmacao': "TEXT NOT NULL DEFAULT 'aguardando'", 'confirmacao_em': 'TEXT', 'confirmacao_por': 'TEXT',
            'chegada_em': 'TEXT', 'saida_em': 'TEXT', 'loja_validacao': "TEXT NOT NULL DEFAULT 'pendente'", 'loja_responsavel': "TEXT NOT NULL DEFAULT ''",
            'loja_observacao': "TEXT NOT NULL DEFAULT ''", 'loja_validada_em': 'TEXT', 'loja_validada_por': 'TEXT'},
        'diarias': {'contrato_id': 'INTEGER REFERENCES contratos(id) ON DELETE RESTRICT'},
        'cobrancas': {'conferencia': "TEXT NOT NULL DEFAULT 'pendente'", 'conferencia_responsavel': "TEXT NOT NULL DEFAULT ''",
            'conferencia_motivo': "TEXT NOT NULL DEFAULT ''", 'conferencia_em': 'TEXT'},
    }
    db.executescript("""
      CREATE TABLE IF NOT EXISTS contratos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rede TEXT NOT NULL REFERENCES tarifas_redes(rede),
        loja TEXT NOT NULL DEFAULT '', setor TEXT NOT NULL DEFAULT '', inicio TEXT NOT NULL, fim TEXT,
        valor_recebido_centavos INTEGER, valor_pago_centavos INTEGER, prazo_dias INTEGER NOT NULL DEFAULT 30,
        responsavel TEXT NOT NULL DEFAULT '', contato TEXT NOT NULL DEFAULT '', regras TEXT NOT NULL DEFAULT '',
        versao_anterior_id INTEGER REFERENCES contratos(id) ON DELETE RESTRICT, criado_em TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ocorrencias (
        id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
        escala_id INTEGER REFERENCES pedido_escalas(id) ON DELETE RESTRICT, tipo TEXT NOT NULL,
        descricao TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'aberta', resolucao TEXT NOT NULL DEFAULT '',
        autor TEXT NOT NULL, criado_em TEXT NOT NULL, resolvida_em TEXT);
      CREATE INDEX IF NOT EXISTS contratos_abrangencia ON contratos(rede,loja,setor,inicio);
      CREATE INDEX IF NOT EXISTS ocorrencias_pedido ON ocorrencias(pedido_id);
      CREATE INDEX IF NOT EXISTS ocorrencias_escala ON ocorrencias(escala_id);
    """)
    for table, fields in additions.items():
        existing = {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
        for name, definition in fields.items():
            if name not in existing:
                db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS pedidos_chave_operacao ON pedidos(chave_operacao) WHERE chave_operacao IS NOT NULL')
    for table, names in {
        'contratos': ['id','rede','loja','setor','inicio','fim','valor_recebido_centavos','valor_pago_centavos','prazo_dias'],
        'ocorrencias': ['id','pedido_id','escala_id','tipo','descricao','estado','resolucao'],
    }.items():
        for event in ['INSERT','UPDATE','DELETE']:
            before = "json_object(" + ','.join(f"'{x}',OLD.{x}" for x in names) + ')' if event != 'INSERT' else 'NULL'
            after = "json_object(" + ','.join(f"'{x}',NEW.{x}" for x in names) + ')' if event != 'DELETE' else 'NULL'
            rid = 'OLD.id' if event == 'DELETE' else 'NEW.id'
            db.execute(f"CREATE TRIGGER IF NOT EXISTS audit_{table}_{event.lower()} AFTER {event} ON {table} BEGIN INSERT INTO direct_auditoria(tabela,registro_id,operacao,antes,depois) VALUES('{table}',{rid},'{event}',{before},{after}); END")

    for table,names in {'pedido_escalas':['confirmacao','confirmacao_em','confirmacao_por','chegada_em','saida_em','loja_validacao','loja_responsavel','loja_observacao','loja_validada_em','loja_validada_por'], 'diaristas':['telefone','reserva','disponibilidade_confirmada_em'], 'cobrancas':['conferencia','conferencia_responsavel','conferencia_motivo','conferencia_em']}.items():
        changed=' OR '.join(f'NEW.{n} IS NOT OLD.{n}' for n in names)
        old="json_object("+','.join(f"'{n}',OLD.{n}" for n in names)+')'
        new="json_object("+','.join(f"'{n}',NEW.{n}" for n in names)+')'
        db.execute(f"CREATE TRIGGER IF NOT EXISTS audit_extended_{table} AFTER UPDATE ON {table} WHEN {changed} BEGIN INSERT INTO direct_auditoria(tabela,registro_id,operacao,antes,depois) VALUES('{table}',NEW.id,'UPDATE',{old},{new}); END")


def effective_contract(db, order, day):
    return db.execute("""SELECT * FROM contratos WHERE lower(rede)=lower(?) AND (loja='' OR lower(loja)=lower(?))
      AND (setor='' OR lower(setor)=lower(?)) AND inicio<=? AND (fim IS NULL OR fim>=?)
      ORDER BY (CASE WHEN loja<>'' THEN 2 ELSE 0 END + CASE WHEN setor<>'' THEN 1 ELSE 0 END) DESC, inicio DESC,id DESC LIMIT 1""",
      (order['supermercado'],order['unidade'],order['setor'],day,day)).fetchone()


def stamp(value, day):
    if value in (None,''): return None
    parsed = datetime.fromisoformat(str(value).replace('Z','+00:00'))
    if parsed.tzinfo is None: raise ValueError('Horário precisa conter o fuso.')
    from zoneinfo import ZoneInfo
    if parsed.astimezone(ZoneInfo('America/Fortaleza')).date().isoformat()!=day or parsed>datetime.now(timezone.utc)+timedelta(minutes=1):
        raise ValueError('O horário deve pertencer ao dia da escala e não pode estar no futuro.')
    return parsed.isoformat()


def handle(h, method, s):
    path = urlparse(h.path).path
    match = re.fullmatch(r'/api/operacao/(escalas|diaristas|cobrancas)/(\d+)',path)
    if path not in ['/api/contratos','/api/ocorrencias'] and not match and not re.fullmatch(r'/api/ocorrencias/\d+',path): return False
    try:
        now=datetime.now(timezone.utc).isoformat()
        if method=='GET' and path in ['/api/contratos','/api/ocorrencias']:
            table=path.split('/')[-1]
            with s.connect() as db:
                result=[dict(r) for r in db.execute(f'SELECT * FROM {table} ORDER BY id DESC')]
        else:
            p=h.read_json()
            if not isinstance(p,dict): raise ValueError('Dados inválidos.')
            with s.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if method=='POST' and path=='/api/contratos':
                    rede=s.clean_text(p.get('rede'),'a rede',180)
                    if not db.execute('SELECT 1 FROM tarifas_redes WHERE rede=?',(rede,)).fetchone(): raise ValueError('Rede não cadastrada.')
                    loja=s.clean_text(p.get('loja',''),'a loja',180,False); setor=s.clean_text(p.get('setor',''),'o setor',80,False)
                    if loja and not db.execute('SELECT 1 FROM lojas WHERE lower(rede)=lower(?) AND lower(nome)=lower(?)',(rede,loja)).fetchone(): raise ValueError('Loja não cadastrada nessa rede.')
                    start=s.validate_date(p.get('inicio'),'o início'); end=s.validate_date(p['fim'],'o fim') if p.get('fim') else None
                    if setor and not db.execute('SELECT 1 FROM tarifas_setores WHERE lower(setor)=lower(?)',(setor,)).fetchone(): raise ValueError('Setor não cadastrado nas configurações.')
                    if end and end<start: raise ValueError('Fim anterior ao início.')
                    prazo=p.get('prazo_dias',30)
                    if isinstance(prazo,bool) or not isinstance(prazo,int) or not 0<=prazo<=365: raise ValueError('Prazo deve ser de 0 a 365 dias.')
                    previous=p.get('versao_anterior_id')
                    if previous:
                        old=db.execute('SELECT * FROM contratos WHERE id=?',(previous,)).fetchone()
                        if not old or (old['rede'],old['loja'],old['setor'])!=(rede,loja,setor) or start<=old['inicio']: raise ValueError('Nova versão deve manter abrangência e começar depois da anterior.')
                        if old['fim'] and old['fim']<start: pass
                        else: db.execute('UPDATE contratos SET fim=? WHERE id=?',((date.fromisoformat(start)-timedelta(days=1)).isoformat(),previous))
                    if db.execute("SELECT 1 FROM contratos WHERE rede=? AND lower(loja)=lower(?) AND lower(setor)=lower(?) AND inicio<=? AND coalesce(fim,'9999-12-31')>=?",(rede,loja,setor,end or '9999-12-31',start)).fetchone(): raise ValueError('Há contrato sobreposto nessa abrangência. Use Nova versão.')
                    received=s.money_cents(p.get('valor_recebido')); paid=s.money_cents(p.get('valor_pago'))
                    if any(v is not None and v>100000000 for v in [received,paid]): raise ValueError('Valor fora do limite permitido.')
                    values=(rede,loja,setor,start,end,received,paid,prazo,
                        s.clean_text(p.get('responsavel',''),'o responsável',120,False),s.clean_text(p.get('contato',''),'o contato',120,False),s.clean_text(p.get('regras',''),'as regras',2000,False),previous,now)
                    rid=db.execute('INSERT INTO contratos(rede,loja,setor,inicio,fim,valor_recebido_centavos,valor_pago_centavos,prazo_dias,responsavel,contato,regras,versao_anterior_id,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',values).lastrowid
                    result=dict(db.execute('SELECT * FROM contratos WHERE id=?',(rid,)).fetchone())
                elif method=='POST' and path=='/api/ocorrencias':
                    pedido=p.get('pedido_id'); escala=p.get('escala_id') or None
                    if not db.execute('SELECT 1 FROM pedidos WHERE id=?',(pedido,)).fetchone(): raise ValueError('Pedido não encontrado.')
                    if escala and not db.execute('SELECT 1 FROM pedido_escalas WHERE id=? AND pedido_id=?',(escala,pedido)).fetchone(): raise ValueError('Escala não pertence ao pedido.')
                    if p.get('tipo') not in ['atraso','troca_setor','saida_antecipada','reclamacao','elogio','outro']: raise ValueError('Tipo inválido.')
                    text=s.clean_text(p.get('descricao'),'a descrição',1000)
                    if len(text)<5: raise ValueError('Descreva a ocorrência em pelo menos 5 caracteres.')
                    rid=db.execute('INSERT INTO ocorrencias(pedido_id,escala_id,tipo,descricao,autor,criado_em) VALUES(?,?,?,?,?,?)',(pedido,escala,p['tipo'],text,'Servidor local',now)).lastrowid
                    result=dict(db.execute('SELECT * FROM ocorrencias WHERE id=?',(rid,)).fetchone())
                elif method=='PATCH' and re.fullmatch(r'/api/ocorrencias/\d+',path):
                    rid=int(path.split('/')[-1]); text=s.clean_text(p.get('resolucao'),'a resolução',1000)
                    if len(text)<5: raise ValueError('Informe a resolução em pelo menos 5 caracteres.')
                    cur=db.execute("UPDATE ocorrencias SET estado='resolvida',resolucao=?,resolvida_em=? WHERE id=? AND estado='aberta'",(text,now,rid))
                    if not cur.rowcount: raise ValueError('Ocorrência não encontrada ou já resolvida.')
                    result=dict(db.execute('SELECT * FROM ocorrencias WHERE id=?',(rid,)).fetchone())
                elif method=='PATCH' and match:
                    kind,rid=match.group(1),int(match.group(2))
                    if kind=='diaristas':
                        phone=re.sub(r'\D','',str(p.get('telefone','')))
                        if phone and not 10<=len(phone)<=13: raise ValueError('Telefone deve conter DDD e número.')
                        if not isinstance(p.get('reserva'),bool): raise ValueError('Confira a opção de reserva.')
                        cur=db.execute('UPDATE diaristas SET telefone=?,reserva=?,disponibilidade_confirmada_em=?,atualizado_em=? WHERE id=?',(phone,p['reserva'],now,now,rid))
                        if not cur.rowcount: raise ValueError('Diarista não encontrada.')
                        result=s.public_row(db.execute('SELECT * FROM diaristas WHERE id=?',(rid,)).fetchone())
                    elif kind=='cobrancas':
                        state=p.get('conferencia'); person=s.clean_text(p.get('responsavel'),'o responsável',120); reason=s.clean_text(p.get('motivo',''),'o motivo',1000,False)
                        if len(person)<2 or state not in ['conferida','contestada'] or (state=='contestada' and len(reason)<5): raise ValueError('Informe a conferência e o motivo da contestação.')
                        cur=db.execute('UPDATE cobrancas SET conferencia=?,conferencia_responsavel=?,conferencia_motivo=?,conferencia_em=? WHERE id=? AND status<>\'cancelada\'',(state,person,reason,now,rid))
                        if not cur.rowcount: raise ValueError('Cobrança não encontrada ou cancelada.')
                        result={'ok':True}
                    else:
                        old=db.execute('SELECT * FROM pedido_escalas WHERE id=?',(rid,)).fetchone()
                        if not old: raise ValueError('Escala não encontrada.')
                        if p.get('expected_updated_at') and p['expected_updated_at']!=old['atualizado_em']: raise ValueError('A escala mudou depois da leitura. Confira novamente.')
                        if p.get('acao')=='confirmacao':
                            state=p.get('confirmacao')
                            if state not in ['aguardando','confirmou','recusou'] or old['status']!='escalada': raise ValueError('Confirmação disponível apenas para escala aguardando presença.')
                            db.execute('UPDATE pedido_escalas SET confirmacao=?,confirmacao_em=?,confirmacao_por=?,atualizado_em=? WHERE id=?',(state,now,'Servidor local',now,rid))
                        elif p.get('acao')=='validacao':
                            state=p.get('loja_validacao'); person=s.clean_text(p.get('loja_responsavel'),'o responsável da loja',120)
                            note=s.clean_text(p.get('loja_observacao',''),'a observação',1000,False)
                            if len(person)<2 or old['status']!='presente' or state not in ['validado','divergencia'] or (state=='divergencia' and len(note)<5): raise ValueError('Validação exige presença confirmada e motivo para divergência.')
                            arrival=stamp(p.get('chegada_em'),old['data']); departure=stamp(p.get('saida_em'),old['data'])
                            if departure and (not arrival or departure<arrival): raise ValueError('Saída deve ser posterior à chegada.')
                            db.execute('UPDATE pedido_escalas SET chegada_em=?,saida_em=?,loja_validacao=?,loja_responsavel=?,loja_observacao=?,loja_validada_em=?,loja_validada_por=?,atualizado_em=? WHERE id=?',(arrival,departure,state,person,note,now,'Servidor local',now,rid))
                        else: raise ValueError('Ação inválida.')
                        result=dict(db.execute('SELECT * FROM pedido_escalas WHERE id=?',(rid,)).fetchone())
                else: raise ValueError('Operação não disponível.')
        h.respond(200,result)
    except (ValueError,TypeError,json.JSONDecodeError) as exc: h.respond(400,{'erro':str(exc)})
    except __import__('sqlite3').IntegrityError as exc: h.respond(409,{'erro':'Conflito de registro ou vínculo. Confira os dados.'})
    return True
