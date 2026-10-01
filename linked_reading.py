"""Cadastro, pedido e escalas da mesma leitura, gravados em uma transação."""
import json
import re
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from uuid import UUID


def save(db, payload, core):
    if not isinstance(payload, dict):
        raise ValueError('Leitura de pedido inválida.')
    order_data = core.validate_order(payload.get('pedido'))
    person = core.validate(payload.get('diarista'))
    consent = payload.get('confirmar_cadastro', False)
    if type(consent) is not bool:
        raise ValueError('Confirme se deseja criar o cadastro.')
    key = payload.get('chave_operacao')
    if not isinstance(key, str) or str(UUID(key)) != key:
        raise ValueError('Chave da leitura inválida.')
    order_id, pending_id = payload.get('pedido_id'), payload.get('pendencia_id')
    for value in (order_id, pending_id):
        if value is not None and (type(value) is not int or value <= 0):
            raise ValueError('Referência inválida.')
    if not db.execute('SELECT 1 FROM lojas WHERE lower(rede)=lower(?) AND lower(nome)=lower(?)', (order_data['supermercado'], order_data['unidade'])).fetchone():
        raise ValueError('Confira a rede e a loja do pedido.')
    worker = db.execute('SELECT * FROM diaristas WHERE cpf=?', (person['cpf'],)).fetchone()
    if worker and re.sub(r'\s+', ' ', worker['nome'].strip()).casefold() != re.sub(r'\s+', ' ', person['nome'].strip()).casefold():
        raise ValueError(f"O CPF pertence a {worker['nome']}. Confira o nome informado.")
    if worker and worker['bloqueada']:
        raise ValueError('A pessoa informada está bloqueada. Revise o cadastro antes de escalar.')
    if not worker and not consent:
        return {'requires_registration': True, 'nome':person['nome'], 'cpf':person['cpf']}
    worker_created = worker is None
    now = datetime.now(timezone.utc).isoformat()
    if worker_created:
        # Only the two supplied identity fields. Do not infer experience or general availability.
        basic = core.validate({'nome': person['nome'], 'cpf': person['cpf']})
        columns, marks = ', '.join(basic), ', '.join('?' for _ in basic)
        worker_id = db.execute(f'INSERT INTO diaristas ({columns},criado_em,atualizado_em) VALUES ({marks},?,?)', (*basic.values(),now,now)).lastrowid
        worker = db.execute('SELECT * FROM diaristas WHERE id=?',(worker_id,)).fetchone()
    order = db.execute('SELECT * FROM pedidos WHERE id=?',(order_id,)).fetchone() if order_id else db.execute('SELECT * FROM pedidos WHERE chave_operacao=?',(key,)).fetchone()
    if order_id and not order:
        raise ValueError('O pedido não existe mais. Leia a mensagem novamente.')
    order_created = order is None
    if order:
        fixed = ('supermercado','unidade','setor','quantidade_diaristas','turnos')
        if any(order[k] != order_data[k] for k in fixed):
            raise ValueError('Confira o pedido existente: rede, loja, setor ou datas não correspondem.')
        if order['situacao'] in ('cancelado','concluido'):
            raise ValueError('Não é possível escalar em pedido encerrado.')
    else:
        order_data['chave_operacao'] = key
        columns, marks = ', '.join(order_data), ', '.join('?' for _ in order_data)
        order_id = db.execute(f'INSERT INTO pedidos ({columns},criado_em,atualizado_em) VALUES ({marks},?,?)', (*order_data.values(),now,now)).lastrowid
        order = db.execute('SELECT * FROM pedidos WHERE id=?',(order_id,)).fetchone()
    new_scales = []
    for shift in json.loads(order['turnos']):
        existing = db.execute('SELECT * FROM pedido_escalas WHERE pedido_id=? AND diarista_id=? AND data=?',(order['id'],worker['id'],shift['data'])).fetchone()
        if existing:
            if existing['status']=='falta':
                raise ValueError('Já há uma falta registrada neste pedido. Revise a escala no pedido.')
            continue
        core.validate_worker_shift(db, worker, order, shift['data'], scoped_availability=True)
        count = db.execute("SELECT count(*) FROM pedido_escalas WHERE pedido_id=? AND data=? AND status!='falta'",(order['id'],shift['data'])).fetchone()[0]
        if count >= order['quantidade_diaristas']:
            raise ValueError(f"As vagas de {shift['data']} já estão preenchidas.")
        scale_id = db.execute("INSERT INTO pedido_escalas(pedido_id,diarista_id,data,status,disponibilidade_pedido_confirmada,criado_em,atualizado_em) VALUES (?,?,?,'escalada',1,?,?)",(order['id'],worker['id'],shift['data'],now,now)).lastrowid
        new_scales.append(scale_id)
        absence=db.execute("SELECT id FROM pedido_escalas WHERE pedido_id=? AND data=? AND status='falta' AND substituida_por_escala_id IS NULL ORDER BY id LIMIT 1",(order['id'],shift['data'])).fetchone()
        if absence:
            db.execute('UPDATE pedido_escalas SET substituida_por_escala_id=? WHERE id=?',(scale_id,absence['id']))
    if pending_id:
        db.execute("UPDATE leituras_pendentes SET status='resolvido',atualizado_em=? WHERE id=? AND tipo='pedido' AND json_extract(dados,'$.diarista_escalado.cpf')=?",(now,pending_id,person['cpf']))
    return {'requires_registration':False,'pedido_id':order['id'],'diarista_id':worker['id'],'nome':worker['nome'],'cadastro_criado':worker_created,'pedido_criado':order_created,'escalas_criadas':new_scales,'dias':len(json.loads(order['turnos']))}


def handle(handler, core):
    try:
        payload = handler.read_json()
        with core.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            result=save(db,payload,core)
        return handler.respond(HTTPStatus.OK,result)
    except (ValueError,TypeError,json.JSONDecodeError) as error:
        return handler.respond(HTTPStatus.BAD_REQUEST,{'erro':str(error)})
    except sqlite3.IntegrityError as error:
        return handler.respond(HTTPStatus.CONFLICT,{'erro':str(error)})
