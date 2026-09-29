"""Cobranças e fechamentos transacionais do servidor SQLite local."""

from datetime import datetime, timezone


def ensure_schema(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS cobrancas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, rede TEXT NOT NULL,
            periodo_inicio TEXT NOT NULL, periodo_fim TEXT NOT NULL, vencimento TEXT NOT NULL,
            numero_nota TEXT NOT NULL DEFAULT '', valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
            status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','cancelada')),
            motivo_cancelamento TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cobranca_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cobranca_id INTEGER NOT NULL REFERENCES cobrancas(id) ON DELETE RESTRICT,
            diaria_id INTEGER NOT NULL UNIQUE REFERENCES diarias(id) ON DELETE RESTRICT,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
            data TEXT NOT NULL, valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0)
        );
        CREATE INDEX IF NOT EXISTS cobranca_itens_cobranca ON cobranca_itens(cobranca_id);
        CREATE TABLE IF NOT EXISTS cobranca_recebimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cobranca_id INTEGER NOT NULL REFERENCES cobrancas(id) ON DELETE RESTRICT,
            valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
            data_recebimento TEXT NOT NULL, forma TEXT NOT NULL DEFAULT '',
            estornado INTEGER NOT NULL DEFAULT 0, motivo_estorno TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pagamento_lotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            diarista_id INTEGER NOT NULL REFERENCES diaristas(id) ON DELETE RESTRICT,
            valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
            data_pagamento TEXT NOT NULL, forma TEXT NOT NULL DEFAULT '',
            quantidade INTEGER NOT NULL CHECK (quantidade > 0),
            status TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','reaberto')),
            motivo_reabertura TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL
        );
    """)
    columns = {row['name'] for row in db.execute('PRAGMA table_info(diarias)')}
    if 'pagamento_lote_id' not in columns:
        db.execute('ALTER TABLE diarias ADD COLUMN pagamento_lote_id INTEGER REFERENCES pagamento_lotes(id) ON DELETE RESTRICT')
    receipt_columns = {row['name'] for row in db.execute('PRAGMA table_info(cobranca_recebimentos)')}
    if 'estornado' not in receipt_columns:
        db.execute('ALTER TABLE cobranca_recebimentos ADD COLUMN estornado INTEGER NOT NULL DEFAULT 0')
    if 'motivo_estorno' not in receipt_columns:
        db.execute("ALTER TABLE cobranca_recebimentos ADD COLUMN motivo_estorno TEXT NOT NULL DEFAULT ''")
    db.execute('CREATE INDEX IF NOT EXISTS diarias_pagamento_lote ON diarias(pagamento_lote_id)')
    for table, fields in {
        'diaristas': ('id', 'nome', 'cpf', 'bloqueada'),
        'pedidos': ('id', 'supermercado', 'unidade', 'setor', 'quantidade_diaristas', 'turnos', 'situacao'),
        'cobrancas': ('id', 'rede', 'periodo_inicio', 'periodo_fim', 'vencimento', 'numero_nota', 'valor_centavos', 'status', 'motivo_cancelamento'),
        'cobranca_itens': ('id', 'cobranca_id', 'diaria_id', 'pedido_id', 'data', 'valor_centavos'),
        'cobranca_recebimentos': ('id', 'cobranca_id', 'valor_centavos', 'data_recebimento', 'forma', 'estornado', 'motivo_estorno'),
        'pagamento_lotes': ('id', 'diarista_id', 'valor_centavos', 'data_pagamento', 'forma', 'quantidade', 'status', 'motivo_reabertura'),
    }.items():
        for event in ('INSERT', 'UPDATE', 'DELETE'):
            old_json = "json_object(" + ', '.join(f"'{field}', OLD.{field}" for field in fields) + ')' if event != 'INSERT' else 'NULL'
            new_json = "json_object(" + ', '.join(f"'{field}', NEW.{field}" for field in fields) + ')' if event != 'DELETE' else 'NULL'
            row_id = 'OLD.id' if event == 'DELETE' else 'NEW.id'
            db.execute(f"""CREATE TRIGGER IF NOT EXISTS audit_{table}_{event.lower()}
                AFTER {event} ON {table} BEGIN
                INSERT INTO direct_auditoria (tabela, registro_id, operacao, antes, depois)
                VALUES ('{table}', {row_id}, '{event}', {old_json}, {new_json}); END""")
    db.execute("""CREATE TRIGGER IF NOT EXISTS guard_batch_daily_update
        BEFORE UPDATE ON diarias WHEN OLD.pagamento_lote_id IS NOT NULL
        AND (NEW.data_pagamento IS NOT OLD.data_pagamento OR NEW.valor_centavos IS NOT OLD.valor_centavos
          OR NEW.forma_pagamento IS NOT OLD.forma_pagamento OR NEW.pagamento_lote_id IS NOT OLD.pagamento_lote_id)
        AND (SELECT status FROM pagamento_lotes WHERE id = OLD.pagamento_lote_id) = 'pago'
        BEGIN SELECT RAISE(ABORT, 'Reabra o fechamento para corrigir uma diária paga em lote.'); END""")


def invoice_rows(db):
    result = []
    for row in db.execute('SELECT * FROM cobrancas ORDER BY id DESC'):
        item = dict(row)
        item['itens'] = [dict(x) for x in db.execute("""SELECT i.*, p.supermercado, p.unidade, p.setor,
            d.diarista_id, w.nome AS diarista_nome FROM cobranca_itens i
            JOIN pedidos p ON p.id = i.pedido_id JOIN diarias d ON d.id = i.diaria_id
            JOIN diaristas w ON w.id = d.diarista_id WHERE i.cobranca_id = ? ORDER BY i.data, i.id""", (row['id'],))]
        item['recebimentos'] = [dict(x) for x in db.execute(
            'SELECT * FROM cobranca_recebimentos WHERE cobranca_id = ? ORDER BY data_recebimento, id', (row['id'],))]
        item['valor_recebido_centavos'] = sum(x['valor_centavos'] for x in item['recebimentos'] if not x['estornado'])
        result.append(item)
    return result


def unbilled_rows(db, network, start, end):
    return db.execute("""SELECT d.id AS diaria_id, d.data, d.valor_recebido_centavos, e.pedido_id
        FROM diarias d JOIN pedido_escalas e ON e.id = d.pedido_escala_id
        JOIN pedidos p ON p.id = e.pedido_id
        WHERE lower(p.supermercado) = lower(?) AND d.data BETWEEN ? AND ? AND e.status = 'presente'
        AND NOT EXISTS (SELECT 1 FROM cobranca_itens i WHERE i.diaria_id = d.id)
        ORDER BY d.data, d.id""", (network.strip(), start, end)).fetchall()


def create_invoice(db, network, start, end, due, note):
    db.execute('BEGIN IMMEDIATE')
    items = unbilled_rows(db, network, start, end)
    missing = sum(row['valor_recebido_centavos'] is None for row in items)
    if missing:
        raise ValueError(f'{missing} presença(s) sem valor recebido configurado. Corrija antes da cobrança.')
    total = sum(row['valor_recebido_centavos'] for row in items)
    if total <= 0:
        raise ValueError('Nenhuma presença nova com valor encontrado nesse período.')
    now = datetime.now(timezone.utc).isoformat()
    cur = db.execute("""INSERT INTO cobrancas
        (rede, periodo_inicio, periodo_fim, vencimento, numero_nota, valor_centavos, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", (network.strip(), start, end, due, note.strip(), total, now, now))
    db.executemany("""INSERT INTO cobranca_itens
        (cobranca_id, diaria_id, pedido_id, data, valor_centavos) VALUES (?, ?, ?, ?, ?)""",
        [(cur.lastrowid, row['diaria_id'], row['pedido_id'], row['data'], row['valor_recebido_centavos']) for row in items])
    return cur.lastrowid


def receive_invoice(db, invoice_id, amount, day, method):
    db.execute('BEGIN IMMEDIATE')
    row = db.execute('SELECT * FROM cobrancas WHERE id = ?', (invoice_id,)).fetchone()
    if not row or row['status'] != 'aberta':
        raise ValueError('Cobrança não encontrada ou cancelada.')
    received = db.execute('SELECT coalesce(sum(valor_centavos),0) FROM cobranca_recebimentos WHERE cobranca_id = ? AND estornado = 0', (invoice_id,)).fetchone()[0]
    if received + amount > row['valor_centavos']:
        raise ValueError('O recebimento ultrapassa o saldo da cobrança.')
    return db.execute("""INSERT INTO cobranca_recebimentos
        (cobranca_id, valor_centavos, data_recebimento, forma, criado_em) VALUES (?, ?, ?, ?, ?)""",
        (invoice_id, amount, day, method, datetime.now(timezone.utc).isoformat())).lastrowid


def cancel_invoice(db, invoice_id, reason):
    db.execute('BEGIN IMMEDIATE')
    row = db.execute('SELECT * FROM cobrancas WHERE id = ?', (invoice_id,)).fetchone()
    if not row or row['status'] != 'aberta':
        raise ValueError('Cobrança não encontrada ou já cancelada.')
    if db.execute('SELECT 1 FROM cobranca_recebimentos WHERE cobranca_id = ? AND estornado = 0', (invoice_id,)).fetchone():
        raise ValueError('Esta cobrança já recebeu valores. Corrija o recebimento antes de cancelar.')
    db.execute('DELETE FROM cobranca_itens WHERE cobranca_id = ?', (invoice_id,))
    db.execute("UPDATE cobrancas SET status = 'cancelada', motivo_cancelamento = ?, atualizado_em = ? WHERE id = ?",
               (reason, datetime.now(timezone.utc).isoformat(), invoice_id))


def void_receipt(db, receipt_id, reason):
    db.execute('BEGIN IMMEDIATE')
    row = db.execute('SELECT * FROM cobranca_recebimentos WHERE id = ?', (receipt_id,)).fetchone()
    if not row or row['estornado']:
        raise ValueError('Recebimento não encontrado ou já estornado.')
    db.execute('UPDATE cobranca_recebimentos SET estornado = 1, motivo_estorno = ? WHERE id = ?', (reason, receipt_id))


def pay_batch(db, worker_id, daily_ids, day, method):
    db.execute('BEGIN IMMEDIATE')
    placeholders = ','.join('?' for _ in daily_ids)
    rows = db.execute(f'SELECT * FROM diarias WHERE id IN ({placeholders})', daily_ids).fetchall()
    if len(rows) != len(daily_ids) or any(row['diarista_id'] != worker_id or row['data_pagamento'] or
        row['pagamento_lote_id'] or not row['valor_centavos'] for row in rows):
        raise ValueError('Uma das diárias já foi paga, está sem valor ou pertence a outra pessoa.')
    total = sum(row['valor_centavos'] for row in rows)
    cur = db.execute("""INSERT INTO pagamento_lotes
        (diarista_id, valor_centavos, data_pagamento, forma, quantidade, criado_em) VALUES (?, ?, ?, ?, ?, ?)""",
        (worker_id, total, day, method, len(rows), datetime.now(timezone.utc).isoformat()))
    db.execute(f'UPDATE diarias SET data_pagamento = ?, forma_pagamento = ?, pagamento_lote_id = ? WHERE id IN ({placeholders})',
               (day, method, cur.lastrowid, *daily_ids))
    return cur.lastrowid


def reopen_batch(db, batch_id, reason):
    db.execute('BEGIN IMMEDIATE')
    row = db.execute('SELECT * FROM pagamento_lotes WHERE id = ?', (batch_id,)).fetchone()
    if not row or row['status'] != 'pago':
        raise ValueError('Fechamento não encontrado ou já reaberto.')
    db.execute("UPDATE pagamento_lotes SET status = 'reaberto', motivo_reabertura = ? WHERE id = ?", (reason, batch_id))
    db.execute('UPDATE diarias SET data_pagamento = NULL, pagamento_lote_id = NULL, motivo_ajuste = ? WHERE pagamento_lote_id = ?',
               (reason, batch_id))
