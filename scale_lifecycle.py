"""Desistências e substituições preservam a escala original e sua auditoria."""
import json
import re
from datetime import datetime, timezone


def migrate(core):
    with core.connect() as db:
        row=db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='pedido_escalas'").fetchone()
        if not row or "'desistiu'" in row[0]: return
        definition=row[0].replace("'escalada', 'presente', 'falta'", "'escalada', 'presente', 'falta', 'desistiu'")
        definition=re.sub(r'CREATE TABLE\s+(?:"pedido_escalas"|pedido_escalas)', 'CREATE TABLE pedido_escalas_new',definition,count=1,flags=re.I)
        objects=[r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE tbl_name='pedido_escalas' AND type IN ('index','trigger') AND sql IS NOT NULL")]
        sequence=db.execute("SELECT seq FROM sqlite_sequence WHERE name='pedido_escalas'").fetchone()
        db.execute('PRAGMA foreign_keys=OFF');db.execute('BEGIN IMMEDIATE')
        try:
            db.execute(definition);db.execute('INSERT INTO pedido_escalas_new SELECT * FROM pedido_escalas');db.execute('DROP TABLE pedido_escalas');db.execute('ALTER TABLE pedido_escalas_new RENAME TO pedido_escalas')
            for sql in objects: db.execute(sql)
            if sequence: db.execute("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='pedido_escalas'",(sequence[0],))
            if db.execute('PRAGMA foreign_key_check').fetchone(): raise ValueError('Referência de escala inválida na migração.')
            db.commit()
        except Exception: db.rollback();raise
        finally: db.execute('PRAGMA foreign_keys=ON')


def sync(db,order_id):
    order=db.execute('SELECT * FROM pedidos WHERE id=?',(order_id,)).fetchone()
    if not order or order['situacao'] in ('concluido','cancelado'): return
    shifts=json.loads(order['turnos'])
    counts=[db.execute("SELECT count(*) FROM pedido_escalas WHERE pedido_id=? AND data=? AND status NOT IN ('falta','desistiu')",(order_id,t['data'])).fetchone()[0] for t in shifts]
    status='confirmado' if counts and all(n>=order['quantidade_diaristas'] for n in counts) else 'em_selecao' if db.execute('SELECT 1 FROM pedido_escalas WHERE pedido_id=?',(order_id,)).fetchone() else 'novo'
    db.execute('UPDATE pedidos SET situacao=?,atualizado_em=? WHERE id=?',(status,datetime.now(timezone.utc).isoformat(),order_id))


def withdraw_remaining(db, order_id, scale_id, payload, core):
    old = db.execute('SELECT * FROM pedido_escalas WHERE id=? AND pedido_id=?', (scale_id, order_id)).fetchone()
    order = db.execute('SELECT * FROM pedidos WHERE id=?', (order_id,)).fetchone()
    if not old or not order: raise ValueError('Escala não encontrada.')
    if order['situacao'] in ('cancelado', 'concluido'): raise ValueError('Desistência disponível apenas em pedido aberto.')
    if old['status'] not in ('escalada', 'desistiu'): raise ValueError('Desistência disponível apenas antes da presença ou falta.')
    if old['substituida_por_escala_id']: raise ValueError('Esta escala já tem substituição registrada.')
    reason = old['desistencia_motivo'] if old['status'] == 'desistiu' else core.clean_text(payload.get('motivo'), 'o motivo da desistência', 300)
    if len(reason or '') < 5: raise ValueError('Informe o motivo da desistência com 5 a 300 caracteres.')
    now = datetime.now(timezone.utc).isoformat()
    changed = db.execute("""UPDATE pedido_escalas SET status='desistiu', desistencia_motivo=?,
        desistencia_em=?,desistencia_por='Servidor local',atualizado_em=?
        WHERE pedido_id=? AND diarista_id=? AND data>=? AND status='escalada'
        AND substituida_por_escala_id IS NULL""", (reason, now, now, order_id, old['diarista_id'], old['data'])).rowcount
    sync(db, order_id)
    row = next(r for r in core.order_scale_rows(db, order_id) if r['id'] == scale_id)
    return {**row, 'desistencias_registradas': changed}


def replace(db,order_id,scale_id,payload,core):
    if not isinstance(payload,dict) or type(payload.get('diarista_id')) is not int: raise ValueError('Escolha a pessoa substituta.')
    old=db.execute('SELECT * FROM pedido_escalas WHERE id=? AND pedido_id=?',(scale_id,order_id)).fetchone()
    order=db.execute('SELECT * FROM pedidos WHERE id=?',(order_id,)).fetchone()
    if not old or not order: raise ValueError('Escala não encontrada.')
    if payload.get('expected_updated_at') and payload['expected_updated_at']!=old['atualizado_em']: raise ValueError('A escala mudou depois da leitura. Confira novamente antes de substituir.')
    if order['situacao'] in ('cancelado','concluido') or old['status']=='presente': raise ValueError('Substituição disponível apenas antes da presença e em pedido aberto.')
    if old['diarista_id']==payload['diarista_id']: raise ValueError('Escolha outra pessoa para substituir.')
    if old['substituida_por_escala_id']:
        found=db.execute('SELECT * FROM pedido_escalas WHERE id=?',(old['substituida_por_escala_id'],)).fetchone()
        if found and found['diarista_id']==payload['diarista_id']: return dict(found)
        raise ValueError('Esta escala já tem substituição registrada.')
    if old['status']=='desistiu':
        withdraw_remaining(db,order_id,scale_id,{},core)
    person=db.execute('SELECT * FROM diaristas WHERE id=?',(payload['diarista_id'],)).fetchone()
    if not person or person['bloqueada']: raise ValueError('Escolha uma pessoa cadastrada e não bloqueada.')
    now=datetime.now(timezone.utc).isoformat()
    if old['status']=='escalada':
        reason=core.clean_text(payload.get('motivo'),'o motivo da desistência',300)
        if len(reason)<5: raise ValueError('Informe o motivo da desistência com 5 a 300 caracteres.')
        db.execute("UPDATE pedido_escalas SET status='desistiu',desistencia_motivo=?,desistencia_em=?,desistencia_por='Servidor local',atualizado_em=? WHERE id=?",(reason,now,now,scale_id))
    scoped=payload.get('disponibilidade_confirmada',False)
    if type(scoped) is not bool: raise ValueError('Confirme a disponibilidade para o dia.')
    core.validate_worker_shift(db,person,order,old['data'],scoped_availability=scoped)
    if db.execute('SELECT 1 FROM pedido_escalas WHERE pedido_id=? AND data=? AND diarista_id=?',(order_id,old['data'],person['id'])).fetchone(): raise ValueError('A pessoa já tem registro neste dia do pedido.')
    count=db.execute("SELECT count(*) FROM pedido_escalas WHERE pedido_id=? AND data=? AND status NOT IN ('falta','desistiu')",(order_id,old['data'])).fetchone()[0]
    if count>=order['quantidade_diaristas']: raise ValueError('As vagas deste dia já foram preenchidas.')
    new_id=db.execute("INSERT INTO pedido_escalas(pedido_id,diarista_id,data,status,disponibilidade_pedido_confirmada,criado_em,atualizado_em) VALUES (?,?,?,'escalada',?,?,?)",(order_id,person['id'],old['data'],int(scoped),now,now)).lastrowid
    db.execute('UPDATE pedido_escalas SET substituida_por_escala_id=? WHERE id=?',(new_id,scale_id));sync(db,order_id)
    return dict(db.execute('SELECT * FROM pedido_escalas WHERE id=?',(new_id,)).fetchone())
