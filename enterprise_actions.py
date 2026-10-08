"""Cross-module business workflows; called inside the caller's transaction."""
import base64
import hashlib
import json
import re
import secrets
from datetime import date, timedelta
from pathlib import Path

import enterprise as e

def schema(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS empresa_compartilhamentos(
      id INTEGER PRIMARY KEY AUTOINCREMENT,registro_id INTEGER NOT NULL UNIQUE REFERENCES empresa_registros(id),
      codigo TEXT NOT NULL UNIQUE,criado_em TEXT NOT NULL);
    ''')

def convert(db,p,core):
    r=e.get(db,p.get('id'),'proposta');d=r['dados']
    if r['status']=='convertida':return {'pedido_id':d['pedido_convertido_id'],'repetido':True}
    if r['versao']!=p.get('versao') or r['status']!='aprovada':raise ValueError('Atualize e escolha uma proposta aprovada.')
    if not d['valor_unitario_centavos'] or not d['custo_unitario_centavos']:raise ValueError('Confira os valores contratados antes de gerar o pedido.')
    s=db.execute('SELECT * FROM lojas WHERE id=?',(d['loja_id'],)).fetchone()
    shifts=[{'data':(date.fromisoformat(d['inicio'])+timedelta(days=i)).isoformat(),'inicio':d['hora_inicio'],'fim':d['hora_fim']} for i in range(d['dias'])]
    payload=core.validate_order(dict(supermercado=s['rede'],unidade=s['nome'],setor=d['setor'],quantidade_diaristas=d['pessoas'],turnos=shifts,situacao='novo',observacoes=('Proposta #'+str(r['id'])+' · '+d['condicoes'])[:500]))
    stamp=e.now();cols=list(payload)
    oid=db.execute('INSERT INTO pedidos('+','.join(cols)+',criado_em,atualizado_em) VALUES('+','.join('?' for _ in range(len(cols)+2))+')',(*payload.values(),stamp,stamp)).lastrowid
    d['pedido_convertido_id']=oid
    db.execute('UPDATE empresa_registros SET status=?,pedido_id=?,dados=?,versao=versao+1,atualizado_em=? WHERE id=?',('convertida',oid,json.dumps(d,ensure_ascii=False),stamp,r['id']))
    if d.get('campanha_id'):
        e.save(db,dict(tipo='vinculo',titulo='Pedido #'+str(oid),status='ativo',dados={'pedido_id':oid,'campanha_id':d['campanha_id']},chave='proposta:vinculo:'+str(r['id'])))
    return {'pedido_id':oid,'proposta_id':r['id']}

def contracted(db,order_id):
    row=db.execute("SELECT dados FROM empresa_registros WHERE tipo='proposta' AND status='convertida' AND pedido_id=?",(order_id,)).fetchone()
    return json.loads(row[0]) if row else None

def share(db,p):
    r=e.get(db,p.get('id'),'relatorio')
    if r['status']!='aprovado' or r['versao']!=p.get('versao'):raise ValueError('Somente um relatório aprovado e atualizado pode ser compartilhado.')
    old=db.execute('SELECT codigo FROM empresa_compartilhamentos WHERE registro_id=?',(r['id'],)).fetchone()
    token=old[0] if old else secrets.token_urlsafe(18)
    if not old:db.execute('INSERT INTO empresa_compartilhamentos(registro_id,codigo,criado_em) VALUES(?,?,?)',(r['id'],token,e.now()))
    return {'codigo':token}

def public_report(db,token):
    if not re.fullmatch(r'[A-Za-z0-9_-]{24}',token or ''):raise PermissionError('Link de relatório inválido.')
    row=db.execute("SELECT r.* FROM empresa_compartilhamentos c JOIN empresa_registros r ON r.id=c.registro_id WHERE c.codigo=? AND r.status='aprovado'",(token,)).fetchone()
    if not row:raise PermissionError('Relatório não disponível.')
    r=e.view(row);d=r['dados']
    return {'titulo':r['titulo'],'inicio':d['inicio'],'fim':d['fim'],'resumo':d['resumo'],'resultado':d['resultado'],'versao':r['versao'],'aprovado_em':r['atualizado_em']}

def alerts(db,today):
    result=[];rules={}
    for r in e.all_records(db,'regra'):
        if r['status']=='ativo':rules.setdefault(r['dados']['tipo'],[]).append(r['dados'])
    for r in e.all_records(db):
        d=r['dados'];kind=r['tipo'];rulekind={'tarefa':'tarefa_vencida','qualificacao':'qualificacao_vencida','lote':'lote_vencido'}.get(kind);settings=rules.get(rulekind,[])
        days=max([d.get('antecedencia_dias',0)]+[x['antecedencia_dias'] for x in settings]);threshold=(date.fromisoformat(today)+timedelta(days=days)).isoformat();deadline=None;owner=''
        if kind=='tarefa' and r['status'] not in ('concluida','cancelada'):deadline=d['prazo'][:10];owner=d.get('supervisor') or d['responsavel']
        if kind in ('qualificacao','lote') and d.get('validade') and r['status'] not in ('revogada','arquivado'):deadline=d['validade'];owner=d.get('conferido_por','')
        if kind=='contato' and d.get('retorno'):deadline=d['retorno'];owner=d['responsavel']
        if deadline and deadline<=threshold:
            instructions=' · '.join(x['acao'] for x in settings)
            result.append({'id':r['id'],'tipo':kind,'titulo':r['titulo'],'motivo':('Prazo vencido' if deadline<today else 'Prazo próximo ou vence hoje')+(' · '+instructions if instructions else ''),'responsavel':', '.join(dict.fromkeys([owner]+[x['responsavel'] for x in settings])).strip(', ')})
    for rule in rules.get('cobranca_atrasada',[]):
        threshold=(date.fromisoformat(today)+timedelta(days=rule['antecedencia_dias'])).isoformat()
        for r in db.execute("SELECT c.id,c.rede,c.vencimento FROM cobrancas c WHERE status='aberta' AND vencimento<=? AND valor_centavos>coalesce((SELECT sum(valor_centavos) FROM cobranca_recebimentos x WHERE x.cobranca_id=c.id AND NOT estornado),0)",(threshold,)):
            result.append({'id':r['id'],'tipo':'cobranca','titulo':'Cobrança · '+r['rede'],'motivo':rule['acao'],'responsavel':rule['responsavel']})
    return result[:100]

def reserve(db,p,core):
    order=db.execute('SELECT * FROM pedidos WHERE id=?',(int(p.get('pedido_id',0)),)).fetchone()
    if not order:raise ValueError('Escolha um pedido existente.')
    days=[x['data'] for x in json.loads(order['turnos'])];result=[]
    for raw in db.execute('SELECT * FROM diaristas WHERE NOT bloqueada ORDER BY nome'):
        worker=core.public_diarista(raw) if hasattr(core,'public_diarista') else dict(raw)
        warnings=[];reasons=[];eligible=True
        sectors=json.loads(raw['setores']);reasons.append('Experiência declarada na função' if any(x.lower()==order['setor'].lower() for x in sectors) else 'Função não consta na experiência declarada')
        for day in days:
            try:core.validate_worker_shift(db,raw,order,day,scoped_availability=False)
            except ValueError as ex:eligible=False;warnings.append(str(ex));break
        qualified=[r for r in e.all_records(db,'qualificacao') if r['diarista_id']==raw['id'] and r['status']=='conferida' and (not r['dados'].get('validade') or r['dados']['validade']>=max(days))]
        reasons.extend('Conferido: '+r['titulo'] for r in qualified)
        warnings.append('Confirmar interesse e disponibilidade para este pedido antes de escalar.')
        result.append(dict(id=raw['id'],nome=raw['nome'],elegivel=eligible,motivos=reasons,avisos=list(dict.fromkeys(warnings))))
    return {'pedido_id':order['id'],'datas':days,'items':sorted(result,key=lambda r:(not r['elegivel'],-len(r['motivos']),r['nome']))[:100]}

def invoices(db,core,q):
    data=core.workflow.invoice_rows(db);client=q.get('cliente_id',[''])[0];camp=q.get('campanha_id',[''])[0]
    if client or camp:
        oid={r['pedido_id'] for r in e.all_records(db,'vinculo') if (not client or r['cliente_id']==int(client)) and (not camp or r['campanha_id']==int(camp))}
        data=[r for r in data if any(i['pedido_id'] in oid for i in r['itens'])]
    return data

def attach(db,p,root):
    r=e.get(db,p.get('registro_id'))
    if r['tipo'] in ('acesso','conta','frase','leitura_aviso'):raise ValueError('Este registro não recebe evidência de execução.')
    body=p.get('conteudo','');mime=p.get('mime');name=p.get('nome','')
    if mime not in ('image/jpeg','image/png','image/webp') or not isinstance(name,str) or not 1<=len(name)<=120:raise ValueError('Escolha uma foto JPEG, PNG ou WebP com nome de até 120 caracteres.')
    try:content=base64.b64decode(body,validate=True)
    except Exception as ex:raise ValueError('Imagem inválida.') from ex
    if not 0<len(content)<=1048576:raise ValueError('Comprima a imagem para até 1 MB.')
    valid=(mime=='image/jpeg' and content.startswith(b'\xff\xd8\xff')) or (mime=='image/png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or (mime=='image/webp' and content.startswith(b'RIFF') and content[8:12]==b'WEBP')
    if not valid:raise ValueError('O conteúdo não corresponde ao formato da foto.')
    digest=hashlib.sha256(content).hexdigest();relative=f"{r['id']}/{digest}";path=root/relative
    exists=db.execute('SELECT * FROM empresa_anexos WHERE caminho=?',(relative,)).fetchone()
    if exists:return dict(exists)
    if db.execute('SELECT count(*) FROM empresa_anexos WHERE registro_id=?',(r['id'],)).fetchone()[0]>=8:raise ValueError('Use até 8 fotos por registro.')
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
    id=db.execute('INSERT INTO empresa_anexos(registro_id,nome,mime,bytes,caminho,sha256,criado_em,autor) VALUES(?,?,?,?,?,?,?,?)',(r['id'],name,mime,len(content),relative,digest,e.now(),'Servidor local')).lastrowid
    return dict(db.execute('SELECT * FROM empresa_anexos WHERE id=?',(id,)).fetchone())

def history(db,q,role):
    client=int(q.get('cliente_id',['0'])[0]);kinds={'contato','oportunidade','relatorio','campanha','feedback','vinculo','tarefa'}
    if role in ('admin','financeiro'):kinds.add('proposta')
    return [r for r in e.all_records(db) if r['cliente_id']==client and r['tipo'] in kinds][-100:][::-1]


def payment(db,p,core):
    r=e.get(db,p.get('id'),'pagamento_revisao');d=r['dados']
    if r['status']=='registrado':return {'lote_id':d['lote_id'],'repetido':True}
    if r['status']!='aprovado' or r['versao']!=p.get('versao'):raise ValueError('Escolha uma conferência aprovada e atualizada.')
    day=core.validate_date(p.get('data_pagamento'),'a data do pagamento');method=core.clean_text(p.get('forma'),'a forma',80)
    rows=list(db.execute('SELECT id,diarista_id,valor_centavos,data_pagamento FROM diarias WHERE id IN ('+','.join('?'*len(d['diaria_ids']))+') ORDER BY id',d['diaria_ids']))
    if [dict(x) for x in rows]!=d['diarias_snapshot']:raise ValueError('As diárias mudaram; prepare uma nova conferência.')
    if any(db.execute('SELECT pagamento_lote_id FROM diarias WHERE id=?',(x['id'],)).fetchone()[0] for x in rows):raise ValueError('Uma diária já pertence a outro lote.')
    stamp=e.now();id=db.execute('INSERT INTO pagamento_lotes(diarista_id,valor_centavos,data_pagamento,forma,quantidade,criado_em) VALUES(?,?,?,?,?,?)',(d['diarista_id'],d['valor_conferido_centavos'],day,method,len(rows),stamp)).lastrowid
    for row in rows:db.execute('UPDATE diarias SET data_pagamento=?,forma_pagamento=?,pagamento_lote_id=? WHERE id=?',(day,method,id,row['id']))
    d.update(lote_id=id,data_registro=day,forma_registro=method)
    db.execute("UPDATE empresa_registros SET status='registrado',dados=?,versao=versao+1,atualizado_em=? WHERE id=?",(json.dumps(d,ensure_ascii=False),stamp,r['id']))
    return {'lote_id':id,'valor_centavos':d['valor_conferido_centavos']}


def bank_candidates(db,p,core):
    line=dict(db.execute('SELECT * FROM empresa_extrato WHERE id=?',(int(p['id']),)).fetchone() or {})
    if not line:raise ValueError('Linha não encontrada.')
    amount=line['valor_centavos'];day=line['data'];result={'lancamento':[],'cobranca':[],'lote_pagamento':[]}
    for r in db.execute("SELECT * FROM financeiro_lancamentos WHERE valor_centavos=? AND (data_pagamento IS NULL OR data_pagamento=?)",(abs(amount),day)):
        if (r['tipo']=='receita')==(amount>0) and not db.execute("SELECT 1 FROM empresa_extrato WHERE estado='conciliado' AND destino_tipo='lancamento' AND destino_id=?",(r['id'],)).fetchone():result['lancamento'].append({'id':r['id'],'titulo':r['descricao']})
    if amount>0:
        for r in core.workflow.invoice_rows(db):
            if r['status']=='aberta' and r['valor_centavos']-r['valor_recebido_centavos']>=amount:result['cobranca'].append({'id':r['id'],'titulo':r['rede']+' · '+r['periodo_inicio']+' a '+r['periodo_fim']})
    else:
        for r in db.execute("SELECT b.*,w.nome FROM pagamento_lotes b JOIN diaristas w ON w.id=b.diarista_id WHERE b.status='pago' AND b.valor_centavos=? AND b.data_pagamento=?",(-amount,day)):
            if not db.execute("SELECT 1 FROM empresa_extrato WHERE estado='conciliado' AND destino_tipo='lote_pagamento' AND destino_id=?",(r['id'],)).fetchone():result['lote_pagamento'].append({'id':r['id'],'titulo':r['nome']+' · '+str(r['quantidade'])+' diária(s)'})
    return {k:v[:100] for k,v in result.items()}
