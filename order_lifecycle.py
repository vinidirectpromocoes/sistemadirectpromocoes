"""Operational order state; closed days never become future staffing vacancies."""
import json
from datetime import datetime,timezone
from zoneinfo import ZoneInfo

def today():return datetime.now(ZoneInfo('America/Fortaleza')).date().isoformat()
def state(order,scales,day=None):
    day=day or today();shifts=order['turnos'] if isinstance(order['turnos'],list) else json.loads(order['turnos']);rows=[dict(s) for s in scales if s['pedido_id']==order['id']];quantity=order['quantidade_diaristas']
    current=[t for t in shifts if t['data']>=day];ended=bool(shifts) and max(t['data'] for t in shifts)<day
    vacancies=sum(max(0,quantity-sum(s['data']==t['data'] and s['status'] not in ('falta','desistiu') for s in rows)) for t in current)
    pending=sum(s['status']=='escalada' and s['data']<day for s in rows)
    missing=sum(max(0,quantity-sum(s['data']==t['data'] and s['status']=='presente' for s in rows)) for t in shifts if t['data']<day)
    status=order['situacao'] if order['situacao'] in ('cancelado','concluido') else 'confirmado' if not vacancies else 'em_selecao' if rows else 'novo'
    return dict(situacao=status,periodo_finalizado=ended,encerravel=ended and pending==0 and order['situacao'] not in ('cancelado','concluido'),presencas_pendentes=pending,vagas_atuais=vacancies,dias_nao_atendidos=missing,presencas=sum(s['status']=='presente' for s in rows),faltas=sum(s['status']=='falta' for s in rows),dias_desistencia=sum(s['status']=='desistiu' for s in rows))
def versions(scales):return [dict(id=s['id'],status=s['status'],atualizado_em=s['atualizado_em']) for s in sorted(scales,key=lambda s:s['id'])]
def close(db,order_id,p):
    order=db.execute('SELECT * FROM pedidos WHERE id=?',(order_id,)).fetchone()
    if not order:raise ValueError('Pedido não encontrado.')
    if order['situacao']=='concluido':return dict(order)
    rows=db.execute('SELECT * FROM pedido_escalas WHERE pedido_id=?',(order_id,)).fetchall()
    if p.get('expected_updated_at')!=order['atualizado_em'] or p.get('expected_scales')!=versions(rows):raise ValueError('O pedido ou as presenças mudaram. Atualize e confira novamente.')
    info=state(order,rows)
    if not info['periodo_finalizado']:raise ValueError('Encerre somente após o último dia do pedido.')
    if order['situacao']=='cancelado':raise ValueError('Pedido cancelado; preserve o histórico.')
    if info['presencas_pendentes']:raise ValueError('Confira as presenças pendentes antes de encerrar. Não serão marcadas como falta automaticamente.')
    db.execute("UPDATE pedidos SET situacao='concluido',atualizado_em=? WHERE id=?",(datetime.now(timezone.utc).isoformat(),order_id))
    return dict(db.execute('SELECT * FROM pedidos WHERE id=?',(order_id,)).fetchone())
