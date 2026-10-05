"""Servidor local para o cadastro de diaristas."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import usability
import scale_lifecycle
import store_portal
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from catalogo_lojas import LOJAS
import linked_reading
import payment_calendar as calendar
import workflow_local as workflow
import operations_extended as extended
import sys


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DB_PATH = Path(os.environ.get("DIARISTAS_DB_PATH", ROOT / "data" / "diaristas.db"))
PORT = int(os.environ.get("DIARISTAS_PORT", "8000"))


DAYS = {"segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"}
ORDER_STATUSES = {"novo", "em_selecao", "confirmado", "concluido", "cancelado"}
FORTALEZA = ZoneInfo("America/Fortaleza")
WEEKDAYS = ("segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo")
TARIFAS_INICIAIS = (
    ("Hipermarket", 12400, 8500), ("Super do Povo", 13400, 9000),
    ("Super Lagoa", 13400, 9000), ("Fazendinha", 12900, 8500),
    ("Pinheiro", 13400, 9000), ("Variedades", 13400, 9000),
)
SETORES_INICIAIS = (
    "Operador de caixa", "Repositor de mercearia", "Repositor de FLV",
    "Repositor de frios", "Balconista de padaria", "Balconista de frios",
    "Balconista de açougue", "Auxiliar de depósito", "ASG", "Açougueiro",
)


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def migrate_partial_workers():
    """Relax only unknown yes/no answers, preserving existing IDs and related history."""
    with connect() as db:
        columns = list(db.execute("PRAGMA table_info(diaristas)"))
        if not any(row["name"] in ("trabalhando", "pode_se_deslocar") and row["notnull"] for row in columns):
            return
        definition = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='diaristas'").fetchone()[0]
        objects = [row[0] for row in db.execute("SELECT sql FROM sqlite_master WHERE tbl_name='diaristas' AND type IN ('index','trigger') AND sql IS NOT NULL")]
        sequence = db.execute("SELECT seq FROM sqlite_sequence WHERE name='diaristas'").fetchone()
        definition = re.sub(r'CREATE TABLE\s+(?:"diaristas"|diaristas)', 'CREATE TABLE diaristas_partial', definition, count=1, flags=re.I)
        definition = re.sub(r'(trabalhando|pode_se_deslocar)(\s+INTEGER)\s+NOT NULL', r'\1\2', definition, flags=re.I)
        db.execute("PRAGMA foreign_keys = OFF")
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute(definition)
            db.execute("INSERT INTO diaristas_partial SELECT * FROM diaristas")
            db.execute("DROP TABLE diaristas")
            db.execute("ALTER TABLE diaristas_partial RENAME TO diaristas")
            for sql in objects:
                db.execute(sql)
            if sequence:
                db.execute("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name='diaristas'", (sequence[0],))
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("Migração interrompida: referência de cadastro inválida.")
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.execute("PRAGMA foreign_keys = ON")


def init_db():
    migrate_partial_workers()
    scale_lifecycle.migrate(__import__(__name__))
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS diaristas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cpf TEXT NOT NULL UNIQUE,
            setores TEXT NOT NULL,
            cep TEXT NOT NULL,
            logradouro TEXT NOT NULL,
            numero TEXT NOT NULL,
            complemento TEXT NOT NULL DEFAULT '',
            bairro TEXT NOT NULL,
            cidade TEXT NOT NULL,
            uf TEXT NOT NULL,
            trabalhando INTEGER,
            local_trabalho TEXT NOT NULL DEFAULT '',
            disponibilidade TEXT NOT NULL,
            pode_se_deslocar INTEGER,
            transporte TEXT NOT NULL DEFAULT '',
            observacoes_locomocao TEXT NOT NULL DEFAULT '',
            bloqueada INTEGER NOT NULL DEFAULT 0,
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL
        )""")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(diaristas)")}
        if "bloqueada" not in columns:
            db.execute("ALTER TABLE diaristas ADD COLUMN bloqueada INTEGER NOT NULL DEFAULT 0")
        if "telefone" not in columns:
            db.execute("ALTER TABLE diaristas ADD COLUMN telefone TEXT NOT NULL DEFAULT ''")
        if "data_nascimento" not in columns:
            db.execute("ALTER TABLE diaristas ADD COLUMN data_nascimento TEXT")
        if "rede_trabalho" not in columns:
            db.execute("ALTER TABLE diaristas ADD COLUMN rede_trabalho TEXT NOT NULL DEFAULT ''")
        db.execute("CREATE INDEX IF NOT EXISTS idx_diaristas_nome ON diaristas(nome)")
        db.execute("""CREATE TABLE IF NOT EXISTS diarias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            diarista_id INTEGER NOT NULL REFERENCES diaristas(id) ON DELETE CASCADE,
            data TEXT NOT NULL,
            local TEXT NOT NULL,
            setor TEXT NOT NULL,
            observacoes TEXT NOT NULL DEFAULT '',
            data_pagamento TEXT,
            valor_centavos INTEGER,
            vencimento_pagamento TEXT,
            forma_pagamento TEXT NOT NULL DEFAULT '',
            motivo_ajuste TEXT NOT NULL DEFAULT '',
            criado_em TEXT NOT NULL
        )""")
        daily_columns = {row["name"] for row in db.execute("PRAGMA table_info(diarias)")}
        for column, definition in {
            "data_pagamento": "TEXT",
            "valor_centavos": "INTEGER",
            "vencimento_pagamento": "TEXT",
            "forma_pagamento": "TEXT NOT NULL DEFAULT ''",
            "motivo_ajuste": "TEXT NOT NULL DEFAULT ''",
            "pedido_escala_id": "INTEGER",
            "valor_recebido_centavos": "INTEGER",
            "vencimento_recebimento": "TEXT",
            "vencimento_origem": "TEXT NOT NULL DEFAULT 'manual'",
        }.items():
            if column not in daily_columns:
                db.execute(f"ALTER TABLE diarias ADD COLUMN {column} {definition}")
        db.execute("CREATE INDEX IF NOT EXISTS idx_diarias_diarista_data ON diarias(diarista_id, data DESC)")
        db.execute("""CREATE TABLE IF NOT EXISTS financeiro_lancamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
            descricao TEXT NOT NULL,
            categoria TEXT NOT NULL,
            contraparte TEXT NOT NULL,
            valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
            vencimento TEXT NOT NULL,
            data_pagamento TEXT,
            forma_pagamento TEXT NOT NULL DEFAULT '',
            observacoes TEXT NOT NULL DEFAULT '',
            motivo_ajuste TEXT NOT NULL DEFAULT '',
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_financeiro_vencimento ON financeiro_lancamentos(vencimento)")
        finance_columns = {row["name"] for row in db.execute("PRAGMA table_info(financeiro_lancamentos)")}
        if "motivo_ajuste" not in finance_columns:
            db.execute("ALTER TABLE financeiro_lancamentos ADD COLUMN motivo_ajuste TEXT NOT NULL DEFAULT ''")
        db.execute("""CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supermercado TEXT NOT NULL,
            unidade TEXT NOT NULL DEFAULT '',
            contato TEXT NOT NULL DEFAULT '',
            setor TEXT NOT NULL,
            quantidade_diaristas INTEGER NOT NULL CHECK (quantidade_diaristas BETWEEN 1 AND 100),
            turnos TEXT NOT NULL,
            situacao TEXT NOT NULL CHECK (situacao IN ('novo', 'em_selecao', 'confirmado', 'concluido', 'cancelado')),
            observacoes TEXT NOT NULL DEFAULT '',
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_pedidos_situacao ON pedidos(situacao)")
        db.execute("""CREATE TABLE IF NOT EXISTS leituras_pendentes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL CHECK (tipo IN ('diarista', 'pedido', 'indefinido')),
            chave TEXT NOT NULL UNIQUE,
            dados TEXT NOT NULL,
            texto TEXT NOT NULL,
            faltando TEXT NOT NULL,
            avisos TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido')),
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS pedido_escalas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
            diarista_id INTEGER NOT NULL REFERENCES diaristas(id) ON DELETE RESTRICT,
            data TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'escalada' CHECK (status IN ('escalada', 'presente', 'falta', 'desistiu')),
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL,
            UNIQUE(pedido_id, data, diarista_id)
        )""")
        scale_columns = {row["name"] for row in db.execute("PRAGMA table_info(pedido_escalas)")}
        for name, kind in (("desistencia_motivo", "TEXT"), ("desistencia_em", "TEXT"), ("desistencia_por", "TEXT"), ("falta_motivo", "TEXT"), ("falta_confirmada_por", "TEXT"),
                           ("falta_confirmada_em", "TEXT"), ("substituida_por_escala_id", "INTEGER")):
            if name not in scale_columns:
                db.execute(f"ALTER TABLE pedido_escalas ADD COLUMN {name} {kind}")
        scale_columns = {row['name'] for row in db.execute('PRAGMA table_info(pedido_escalas)')}
        if 'disponibilidade_pedido_confirmada' not in scale_columns:
            db.execute('ALTER TABLE pedido_escalas ADD COLUMN disponibilidade_pedido_confirmada INTEGER NOT NULL DEFAULT 0 CHECK(disponibilidade_pedido_confirmada IN (0,1))')
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_escala_substituta ON pedido_escalas(substituida_por_escala_id) WHERE substituida_por_escala_id IS NOT NULL")
        db.execute("CREATE INDEX IF NOT EXISTS idx_pedido_escalas_pedido_data ON pedido_escalas(pedido_id, data)")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_diarias_pedido_escala ON diarias(pedido_escala_id)")
        db.execute("""CREATE TABLE IF NOT EXISTS lojas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rede TEXT NOT NULL,
            nome TEXT NOT NULL,
            endereco TEXT NOT NULL,
            bairro TEXT NOT NULL DEFAULT '',
            cidade TEXT NOT NULL,
            uf TEXT NOT NULL DEFAULT 'CE',
            fonte_url TEXT NOT NULL DEFAULT '',
            situacao TEXT NOT NULL CHECK (situacao IN ('confirmado', 'revisar')),
            observacao TEXT NOT NULL DEFAULT '',
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL,
            UNIQUE(rede, nome)
        )""")
        for column in ('responsavel','telefone_contato','entrada','apresentacao','uniforme','orientacoes'):
            if column not in {r['name'] for r in db.execute('PRAGMA table_info(lojas)')}:
                db.execute(f"ALTER TABLE lojas ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        db.execute("CREATE TABLE IF NOT EXISTS pedido_modelos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL CHECK(length(trim(nome)) BETWEEN 1 AND 120), dados TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL)")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS pedido_modelos_nome_ci ON pedido_modelos(lower(trim(nome)))")
        db.execute("CREATE INDEX IF NOT EXISTS idx_lojas_rede_cidade ON lojas(rede, cidade)")
        db.execute("""CREATE TABLE IF NOT EXISTS tarifas_redes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rede TEXT NOT NULL UNIQUE,
            valor_recebido_centavos INTEGER NOT NULL CHECK (valor_recebido_centavos > 0),
            valor_padrao_centavos INTEGER NOT NULL CHECK (valor_padrao_centavos > 0),
            atualizado_em TEXT NOT NULL
        )""")
        rate_columns = {row["name"] for row in db.execute("PRAGMA table_info(tarifas_redes)")}
        for column in ("pagamento_primeira_quinzena", "pagamento_segunda_quinzena"):
            if column not in rate_columns:
                db.execute(f"ALTER TABLE tarifas_redes ADD COLUMN {column} INTEGER CHECK ({column} BETWEEN 1 AND 31)")
        if "pagamento_semanal_dia" not in rate_columns:
            db.execute("ALTER TABLE tarifas_redes ADD COLUMN pagamento_semanal_dia INTEGER CHECK (pagamento_semanal_dia IN (5,6))")
        db.execute("""CREATE TABLE IF NOT EXISTS tarifas_setores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rede TEXT REFERENCES tarifas_redes(rede) ON UPDATE CASCADE,
            setor TEXT NOT NULL CHECK (length(trim(setor)) BETWEEN 1 AND 80 AND setor = trim(setor)),
            valor_pago_centavos INTEGER CHECK (valor_pago_centavos > 0),
            atualizado_em TEXT NOT NULL
        )""")
        sector_columns = {row["name"]: row for row in db.execute("PRAGMA table_info(tarifas_setores)")}
        if sector_columns["rede"]["notnull"] or sector_columns["valor_pago_centavos"]["notnull"]:
            db.execute("""CREATE TABLE tarifas_setores_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                rede TEXT REFERENCES tarifas_redes(rede) ON UPDATE CASCADE,
                setor TEXT NOT NULL CHECK (length(trim(setor)) BETWEEN 1 AND 80 AND setor = trim(setor)),
                valor_pago_centavos INTEGER CHECK (valor_pago_centavos > 0),
                atualizado_em TEXT NOT NULL
            )""")
            db.execute("INSERT INTO tarifas_setores_new SELECT id, rede, setor, valor_pago_centavos, atualizado_em FROM tarifas_setores")
            db.execute("DROP TABLE tarifas_setores")
            db.execute("ALTER TABLE tarifas_setores_new RENAME TO tarifas_setores")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS tarifas_setores_rede_setor_ci ON tarifas_setores(rede, lower(setor)) WHERE rede IS NOT NULL")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS tarifas_setores_geral_ci ON tarifas_setores(lower(setor)) WHERE rede IS NULL")
        db.execute("CREATE TABLE IF NOT EXISTS direct_config_meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)")
        db.execute("""CREATE TABLE IF NOT EXISTS custos_extras (
            rede TEXT PRIMARY KEY REFERENCES tarifas_redes(rede) ON UPDATE CASCADE,
            transporte_centavos INTEGER NOT NULL DEFAULT 0 CHECK (transporte_centavos BETWEEN 0 AND 10000000),
            taxas_centavos INTEGER NOT NULL DEFAULT 0 CHECK (taxas_centavos BETWEEN 0 AND 10000000),
            outros_centavos INTEGER NOT NULL DEFAULT 0 CHECK (outros_centavos BETWEEN 0 AND 10000000),
            atualizado_em TEXT NOT NULL)""")
        db.execute("""CREATE TABLE IF NOT EXISTS direct_auditoria (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tabela TEXT NOT NULL, registro_id INTEGER NOT NULL,
            operacao TEXT NOT NULL, antes TEXT, depois TEXT, email_autor TEXT NOT NULL DEFAULT 'Servidor local',
            alterado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        for table, fields in {
            "diarias": ("id", "diarista_id", "data", "local", "setor", "valor_centavos", "vencimento_pagamento", "vencimento_recebimento", "vencimento_origem", "data_pagamento", "forma_pagamento", "motivo_ajuste"),
            "financeiro_lancamentos": ("id", "tipo", "descricao", "contraparte", "valor_centavos", "vencimento", "data_pagamento", "forma_pagamento", "motivo_ajuste"),
            "pedido_escalas": ("id", "pedido_id", "diarista_id", "data", "status", "disponibilidade_pedido_confirmada", "desistencia_motivo", "desistencia_em", "desistencia_por", "substituida_por_escala_id"),
            "tarifas_redes": ("id", "rede", "valor_recebido_centavos", "valor_padrao_centavos", "pagamento_primeira_quinzena", "pagamento_segunda_quinzena", "pagamento_semanal_dia"),
            "pedido_modelos": ("id", "nome", "dados"),
            "tarifas_setores": ("id", "rede", "setor", "valor_pago_centavos"),
        }.items():
            for event in (("UPDATE",) if table == "tarifas_redes" else ("INSERT", "UPDATE", "DELETE")):
                old_json = "json_object(" + ", ".join(f"'{field}', OLD.{field}" for field in fields) + ")" if event != "INSERT" else "NULL"
                new_json = "json_object(" + ", ".join(f"'{field}', NEW.{field}" for field in fields) + ")" if event != "DELETE" else "NULL"
                row_id = "OLD.id" if event == "DELETE" else "NEW.id"
                db.execute(f"DROP TRIGGER IF EXISTS audit_{table}_{event.lower()}")
                db.execute(f"""CREATE TRIGGER IF NOT EXISTS audit_{table}_{event.lower()}
                    AFTER {event} ON {table} BEGIN
                    INSERT INTO direct_auditoria (tabela, registro_id, operacao, antes, depois)
                    VALUES ('{table}', {row_id}, '{event}', {old_json}, {new_json});
                    END""")
        now = datetime.now(timezone.utc).isoformat()
        db.executemany("""INSERT OR IGNORE INTO lojas
            (rede, nome, endereco, bairro, cidade, fonte_url, situacao, observacao, criado_em, atualizado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (item + (now, now) for item in LOJAS))
        db.executemany("""INSERT OR IGNORE INTO tarifas_redes
            (rede, valor_recebido_centavos, valor_padrao_centavos, atualizado_em)
            VALUES (?, ?, ?, ?)""", (item + (now,) for item in TARIFAS_INICIAIS))
        db.execute("INSERT OR IGNORE INTO custos_extras(rede, atualizado_em) SELECT rede, ? FROM tarifas_redes", (now,))
        if not db.execute("SELECT 1 FROM direct_config_meta WHERE chave = 'setores_iniciais_v1'").fetchone():
            db.executemany("""INSERT OR IGNORE INTO tarifas_setores
                (rede, setor, valor_pago_centavos, atualizado_em) VALUES (NULL, ?, NULL, ?)""",
                ((setor, now) for setor in SETORES_INICIAIS))
            db.execute("INSERT INTO direct_config_meta (chave, valor) VALUES ('setores_iniciais_v1', 'aplicado')")
        workflow.ensure_schema(db)
        extended.ensure_schema(db)
        usability.ensure_schema(db)
        store_portal.ensure_schema(db)
        if not db.execute("SELECT 1 FROM direct_config_meta WHERE chave='calendario_pagamentos_v1'").fetchone():
            for network, (first, second) in calendar.INITIAL_CALENDARS.items():
                db.execute("UPDATE tarifas_redes SET pagamento_primeira_quinzena=?, pagamento_segunda_quinzena=? WHERE rede=?", (first, second, network))
            # Only the old automatic service-date default; retain explicit manual edits.
            for row in db.execute("SELECT id FROM diarias WHERE pedido_escala_id IS NOT NULL AND data_pagamento IS NULL AND pagamento_lote_id IS NULL AND vencimento_pagamento=data").fetchall():
                edited = any(json.loads(a['antes'] or '{}').get('vencimento_pagamento') != json.loads(a['depois'] or '{}').get('vencimento_pagamento') for a in db.execute("SELECT antes,depois FROM direct_auditoria WHERE tabela='diarias' AND registro_id=? AND operacao='UPDATE'", (row['id'],)))
                if not edited:
                    db.execute("UPDATE diarias SET vencimento_origem='calendario' WHERE id=?", (row['id'],))
            for network in db.execute("SELECT id FROM tarifas_redes").fetchall():
                calendar.refresh_pending(db, network['id'])
            db.execute("INSERT INTO direct_config_meta VALUES ('calendario_pagamentos_v1','aplicado')")
        if not db.execute("SELECT 1 FROM direct_config_meta WHERE chave='calendario_pagamentos_semanal_v1'").fetchone():
            for network, weekday in calendar.INITIAL_WEEKLY_CALENDARS.items():
                db.execute("UPDATE tarifas_redes SET pagamento_semanal_dia=? WHERE rede=? AND pagamento_primeira_quinzena IS NULL AND pagamento_segunda_quinzena IS NULL AND pagamento_semanal_dia IS NULL", (weekday, network))
            for network in db.execute("SELECT id FROM tarifas_redes WHERE pagamento_semanal_dia IS NOT NULL").fetchall():
                calendar.refresh_pending(db, network['id'])
            db.execute("INSERT INTO direct_config_meta VALUES ('calendario_pagamentos_semanal_v1','aplicado')")


def valid_cpf(cpf):
    if not re.fullmatch(r"\d{11}", cpf) or len(set(cpf)) == 1:
        return False
    for size in (9, 10):
        total = sum(int(cpf[i]) * (size + 1 - i) for i in range(size))
        digit = (total * 10) % 11
        if (0 if digit == 10 else digit) != int(cpf[size]):
            return False
    return True


def clean_text(value, label, max_length=180, required=True):
    if not isinstance(value, str):
        raise ValueError(f"{label} deve ser texto.")
    value = " ".join(value.split())
    if required and not value:
        raise ValueError(f"Preencha {label}.")
    if len(value) > max_length:
        raise ValueError(f"{label} deve ter no máximo {max_length} caracteres.")
    return value


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError("Dados inválidos.")
    nome = clean_text(payload.get("nome"), "o nome")
    cpf = re.sub(r"\D", "", str(payload.get("cpf", "")))
    if not valid_cpf(cpf):
        raise ValueError("Informe um CPF válido.")
    telefone = re.sub(r"\D", "", str(payload.get("telefone") or ""))
    if telefone and not re.fullmatch(r"[0-9]{10,13}", telefone):
        raise ValueError("Confira o telefone com DDD (10 a 13 números).")
    setores = payload.get("setores", [])
    if not isinstance(setores, list) or len(setores) > 12:
        raise ValueError("Informe até 12 setores de experiência.")
    setores = list(dict.fromkeys(clean_text(item, "o setor", 60) for item in setores))
    address = {}
    for key, label, length in [
        ("logradouro", "o logradouro", 180), ("numero", "o número", 30),
        ("bairro", "o bairro", 100),
    ]:
        address[key] = clean_text(payload.get(key, ""), label, length, False)
    address["complemento"] = clean_text(payload.get("complemento", ""), "o complemento", 120, False)
    cep = re.sub(r"\D", "", str(payload.get("cep", "")))
    if cep and len(cep) != 8:
        raise ValueError("Informe um CEP com 8 dígitos.")
    trabalhando = payload.get("trabalhando")
    if trabalhando is not None and not isinstance(trabalhando, bool):
        raise ValueError("Informe se está trabalhando atualmente.")
    local_trabalho = clean_text(payload.get("local_trabalho", ""), "o local de trabalho", 180, False)
    if trabalhando is False:
        local_trabalho = ""
    disponibilidade = payload.get("disponibilidade", [])
    if not isinstance(disponibilidade, list) or len(disponibilidade) > 7:
        raise ValueError("Informe até sete dias e horários disponíveis.")
    days_seen = set()
    slots = []
    for item in disponibilidade:
        if not isinstance(item, dict):
            raise ValueError("Disponibilidade inválida.")
        day, start, end = item.get("dia"), item.get("inicio"), item.get("fim")
        if day not in DAYS or day in days_seen or not all(isinstance(x, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", x) for x in (start, end)) or start >= end:
            raise ValueError("Confira os dias e horários disponíveis.")
        days_seen.add(day)
        slots.append({"dia": day, "inicio": start, "fim": end})
    pode_se_deslocar = payload.get("pode_se_deslocar")
    if pode_se_deslocar is not None and not isinstance(pode_se_deslocar, bool):
        raise ValueError("Informe a disponibilidade de locomoção.")
    transporte = clean_text(payload.get("transporte", ""), "o meio de transporte", 80, False)
    observacoes = clean_text(payload.get("observacoes_locomocao", ""), "as observações de locomoção", 300, False)
    nascimento = payload.get("data_nascimento") or None
    if nascimento:
        try:
            birth = date.fromisoformat(nascimento)
            if birth < date(1900, 1, 1) or birth > date.today():
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError("Confira a data de nascimento.")
    cidade = clean_text(payload.get("cidade") or "Fortaleza", "a cidade", 80)
    uf = clean_text(payload.get("uf") or "CE", "a UF", 2).upper()
    if not re.fullmatch(r"[A-Z]{2}", uf):
        raise ValueError("Confira a UF.")
    return {
        "data_nascimento": nascimento, "rede_trabalho": clean_text(payload.get("rede_trabalho", ""), "a empresa", 100, False),
        "nome": nome, "cpf": cpf, "telefone": telefone, "setores": json.dumps(setores, ensure_ascii=False),
        "cep": cep, **address, "cidade": cidade, "uf": uf,
        "trabalhando": None if trabalhando is None else int(trabalhando),
        "local_trabalho": local_trabalho,
        "disponibilidade": json.dumps(slots, ensure_ascii=False),
        "pode_se_deslocar": None if pode_se_deslocar is None else int(pode_se_deslocar), "transporte": transporte,
        "observacoes_locomocao": observacoes,
    }


def public_row(row):
    value = dict(row)
    value["setores"] = json.loads(value["setores"])
    value["disponibilidade"] = json.loads(value["disponibilidade"])
    value["trabalhando"] = None if value["trabalhando"] is None else bool(value["trabalhando"])
    value["pode_se_deslocar"] = None if value["pode_se_deslocar"] is None else bool(value["pode_se_deslocar"])
    value["bloqueada"] = bool(value["bloqueada"])
    return value


def validate_date(value, label, required=True):
    if value in (None, "") and not required:
        return None
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError
    except ValueError:
        raise ValueError(f"Informe uma data válida para {label}.") from None
    return value


def money_cents(value, required=False):
    if value in (None, "") and not required:
        return None
    if isinstance(value, bool):
        raise ValueError("Informe um valor válido maior que zero.")
    try:
        amount = Decimal(str(value).strip().replace(",", "."))
        cents = amount * 100
        if not amount.is_finite() or cents != cents.to_integral_value() or cents <= 0 or cents > 100_000_000_00:
            raise ValueError
    except (InvalidOperation, ValueError):
        raise ValueError("Informe um valor válido maior que zero, com até duas casas decimais.") from None
    return int(cents)


def extra_cost_cents(value):
    if isinstance(value, bool) or value in (None, ""):
        raise ValueError("Informe custos válidos a partir de zero.")
    try:
        amount = Decimal(str(value).strip().replace(",", "."))
        cents = amount * 100
        if not amount.is_finite() or cents != cents.to_integral_value() or not 0 <= cents <= 10000000:
            raise ValueError
    except (InvalidOperation, ValueError):
        raise ValueError("Informe custos de zero a R$ 100.000,00 com até duas casas decimais.") from None
    return int(cents)


def validate_daily_finance(payload):
    result = {
        "data_pagamento": validate_date(payload.get("data_pagamento"), "o pagamento", False),
        "valor_centavos": money_cents(payload.get("valor")),
        "vencimento_pagamento": validate_date(payload.get("vencimento_pagamento"), "o vencimento", False),
        "forma_pagamento": clean_text(payload.get("forma_pagamento", ""), "a forma de pagamento", 80, False),
    }
    validate_payment_consistency(result["data_pagamento"], result["valor_centavos"], result["vencimento_pagamento"])
    return result


def validate_payment_consistency(paid, amount, due, unknown_calendar=False):
    if paid and amount is None:
        raise ValueError("Informe o valor da diária paga.")
    if amount is not None and not paid and not due and not unknown_calendar:
        raise ValueError("Informe o vencimento da diária pendente com valor.")


def validate_diaria(payload):
    if not isinstance(payload, dict):
        raise ValueError("Dados da diária inválidos.")
    return {
        "data": validate_date(payload.get("data"), "a diária"),
        "local": clean_text(payload.get("local"), "o local da diária"),
        "setor": clean_text(payload.get("setor"), "o setor da diária", 80),
        "observacoes": clean_text(payload.get("observacoes", ""), "as observações", 500, False),
        **validate_daily_finance(payload),
    }


def validate_finance_entry(payload):
    if not isinstance(payload, dict):
        raise ValueError("Dados financeiros inválidos.")
    kind = payload.get("tipo")
    if kind not in {"receita", "despesa"}:
        raise ValueError("Selecione entrada ou saída.")
    return {
        "tipo": kind,
        "descricao": clean_text(payload.get("descricao"), "a descrição", 180),
        "categoria": clean_text(payload.get("categoria"), "a categoria", 80),
        "contraparte": clean_text(payload.get("contraparte"), "o cliente ou fornecedor", 180),
        "valor_centavos": money_cents(payload.get("valor"), True),
        "vencimento": validate_date(payload.get("vencimento"), "o vencimento"),
        "data_pagamento": validate_date(payload.get("data_pagamento"), "o pagamento", False),
        "forma_pagamento": clean_text(payload.get("forma_pagamento", ""), "a forma de pagamento", 80, False),
        "observacoes": clean_text(payload.get("observacoes", ""), "as observações", 500, False),
        "motivo_ajuste": clean_text(payload.get("motivo_ajuste", ""), "o motivo da correção", 300, False),
    }


def finance_rows():
    with connect() as db:
        manual = db.execute("SELECT * FROM financeiro_lancamentos ORDER BY vencimento DESC, id DESC").fetchall()
        daily = db.execute("""SELECT d.*, p.nome AS diarista_nome FROM diarias d
                              JOIN diaristas p ON p.id = d.diarista_id
                              ORDER BY d.data DESC, d.id DESC""").fetchall()
        invoices = workflow.invoice_rows(db)
    result = []
    for row in manual:
        item = dict(row)
        item.update({"chave": f"manual:{row['id']}", "origem": "manual", "referencia": row["vencimento"], "diarista_id": None})
        result.append(item)
    for row in daily:
        item = dict(row)
        item.update({
            "chave": f"diaria:{row['id']}", "origem": "diaria", "tipo": "despesa",
            "descricao": f"Diária · {row['setor']} · {row['local']}",
            "categoria": "Pagamento de diarista", "contraparte": row["diarista_nome"],
            "vencimento": row["vencimento_pagamento"], "referencia": row["data"],
            "diarista_id": row["diarista_id"],
        })
        result.append(item)
    for invoice in invoices:
        if invoice['status'] == 'cancelada':
            continue
        result.append({**invoice, 'chave': f"cobranca:{invoice['id']}", 'origem': 'cobranca',
                       'tipo': 'receita', 'descricao': f"Cobrança · {invoice['rede']}",
                       'categoria': 'Serviços faturados', 'contraparte': invoice['rede'],
                       'referencia': invoice['periodo_fim'], 'data_pagamento': None,
                       'forma_pagamento': '', 'observacoes': invoice['numero_nota'],
                       'diarista_id': None})
    return result


def validate_order(payload):
    if not isinstance(payload, dict):
        raise ValueError("Dados do pedido inválidos.")
    quantity = payload.get("quantidade_diaristas")
    if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 100:
        raise ValueError("Informe de 1 a 100 diaristas por dia.")
    status = payload.get("situacao", "novo")
    if status not in ORDER_STATUSES:
        raise ValueError("Selecione uma situação válida para o pedido.")
    shifts = payload.get("turnos")
    if not isinstance(shifts, list) or not 1 <= len(shifts) <= 90:
        raise ValueError("Informe de 1 a 90 datas para o pedido.")
    seen = set()
    normalized = []
    for shift in shifts:
        if not isinstance(shift, dict):
            raise ValueError("Confira as datas e horários do pedido.")
        day = validate_date(shift.get("data"), "o turno")
        start, end = shift.get("inicio"), shift.get("fim")
        if day in seen or not all(isinstance(t, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", t) for t in (start, end)) or start >= end:
            raise ValueError("Cada data deve aparecer uma vez, com início anterior ao fim.")
        seen.add(day)
        normalized.append({"data": day, "inicio": start, "fim": end})
    return {
        "supermercado": clean_text(payload.get("supermercado"), "o supermercado", 180),
        "unidade": clean_text(payload.get("unidade", ""), "a unidade", 180, False),
        "contato": clean_text(payload.get("contato", ""), "o contato", 180, False),
        "setor": clean_text(payload.get("setor"), "o setor", 80),
        "quantidade_diaristas": quantity,
        "turnos": json.dumps(sorted(normalized, key=lambda item: item["data"]), ensure_ascii=False),
        "situacao": status,
        "observacoes": clean_text(payload.get("observacoes", ""), "as observações", 500, False),
    }


def public_order(row):
    item = dict(row)
    item["turnos"] = json.loads(item["turnos"])
    item["quantidade_dias"] = len(item["turnos"])
    item["total_diarias"] = item["quantidade_diaristas"] * item["quantidade_dias"]
    return item


def public_reading(row):
    item = dict(row)
    for key in ("dados", "faltando", "avisos"):
        item[key] = json.loads(item[key])
    return item


def validate_reading(payload):
    if not isinstance(payload, dict):
        raise ValueError("Leitura inválida.")
    tipo = payload.get("tipo")
    if tipo not in ("diarista", "pedido", "indefinido"):
        raise ValueError("Tipo de leitura inválido.")
    chave = clean_text(payload.get("chave"), "a chave", 300)
    texto = clean_text(payload.get("texto"), "o texto", 30000)
    dados = payload.get("dados")
    faltando = payload.get("faltando")
    avisos = payload.get("avisos", [])
    if not isinstance(dados, dict) or not isinstance(faltando, list) or not isinstance(avisos, list):
        raise ValueError("Dados da leitura inválidos.")
    if len(json.dumps(dados)) > 30000 or len(faltando) > 20 or len(avisos) > 20:
        raise ValueError("Leitura grande demais.")
    return {"tipo": tipo, "chave": chave, "dados": json.dumps(dados, ensure_ascii=False),
            "texto": texto, "faltando": json.dumps(faltando, ensure_ascii=False),
            "avisos": json.dumps(avisos, ensure_ascii=False)}


def public_scale(row):
    item = dict(row)
    item["diaria"] = None if item.get("diaria_id") is None else {
        key: item[key] for key in ("diaria_id", "data_pagamento", "valor_centavos", "valor_recebido_centavos", "vencimento_pagamento", "vencimento_recebimento", "vencimento_origem", "forma_pagamento", "pagamento_lote_id", "contrato_id")
    }
    if item["diaria"]:
        item["diaria"]["id"] = item["diaria"].pop("diaria_id")
    return item


def order_shift(order, day):
    return next((shift for shift in json.loads(order["turnos"]) if shift["data"] == day), None)


def validate_worker_shift(db, worker, order, day, scoped_availability=False):
    shift = order_shift(order, day)
    if shift is None:
        raise ValueError("A data escolhida não consta no pedido.")
    # A escolha de dias e horários é livre; cada pedido conserva sua própria escala.


def order_scale_rows(db, order_id):
    return [public_scale(row) for row in db.execute("""SELECT e.*, p.nome AS diarista_nome,
        d.id AS diaria_id, d.data_pagamento, d.valor_centavos, d.valor_recebido_centavos, d.vencimento_pagamento, d.vencimento_recebimento, d.vencimento_origem, d.forma_pagamento, d.pagamento_lote_id, d.contrato_id
        FROM pedido_escalas e JOIN diaristas p ON p.id = e.diarista_id
        LEFT JOIN diarias d ON d.pedido_escala_id = e.id
        WHERE e.pedido_id = ? ORDER BY e.data, e.id""", (order_id,))]


def all_scale_rows(db):
    return [public_scale(row) for row in db.execute("""SELECT e.*, p.nome AS diarista_nome,
        d.id AS diaria_id, d.data_pagamento, d.valor_centavos, d.valor_recebido_centavos,
        d.vencimento_pagamento, d.vencimento_recebimento, d.vencimento_origem, d.forma_pagamento, d.pagamento_lote_id, d.contrato_id
        FROM pedido_escalas e JOIN diaristas p ON p.id = e.diarista_id
        LEFT JOIN diarias d ON d.pedido_escala_id = e.id
        ORDER BY e.pedido_id, e.data, e.id""")]


REDES = ("Super do Povo", "Super Lagoa", "Fazendinha", "Hipermarket", "Pinheiro", "Variedades")


def validate_network_tariff(payload):
    if not isinstance(payload, dict):
        raise ValueError("Dados da tarifa inválidos.")
    return {
        "valor_recebido_centavos": money_cents(payload.get("valor_recebido"), True),
        "valor_padrao_centavos": money_cents(payload.get("valor_padrao"), True),
    }


def validate_sector_tariff(payload):
    if not isinstance(payload, dict):
        raise ValueError("Dados do setor inválidos.")
    rede = payload.get("rede")
    if rede not in (None, *REDES):
        raise ValueError("Selecione uma rede cadastrada.")
    return {
        "rede": rede,
        "setor": clean_text(payload.get("setor"), "o setor", 80),
        "valor_pago_centavos": money_cents(payload.get("valor_pago")),
    }


def validate_store(payload):
    if not isinstance(payload, dict):
        raise ValueError("Dados da loja inválidos.")
    rede = payload.get("rede")
    if rede not in REDES:
        raise ValueError("Selecione uma rede cadastrada.")
    situacao = payload.get("situacao", "revisar")
    if situacao not in {"confirmado", "revisar"}:
        raise ValueError("Situação da loja inválida.")
    cidade = clean_text(payload.get("cidade"), "a cidade", 80)
    fonte = clean_text(payload.get("fonte_url", ""), "a fonte", 500, False)
    if fonte and not re.fullmatch(r"https://[^\s]+", fonte):
        raise ValueError("A fonte deve ser um endereço HTTPS válido.")
    return {
        "rede": rede,
        "nome": clean_text(payload.get("nome"), "o nome da loja", 120),
        "endereco": clean_text(payload.get("endereco"), "o endereço", 250),
        "bairro": clean_text(payload.get("bairro", ""), "o bairro", 100, False),
        "cidade": cidade,
        "uf": "CE",
        "fonte_url": fonte,
        "situacao": situacao,
        "observacao": clean_text(payload.get("observacao", ""), "a observação", 400, False),
        **{k: clean_text(payload.get(k, ""), k, 1000 if k == 'orientacoes' else 180, False) for k in ('responsavel','telefone_contato','entrada','apresentacao','uniforme','orientacoes')},
    }


def apply_local_attendance(db, order_id, scale_id, payload):
    status = payload.get('status')
    if status not in ('escalada','presente','falta','desistiu'): raise ValueError('Selecione presença ou falta.')
    scale = db.execute("SELECT * FROM pedido_escalas WHERE id = ? AND pedido_id = ?", (scale_id, order_id)).fetchone()
    if not scale:
        raise ValueError("Escala não encontrada.")
    order = db.execute("SELECT * FROM pedidos WHERE id = ?", (order_id,)).fetchone()
    if scale['status']=='desistiu' and status!='desistiu': raise ValueError('Preserve a desistência registrada. Escolha uma substituição.')
    if status=='desistiu' and scale['status'] not in ('escalada','desistiu'): raise ValueError('Desistência disponível apenas antes da presença ou falta.')
    if status != scale["status"]:
        reason = clean_text(payload.get("motivo"), "o motivo da falta ou desistência", 300) if status in ("falta","desistiu") else None
        if reason is not None and len(reason) < 5:
            raise ValueError("Informe o motivo da falta com pelo menos 5 caracteres.")
        if status in {"presente", "falta"} and scale["data"] > datetime.now(FORTALEZA).date().isoformat():
            raise ValueError("Presença ou falta só pode ser registrada a partir da data da diária.")
        if scale["status"] == "presente":
            daily = db.execute("SELECT data_pagamento FROM diarias WHERE pedido_escala_id = ?", (scale["id"],)).fetchone()
            if daily and daily["data_pagamento"]:
                raise ValueError("A diária já foi paga. Corrija o pagamento antes de alterar a presença.")
            if db.execute("""SELECT 1 FROM cobranca_itens i JOIN diarias d ON d.id = i.diaria_id
                WHERE d.pedido_escala_id = ?""", (scale["id"],)).fetchone():
                raise ValueError("Esta presença já entrou numa cobrança. Cancele a cobrança antes de corrigir a falta.")
            db.execute("DELETE FROM diarias WHERE pedido_escala_id = ?", (scale["id"],))
        if scale["status"] == "falta" and status != "falta":
            person = db.execute("SELECT * FROM diaristas WHERE id=?", (scale["diarista_id"],)).fetchone()
            if not person or person["bloqueada"] or order["situacao"] in {"cancelado", "concluido"}:
                raise ValueError("Confira o cadastro e a situação do pedido antes de reativar a escala.")
            validate_worker_shift(db, person, order, scale["data"], scoped_availability=bool(scale["disponibilidade_pedido_confirmada"]))
            count = db.execute("SELECT count(*) FROM pedido_escalas WHERE pedido_id = ? AND data = ? AND status NOT IN ('falta','desistiu')", (order_id, scale["data"])).fetchone()[0]
            if count >= order["quantidade_diaristas"]:
                raise ValueError("A quantidade de diaristas deste dia já foi preenchida.")
        if status == "presente":
            local = order["supermercado"] + (f" · {order['unidade']}" if order["unidade"] else "")
            network_rate = db.execute("SELECT * FROM tarifas_redes WHERE lower(rede) = lower(?)", (order["supermercado"],)).fetchone()
            sector_rate = db.execute("""SELECT valor_pago_centavos FROM tarifas_setores
                WHERE lower(setor) = lower(?) AND (lower(rede) = lower(?) OR rede IS NULL) AND valor_pago_centavos IS NOT NULL
                ORDER BY CASE WHEN lower(rede) = lower(?) THEN 0 ELSE 1 END LIMIT 1""",
                (order["setor"], order["supermercado"], order["supermercado"])).fetchone()
            paid_rate = sector_rate[0] if sector_rate else (network_rate["valor_padrao_centavos"] if network_rate else None)
            received_rate = network_rate["valor_recebido_centavos"] if network_rate else None
            contract = extended.effective_contract(db, order, scale['data'])
            if contract:
                paid_rate = contract['valor_pago_centavos'] if contract['valor_pago_centavos'] is not None else paid_rate
                received_rate = contract['valor_recebido_centavos'] if contract['valor_recebido_centavos'] is not None else received_rate
            due = calendar.payment_due(scale['data'], network_rate['pagamento_primeira_quinzena'], network_rate['pagamento_segunda_quinzena'], network_rate['pagamento_semanal_dia']) if network_rate else None
            db.execute("""INSERT INTO diarias (diarista_id, data, local, setor, observacoes, pedido_escala_id,
                valor_centavos, valor_recebido_centavos, vencimento_pagamento, criado_em, contrato_id, vencimento_recebimento, vencimento_origem)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (scale["diarista_id"], scale["data"], local, order["setor"],
                 f"Presença no pedido #{order_id}", scale["id"], paid_rate, received_rate,
                 due, datetime.now(timezone.utc).isoformat(), contract["id"] if contract else None, due, "calendario" if due else "nao_informado"))
        now = datetime.now(timezone.utc).isoformat()
        db.execute("""UPDATE pedido_escalas SET status = ?, atualizado_em = ?,
            falta_motivo = ?, falta_confirmada_por = ?, falta_confirmada_em = ?,
            substituida_por_escala_id = CASE WHEN ? IN ('falta','desistiu') THEN substituida_por_escala_id ELSE NULL END
            WHERE id = ?""", (status, now, reason if status=='falta' else None, "Servidor local" if status=='falta' else None,
            now if status=='falta' else None, status, scale["id"]))
        if status=='desistiu': db.execute('UPDATE pedido_escalas SET desistencia_motivo=?,desistencia_em=?,desistencia_por=? WHERE id=?',(reason,now,'Servidor local',scale['id']))
        scale_lifecycle.sync(db,order_id)
        if scale['status'] == 'presente' and status != 'presente':
            db.execute("UPDATE pedido_escalas SET loja_validacao='pendente',loja_responsavel='',loja_observacao='',chegada_em=NULL,saida_em=NULL,loja_validada_em=NULL,loja_validada_por=NULL WHERE id=?", (scale['id'],))
    row = next(row for row in order_scale_rows(db, order_id) if row["id"] == scale["id"])
    return row


class Handler(BaseHTTPRequestHandler):
    def _allowed_origin(self):
        host = self.headers.get("Host", "")
        hosts = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
        if host not in hosts:
            return False
        origin = self.headers.get("Origin")
        return not origin or origin in {f"http://{host}" for host in hosts}

    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        data = json.dumps(body, ensure_ascii=False).encode() if content_type.startswith("application/json") else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def route_id(self):
        match = re.fullmatch(r"/api/diaristas/(\d+)", urlparse(self.path).path)
        return int(match.group(1)) if match else None

    def route_diarias(self):
        match = re.fullmatch(r"/api/diaristas/(\d+)/diarias(?:/(\d+))?", urlparse(self.path).path)
        return (int(match.group(1)), int(match.group(2)) if match.group(2) else None) if match else None

    def route_escalas(self):
        match = re.fullmatch(r"/api/pedidos/(\d+)/escalas(?:/(\d+))?", urlparse(self.path).path)
        return (int(match.group(1)), int(match.group(2)) if match.group(2) else None) if match else None

    def read_json(self, max_length=20000):
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            raise ValueError("Envie os dados em JSON.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > max_length:
            raise ValueError("O cadastro está vazio ou é grande demais.")
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        if not self._allowed_origin():
            return self.respond(HTTPStatus.FORBIDDEN, {"erro": "Acesso não permitido."})
        path = urlparse(self.path).path
        if usability.handle(self, "GET", sys.modules[__name__]): return
        if extended.handle(self, "GET", sys.modules[__name__]): return
        if store_portal.handle(self, "GET", sys.modules[__name__]): return
        if path == "/api/diaristas":
            with connect() as db:
                rows = db.execute("SELECT * FROM diaristas ORDER BY nome COLLATE NOCASE").fetchall()
            return self.respond(HTTPStatus.OK, [public_row(row) for row in rows])
        if path == "/api/financeiro":
            return self.respond(HTTPStatus.OK, finance_rows())
        if path == "/api/cobrancas":
            with connect() as db:
                return self.respond(HTTPStatus.OK, workflow.invoice_rows(db))
        if path == "/api/pagamento-lotes":
            with connect() as db:
                rows = db.execute("""SELECT l.*, d.nome AS diarista_nome FROM pagamento_lotes l
                    JOIN diaristas d ON d.id = l.diarista_id ORDER BY l.id DESC""").fetchall()
            return self.respond(HTTPStatus.OK, [dict(row) for row in rows])
        if path == "/api/auditoria":
            with connect() as db:
                rows = db.execute("SELECT * FROM direct_auditoria ORDER BY id DESC LIMIT 100").fetchall()
            return self.respond(HTTPStatus.OK, [
                {**dict(row), "antes": json.loads(row["antes"]) if row["antes"] else None,
                 "depois": json.loads(row["depois"]) if row["depois"] else None}
                for row in rows
            ])
        if path == "/api/pedidos":
            with connect() as db:
                rows = db.execute("SELECT * FROM pedidos ORDER BY id DESC").fetchall()
            return self.respond(HTTPStatus.OK, [public_order(row) for row in rows])
        if path == "/api/escalas":
            with connect() as db:
                scales = all_scale_rows(db)
            return self.respond(HTTPStatus.OK, scales)
        if path == "/api/custos-extras":
            with connect() as db:
                rows = db.execute("SELECT * FROM custos_extras ORDER BY rede COLLATE NOCASE").fetchall()
            return self.respond(HTTPStatus.OK, [dict(row) for row in rows])
        if path == "/api/leituras-pendentes":
            with connect() as db:
                rows = db.execute("SELECT * FROM leituras_pendentes ORDER BY id DESC").fetchall()
            return self.respond(HTTPStatus.OK, [public_reading(row) for row in rows])
        scale_route = self.route_escalas()
        if scale_route and scale_route[1] is None:
            with connect() as db:
                if not db.execute("SELECT 1 FROM pedidos WHERE id = ?", (scale_route[0],)).fetchone():
                    return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Pedido não encontrado."})
                scales = order_scale_rows(db, scale_route[0])
            return self.respond(HTTPStatus.OK, scales)
        if path == "/api/modelos-pedidos":
            with connect() as db:
                items = [dict(r) for r in db.execute('SELECT * FROM pedido_modelos ORDER BY nome')]
            for item in items: item['dados'] = json.loads(item['dados'])
            return self.respond(HTTPStatus.OK, items)
        if path == "/api/lojas":
            with connect() as db:
                rows = db.execute("SELECT * FROM lojas ORDER BY rede COLLATE NOCASE, cidade COLLATE NOCASE, nome COLLATE NOCASE").fetchall()
            return self.respond(HTTPStatus.OK, [dict(row) for row in rows])
        if path == "/api/tarifas":
            with connect() as db:
                redes = db.execute("SELECT * FROM tarifas_redes ORDER BY rede COLLATE NOCASE").fetchall()
                setores = db.execute("SELECT * FROM tarifas_setores ORDER BY rede COLLATE NOCASE, setor COLLATE NOCASE").fetchall()
            return self.respond(HTTPStatus.OK, {"redes": [dict(row) for row in redes], "setores": [dict(row) for row in setores]})
        daily_route = self.route_diarias()
        if daily_route and daily_route[1] is None:
            with connect() as db:
                if not db.execute("SELECT 1 FROM diaristas WHERE id = ?", (daily_route[0],)).fetchone():
                    return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Cadastro não encontrado."})
                rows = db.execute("SELECT * FROM diarias WHERE diarista_id = ? ORDER BY data DESC, id DESC", (daily_route[0],)).fetchall()
            return self.respond(HTTPStatus.OK, [dict(row) for row in rows])
        if path == "/":
            path = "/index.html"
        assets = {"/usability.css":"text/css; charset=utf-8","/management-model.js":"text/javascript; charset=utf-8", "/management.js":"text/javascript; charset=utf-8", "/management.css":"text/css; charset=utf-8", "/loja.html":"text/html; charset=utf-8", "/store-portal.js":"text/javascript; charset=utf-8", "/automation-model.js":"text/javascript; charset=utf-8", "/automation.js":"text/javascript; charset=utf-8", "/automation.css":"text/css; charset=utf-8", "/index.html": "text/html; charset=utf-8", "/style.css": "text/css; charset=utf-8", "/brand.css": "text/css; charset=utf-8", "/theme.css": "text/css; charset=utf-8", "/mobile.css": "text/css; charset=utf-8", "/reading.css": "text/css; charset=utf-8", "/motion.css": "text/css; charset=utf-8", "/operations.css": "text/css; charset=utf-8", "/workflow.css": "text/css; charset=utf-8", "/route-loader.js": "text/javascript; charset=utf-8", "/session-sync.js": "text/javascript; charset=utf-8",
            "/app.js": "text/javascript; charset=utf-8", "/theme.js": "text/javascript; charset=utf-8", "/finance.js": "text/javascript; charset=utf-8", "/forecast.js": "text/javascript; charset=utf-8", "/operations.js": "text/javascript; charset=utf-8", "/workflow.js": "text/javascript; charset=utf-8", "/matching.js": "text/javascript; charset=utf-8", "/backup.js": "text/javascript; charset=utf-8", "/orders.js": "text/javascript; charset=utf-8", "/stores.js": "text/javascript; charset=utf-8", "/settings.js": "text/javascript; charset=utf-8", "/reading.js": "text/javascript; charset=utf-8", "/reading-parser.js": "text/javascript; charset=utf-8", "/remote.js": "text/javascript; charset=utf-8", "/payment-calendar.js": "text/javascript; charset=utf-8", "/vendor/supabase-2.117.2.js": "text/javascript; charset=utf-8", "/stores.css": "text/css; charset=utf-8", "/settings.css": "text/css; charset=utf-8", "/login.css": "text/css; charset=utf-8", "/favicon.svg": "image/svg+xml", "/logo-direct-promocoes.jpg": "image/jpeg", "/logo-direct-promocoes-transparente.png": "image/png"}
        for asset in ['messages-model.js','messages.js','backup-model.js']:
            assets['/'+asset]='text/javascript; charset=utf-8'
        assets['/messages.css']='text/css; charset=utf-8'
        assets["/reconciliation.js"] = "text/javascript; charset=utf-8"
        for asset in ['usability.js','usability-model.js','reading-assistant.js','insights.js','offline.js','operations-extended.js','crm-model.js','hub.js','portal-admin.js','vacancies-admin.js','portal.js','sw.js']:
            assets['/'+asset]='text/javascript; charset=utf-8'
        assets['/manifest.webmanifest']='application/manifest+json'
        assets['/extended.css']='text/css; charset=utf-8'
        assets['/hub.css']='text/css; charset=utf-8'
        assets['/portal.css']='text/css; charset=utf-8'
        for page in ('cadastro.html','vagas.html'):
            assets['/'+page]='text/html; charset=utf-8'
        if path in assets:
            return self.respond(HTTPStatus.OK, (STATIC / path[1:]).read_bytes(), assets[path])
        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Página não encontrada."})

    def do_POST(self):
        if not self._allowed_origin():
            return self.respond(HTTPStatus.FORBIDDEN, {"erro": "Acesso não permitido."})
        path = urlparse(self.path).path
        if path == "/api/leitura/pedido-escalado":
            return linked_reading.handle(self, sys.modules[__name__])
        replacement_route=re.fullmatch(r"/api/pedidos/(\d+)/escalas/(\d+)/substituir",urlparse(self.path).path)
        if replacement_route:
            try:
                with connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    payload=self.read_json()
                    replace=usability.replace_remaining if payload.get("todos_restantes") is True else scale_lifecycle.replace
                    result=replace(db,int(replacement_route[1]),int(replacement_route[2]),payload,sys.modules[__name__])
                return self.respond(HTTPStatus.OK,result)
            except (ValueError,TypeError,json.JSONDecodeError,sqlite3.IntegrityError) as error:
                return self.respond(HTTPStatus.BAD_REQUEST,{'erro':str(error)})
        if usability.handle(self, "POST", sys.modules[__name__]): return
        if extended.handle(self, "POST", sys.modules[__name__]): return
        if store_portal.handle(self, "POST", sys.modules[__name__]): return
        if path == "/api/cobrancas" or re.fullmatch(r"/api/cobrancas/\d+/recebimentos", path):
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError("Dados da cobrança inválidos.")
                with connect() as db:
                    if path == "/api/cobrancas":
                        network = clean_text(payload.get("rede"), "a rede", 180)
                        start = validate_date(payload.get("periodo_inicio"), "o início do período")
                        end = validate_date(payload.get("periodo_fim"), "o fim do período")
                        due = validate_date(payload.get("vencimento"), "o vencimento")
                        note = clean_text(payload.get("numero_nota", ""), "o número da nota", 80, False)
                        if start > end or (date.fromisoformat(end) - date.fromisoformat(start)).days > 365:
                            raise ValueError("Selecione um período de até 365 dias em ordem crescente.")
                        invoice_id = workflow.create_invoice(db, network, start, end, due, note)
                        response = next(row for row in workflow.invoice_rows(db) if row["id"] == invoice_id)
                    else:
                        invoice_id = int(path.split("/")[3])
                        amount = money_cents(payload.get("valor"), True)
                        day = validate_date(payload.get("data_recebimento"), "a data de recebimento")
                        method = clean_text(payload.get("forma", ""), "a forma", 80, False)
                        workflow.receive_invoice(db, invoice_id, amount, day, method)
                        response = next(row for row in workflow.invoice_rows(db) if row["id"] == invoice_id)
                return self.respond(HTTPStatus.CREATED, response)
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Uma diária deste período já entrou em outra cobrança."})
        if path == "/api/pagamento-lotes":
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError("Dados do fechamento inválidos.")
                ids = payload.get("diaria_ids")
                worker_id = payload.get("diarista_id")
                if isinstance(worker_id, bool) or not isinstance(worker_id, int) or not isinstance(ids, list) or not 1 <= len(ids) <= 500 or any(isinstance(x, bool) or not isinstance(x, int) for x in ids) or len(set(ids)) != len(ids):
                    raise ValueError("Selecione diárias válidas de uma diarista.")
                day = validate_date(payload.get("data_pagamento"), "a data do pagamento")
                method = clean_text(payload.get("forma", ""), "a forma", 80, False)
                with connect() as db:
                    batch_id = workflow.pay_batch(db, worker_id, ids, day, method)
                    response = dict(db.execute("SELECT * FROM pagamento_lotes WHERE id = ?", (batch_id,)).fetchone())
                return self.respond(HTTPStatus.CREATED, response)
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError as exc:
                return self.respond(HTTPStatus.CONFLICT, {"erro": str(exc)})
        if path == "/api/leituras-pendentes":
            try:
                data = validate_reading(self.read_json(max_length=70000))
                now = datetime.now(timezone.utc).isoformat()
                with connect() as db:
                    existed = db.execute("SELECT 1 FROM leituras_pendentes WHERE chave = ?", (data["chave"],)).fetchone() is not None
                    columns = ", ".join(data)
                    marks = ", ".join("?" for _ in data)
                    db.execute(f"""INSERT INTO leituras_pendentes ({columns}, criado_em, atualizado_em)
                        VALUES ({marks}, ?, ?)
                        ON CONFLICT(chave) DO UPDATE SET
                            tipo = excluded.tipo, dados = excluded.dados, texto = excluded.texto,
                            faltando = excluded.faltando, avisos = excluded.avisos,
                            status = 'pendente', atualizado_em = excluded.atualizado_em""",
                        (*data.values(), now, now))
                    row = db.execute("SELECT * FROM leituras_pendentes WHERE chave = ?", (data["chave"],)).fetchone()
                return self.respond(HTTPStatus.OK if existed else HTTPStatus.CREATED, public_reading(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        if urlparse(self.path).path == "/api/tarifas/setores":
            try:
                data = validate_sector_tariff(self.read_json())
                with connect() as db:
                    cur = db.execute("INSERT INTO tarifas_setores (rede, setor, valor_pago_centavos, atualizado_em) VALUES (?, ?, ?, ?)", (*data.values(), datetime.now(timezone.utc).isoformat()))
                    row = db.execute("SELECT * FROM tarifas_setores WHERE id = ?", (cur.lastrowid,)).fetchone()
                return self.respond(HTTPStatus.CREATED, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Este setor já tem um valor configurado nessa rede."})
        scale_route = self.route_escalas()
        if scale_route and scale_route[1] is None:
            try:
                payload = self.read_json()
                if not isinstance(payload, dict) or isinstance(payload.get("diarista_id"), bool) or not isinstance(payload.get("diarista_id"), int):
                    raise ValueError("Escolha uma diarista cadastrada.")
                batch = "datas" in payload
                raw_days = payload.get("datas") if batch else [payload.get("data")]
                if not isinstance(raw_days, list) or not 1 <= len(raw_days) <= 90:
                    raise ValueError("Selecione entre 1 e 90 datas do pedido.")
                days = [validate_date(value, "a escala") for value in raw_days]
                if len(set(days)) != len(days):
                    raise ValueError("Cada data da escala deve aparecer apenas uma vez.")
                with connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    order = db.execute("SELECT * FROM pedidos WHERE id = ?", (scale_route[0],)).fetchone()
                    person = db.execute("SELECT * FROM diaristas WHERE id = ?", (payload["diarista_id"],)).fetchone()
                    if not order:
                        raise ValueError("Pedido não encontrado.")
                    if order["situacao"] in ("concluido", "cancelado"):
                        raise ValueError("Não é possível escalar uma diarista em pedido encerrado.")
                    if not person or person["bloqueada"]:
                        raise ValueError("Escolha uma diarista cadastrada e não bloqueada.")
                    for day in days:
                        if order_shift(order, day) is None:
                            raise ValueError(f"A data {day} não consta no pedido.")
                        validate_worker_shift(db, person, order, day)
                        if db.execute("SELECT 1 FROM pedido_escalas WHERE pedido_id = ? AND data = ? AND diarista_id = ?", (scale_route[0], day, person["id"])).fetchone():
                            raise ValueError(f"A diarista já está neste pedido em {day}.")
                        count = db.execute("SELECT count(*) FROM pedido_escalas WHERE pedido_id = ? AND data = ? AND status NOT IN ('falta','desistiu')", (scale_route[0], day)).fetchone()[0]
                        if count >= order["quantidade_diaristas"]:
                            raise ValueError(f"A quantidade de diaristas em {day} já foi preenchida.")
                    now = datetime.now(timezone.utc).isoformat()
                    ids = [db.execute("INSERT INTO pedido_escalas (pedido_id, diarista_id, data, status, criado_em, atualizado_em) VALUES (?, ?, ?, 'escalada', ?, ?)", (scale_route[0], payload["diarista_id"], day, now, now)).lastrowid for day in days]
                    for day, new_id in zip(days, ids):
                        absence = db.execute("""SELECT id FROM pedido_escalas WHERE pedido_id = ? AND data = ?
                            AND status IN ('falta','desistiu') AND substituida_por_escala_id IS NULL ORDER BY id LIMIT 1""", (scale_route[0], day)).fetchone()
                        if absence:
                            db.execute("UPDATE pedido_escalas SET substituida_por_escala_id = ? WHERE id = ?", (new_id, absence["id"]))
                    scale_lifecycle.sync(db,scale_route[0])
                    saved = [row for row in order_scale_rows(db, scale_route[0]) if row["id"] in ids]
                return self.respond(HTTPStatus.CREATED, saved if batch else saved[0])
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Esta diarista já está escalada para esse dia."})
        if urlparse(self.path).path == "/api/modelos-pedidos":
            try:
                payload = self.read_json()
                name = clean_text(payload.get('nome'), 'o nome do modelo', 120)
                data = validate_order(payload.get('dados'))
                with connect() as db:
                    if not db.execute('SELECT 1 FROM lojas WHERE lower(rede)=lower(?) AND lower(nome)=lower(?)',(data['supermercado'],data['unidade'])).fetchone():
                        raise ValueError('Escolha uma loja cadastrada.')
                data['turnos'] = json.loads(data['turnos']) if isinstance(data['turnos'], str) else data['turnos']
                now = datetime.now(timezone.utc).isoformat()
                with connect() as db:
                    cur = db.execute('INSERT INTO pedido_modelos(nome,dados,criado_em,atualizado_em) VALUES (?,?,?,?)', (name,json.dumps(data,ensure_ascii=False),now,now))
                return self.respond(HTTPStatus.CREATED, {'id':cur.lastrowid,'nome':name,'dados':data})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {'erro':'Já existe um modelo com esse nome.'})
            except (ValueError,TypeError,json.JSONDecodeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {'erro':str(exc)})
        if urlparse(self.path).path == "/api/lojas":
            try:
                data = validate_store(self.read_json())
                now = datetime.now(timezone.utc).isoformat()
                with connect() as db:
                    columns = ", ".join(data)
                    marks = ", ".join("?" for _ in data)
                    cur = db.execute(f"INSERT INTO lojas ({columns}, criado_em, atualizado_em) VALUES ({marks}, ?, ?)", (*data.values(), now, now))
                    row = db.execute("SELECT * FROM lojas WHERE id = ?", (cur.lastrowid,)).fetchone()
                return self.respond(HTTPStatus.CREATED, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Esta loja já existe nessa rede."})
        if urlparse(self.path).path == "/api/pedidos":
            try:
                payload = self.read_json()
                data = validate_order(payload)
                key = payload.get('chave_operacao')
                if key:
                    if not isinstance(key,str) or str(__import__('uuid').UUID(key))!=key: raise ValueError('Chave do rascunho inválida.')
                    data['chave_operacao'] = key
                now = datetime.now(timezone.utc).isoformat()
                with connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    store_request = store_portal.review_request(db,payload['solicitacao_loja_id'],data) if payload.get('solicitacao_loja_id') else None
                    existing = db.execute('SELECT * FROM pedidos WHERE chave_operacao=?',(key,)).fetchone() if key else None
                    if existing:
                        if any((json.loads(existing[k]) if k=='turnos' else existing[k]) != (json.loads(v) if k=='turnos' else v) for k,v in data.items() if k!='chave_operacao'):
                            raise ValueError('Esse rascunho já foi enviado com outros dados. Confira o pedido existente antes de repetir.')
                        return self.respond(HTTPStatus.OK, public_order(existing))
                    columns = ", ".join(data)
                    marks = ", ".join("?" for _ in data)
                    cur = db.execute(f"INSERT INTO pedidos ({columns}, criado_em, atualizado_em) VALUES ({marks}, ?, ?)", (*data.values(), now, now))
                    row = db.execute("SELECT * FROM pedidos WHERE id = ?", (cur.lastrowid,)).fetchone()
                    if store_request:
                        db.execute("UPDATE loja_solicitacoes SET estado='aprovada',pedido_id=?,dados=?,atualizado_em=? WHERE id=?",(cur.lastrowid,json.dumps({**data,'turnos':json.loads(data['turnos'])},ensure_ascii=False),now,store_request['id']))
                return self.respond(HTTPStatus.CREATED, public_order(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        if urlparse(self.path).path == "/api/financeiro":
            try:
                data = validate_finance_entry(self.read_json())
                now = datetime.now(timezone.utc).isoformat()
                with connect() as db:
                    columns = ", ".join(data)
                    marks = ", ".join("?" for _ in data)
                    cur = db.execute(f"INSERT INTO financeiro_lancamentos ({columns}, criado_em, atualizado_em) VALUES ({marks}, ?, ?)", (*data.values(), now, now))
                    row = db.execute("SELECT * FROM financeiro_lancamentos WHERE id = ?", (cur.lastrowid,)).fetchone()
                return self.respond(HTTPStatus.CREATED, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        daily_route = self.route_diarias()
        if daily_route and daily_route[1] is None:
            try:
                data = validate_diaria(self.read_json())
                with connect() as db:
                    if not db.execute("SELECT 1 FROM diaristas WHERE id = ?", (daily_route[0],)).fetchone():
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Cadastro não encontrado."})
                    if db.execute("SELECT bloqueada FROM diaristas WHERE id = ?", (daily_route[0],)).fetchone()["bloqueada"]:
                        return self.respond(HTTPStatus.CONFLICT, {"erro": "Desbloqueie a diarista antes de registrar uma nova diária."})
                    cur = db.execute("INSERT INTO diarias (diarista_id, data, local, setor, observacoes, data_pagamento, valor_centavos, vencimento_pagamento, forma_pagamento, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (daily_route[0], *data.values(), datetime.now(timezone.utc).isoformat()))
                    row = db.execute("SELECT * FROM diarias WHERE id = ?", (cur.lastrowid,)).fetchone()
                return self.respond(HTTPStatus.CREATED, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        if urlparse(self.path).path != "/api/diaristas":
            return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rota não encontrada."})
        try:
            data = validate(self.read_json())
            now = datetime.now(timezone.utc).isoformat()
            with connect() as db:
                cols = ", ".join(data)
                marks = ", ".join("?" for _ in data)
                cur = db.execute(f"INSERT INTO diaristas ({cols}, criado_em, atualizado_em) VALUES ({marks}, ?, ?)", (*data.values(), now, now))
                row = db.execute("SELECT * FROM diaristas WHERE id = ?", (cur.lastrowid,)).fetchone()
            return self.respond(HTTPStatus.CREATED, public_row(row))
        except (ValueError, json.JSONDecodeError, TypeError) as exc:
            return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        except sqlite3.IntegrityError:
            return self.respond(HTTPStatus.CONFLICT, {"erro": "Este CPF já está cadastrado."})

    def do_PUT(self):
        if not self._allowed_origin():
            return self.respond(HTTPStatus.FORBIDDEN, {"erro": "Acesso não permitido."})
        if usability.handle(self, "PUT", sys.modules[__name__]): return
        if extended.handle(self, "PUT", sys.modules[__name__]): return
        if urlparse(self.path).path == "/api/custos-extras":
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError("Informe os custos da rede.")
                rede = clean_text(payload.get("rede"), "a rede", 120)
                costs = [extra_cost_cents(payload.get(key)) for key in ("transporte", "taxas", "outros")]
                with connect() as db:
                    cur = db.execute("""UPDATE custos_extras SET transporte_centavos = ?, taxas_centavos = ?,
                        outros_centavos = ?, atualizado_em = ? WHERE rede = ?""",
                        (*costs, datetime.now(timezone.utc).isoformat(), rede))
                    if not cur.rowcount:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rede não encontrada."})
                    row = db.execute("SELECT * FROM custos_extras WHERE rede = ?", (rede,)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        calendar_match = re.fullmatch(r"/api/tarifas/redes/(\d+)/calendario", urlparse(self.path).path)
        if calendar_match:
            try:
                data = calendar.validate_calendar(self.read_json())
                with connect() as db:
                    network_id = int(calendar_match.group(1))
                    cur = db.execute("UPDATE tarifas_redes SET pagamento_primeira_quinzena=?, pagamento_segunda_quinzena=?, pagamento_semanal_dia=?, atualizado_em=? WHERE id=?", (*data.values(), datetime.now(timezone.utc).isoformat(), network_id))
                    if not cur.rowcount:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rede não encontrada."})
                    calendar.refresh_pending(db, network_id)
                    row = db.execute("SELECT * FROM tarifas_redes WHERE id=?", (network_id,)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        network_match = re.fullmatch(r"/api/tarifas/redes/(\d+)", urlparse(self.path).path)
        if network_match:
            try:
                data = validate_network_tariff(self.read_json())
                with connect() as db:
                    cur = db.execute("UPDATE tarifas_redes SET valor_recebido_centavos = ?, valor_padrao_centavos = ?, atualizado_em = ? WHERE id = ?", (*data.values(), datetime.now(timezone.utc).isoformat(), int(network_match.group(1))))
                    if not cur.rowcount:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rede não encontrada."})
                    row = db.execute("SELECT * FROM tarifas_redes WHERE id = ?", (int(network_match.group(1)),)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        sector_match = re.fullmatch(r"/api/tarifas/setores/(\d+)", urlparse(self.path).path)
        if sector_match:
            try:
                data = validate_sector_tariff(self.read_json())
                with connect() as db:
                    cur = db.execute("UPDATE tarifas_setores SET rede = ?, setor = ?, valor_pago_centavos = ?, atualizado_em = ? WHERE id = ?", (*data.values(), datetime.now(timezone.utc).isoformat(), int(sector_match.group(1))))
                    if not cur.rowcount:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Setor não encontrado."})
                    row = db.execute("SELECT * FROM tarifas_setores WHERE id = ?", (int(sector_match.group(1)),)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Este setor já tem um valor configurado nessa rede."})
        store_match = re.fullmatch(r"/api/lojas/(\d+)", urlparse(self.path).path)
        if store_match:
            try:
                payload = self.read_json()
                data = validate_store(payload)
                store_id = int(store_match.group(1))
                with connect() as db:
                    fields = ", ".join(f"{key} = ?" for key in data)
                    cur = db.execute(f"UPDATE lojas SET {fields}, atualizado_em = ? WHERE id = ? AND (? IS NULL OR atualizado_em = ?)", (*data.values(), datetime.now(timezone.utc).isoformat(), store_id, payload.get("expected_updated_at"), payload.get("expected_updated_at")))
                    if not cur.rowcount:
                        if db.execute("SELECT 1 FROM lojas WHERE id = ?", (store_id,)).fetchone():
                            return self.respond(HTTPStatus.CONFLICT, {"erro": "Este registro foi alterado por outra pessoa. Feche, atualize a lista e abra novamente; seus dados não foram sobrescritos."})
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Loja não encontrada."})
                    row = db.execute("SELECT * FROM lojas WHERE id = ?", (store_id,)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Esta loja já existe nessa rede."})
        order_match = re.fullmatch(r"/api/pedidos/(\d+)", urlparse(self.path).path)
        if order_match:
            try:
                payload = self.read_json()
                data = validate_order(payload)
                order_id = int(order_match.group(1))
                with connect() as db:
                    old = db.execute("SELECT * FROM pedidos WHERE id = ?", (order_id,)).fetchone()
                    if old and db.execute("SELECT 1 FROM pedido_escalas WHERE pedido_id = ? LIMIT 1", (order_id,)).fetchone():
                        # O setor pode ser corrigido sem recriar a equipe ou valores históricos.
                        fixed = ("supermercado", "unidade", "quantidade_diaristas", "turnos")
                        if any(old[key] != data[key] for key in fixed):
                            raise ValueError("Este pedido já possui escalas. Você pode corrigir o setor; preserve a rede, a loja, a quantidade e as datas e horários registrados.")
                    fields = ", ".join(f"{key} = ?" for key in data)
                    cur = db.execute(f"UPDATE pedidos SET {fields}, atualizado_em = ? WHERE id = ? AND (? IS NULL OR atualizado_em = ?)", (*data.values(), datetime.now(timezone.utc).isoformat(), order_id, payload.get("expected_updated_at"), payload.get("expected_updated_at")))
                    if not cur.rowcount:
                        if db.execute("SELECT 1 FROM pedidos WHERE id = ?", (order_id,)).fetchone():
                            return self.respond(HTTPStatus.CONFLICT, {"erro": "Este registro foi alterado por outra pessoa. Feche, atualize a lista e abra novamente; seus dados não foram sobrescritos."})
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Pedido não encontrado."})
                    row = db.execute("SELECT * FROM pedidos WHERE id = ?", (order_id,)).fetchone()
                return self.respond(HTTPStatus.OK, public_order(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        finance_match = re.fullmatch(r"/api/financeiro/(\d+)", urlparse(self.path).path)
        if finance_match:
            try:
                payload = self.read_json()
                data = validate_finance_entry(payload)
                entry_id = int(finance_match.group(1))
                with connect() as db:
                    old = db.execute("SELECT * FROM financeiro_lancamentos WHERE id = ?", (entry_id,)).fetchone()
                    if old and old["data_pagamento"] and any(old[key] != value for key, value in data.items() if key != "motivo_ajuste"):
                        if len(data["motivo_ajuste"].strip()) < 8 or data["motivo_ajuste"] == old["motivo_ajuste"]:
                            raise ValueError("Explique a correção do lançamento já liquidado (mínimo de 8 caracteres).")
                    fields = ", ".join(f"{key} = ?" for key in data)
                    cur = db.execute(f"UPDATE financeiro_lancamentos SET {fields}, atualizado_em = ? WHERE id = ? AND (? IS NULL OR atualizado_em = ?)", (*data.values(), datetime.now(timezone.utc).isoformat(), entry_id, payload.get("expected_updated_at"), payload.get("expected_updated_at")))
                    if not cur.rowcount:
                        if db.execute("SELECT 1 FROM financeiro_lancamentos WHERE id = ?", (entry_id,)).fetchone():
                            return self.respond(HTTPStatus.CONFLICT, {"erro": "Este registro foi alterado por outra pessoa. Feche, atualize a lista e abra novamente; seus dados não foram sobrescritos."})
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Lançamento não encontrado."})
                    row = db.execute("SELECT * FROM financeiro_lancamentos WHERE id = ?", (entry_id,)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        record_id = self.route_id()
        if record_id is None:
            return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rota não encontrada."})
        try:
            payload = self.read_json()
            data = validate(payload)
            with connect() as db:
                fields = ", ".join(f"{key} = ?" for key in data)
                cur = db.execute(f"UPDATE diaristas SET {fields}, atualizado_em = ? WHERE id = ? AND (? IS NULL OR atualizado_em = ?)", (*data.values(), datetime.now(timezone.utc).isoformat(), record_id, payload.get("expected_updated_at"), payload.get("expected_updated_at")))
                if not cur.rowcount:
                    if db.execute("SELECT 1 FROM diaristas WHERE id = ?", (record_id,)).fetchone():
                        return self.respond(HTTPStatus.CONFLICT, {"erro": "Este registro foi alterado por outra pessoa. Feche, atualize a lista e abra novamente; seus dados não foram sobrescritos."})
                    return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Cadastro não encontrado."})
                row = db.execute("SELECT * FROM diaristas WHERE id = ?", (record_id,)).fetchone()
            return self.respond(HTTPStatus.OK, public_row(row))
        except (ValueError, json.JSONDecodeError, TypeError) as exc:
            return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        except sqlite3.IntegrityError:
            return self.respond(HTTPStatus.CONFLICT, {"erro": "Este CPF já está cadastrado."})

    def do_PATCH(self):
        if not self._allowed_origin():
            return self.respond(HTTPStatus.FORBIDDEN, {"erro": "Acesso não permitido."})
        path = urlparse(self.path).path
        if extended.handle(self, "PATCH", sys.modules[__name__]): return
        if store_portal.handle(self, "PATCH", sys.modules[__name__]): return
        invoice_match = re.fullmatch(r"/api/cobrancas/(\d+)/cancelar", path)
        receipt_match = re.fullmatch(r"/api/recebimentos/(\d+)/estornar", path)
        batch_match = re.fullmatch(r"/api/pagamento-lotes/(\d+)/reabrir", path)
        if invoice_match or receipt_match or batch_match:
            try:
                payload = self.read_json()
                reason = clean_text(payload.get("motivo") if isinstance(payload, dict) else None, "o motivo", 300)
                if len(reason) < 8:
                    raise ValueError("Explique o motivo com pelo menos 8 caracteres.")
                with connect() as db:
                    if invoice_match:
                        workflow.cancel_invoice(db, int(invoice_match.group(1)), reason)
                    elif receipt_match:
                        workflow.void_receipt(db, int(receipt_match.group(1)), reason)
                    else:
                        workflow.reopen_batch(db, int(batch_match.group(1)), reason)
                return self.respond(HTTPStatus.OK, {"ok": True})
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        reading_match = re.fullmatch(r"/api/leituras-pendentes/(\d+)", urlparse(self.path).path)
        if reading_match:
            try:
                payload = self.read_json()
                if payload.get("status") != "resolvido":
                    raise ValueError("Situação inválida.")
                with connect() as db:
                    db.execute("UPDATE leituras_pendentes SET status = 'resolvido', atualizado_em = ? WHERE id = ?",
                               (datetime.now(timezone.utc).isoformat(), int(reading_match.group(1))))
                    row = db.execute("SELECT * FROM leituras_pendentes WHERE id = ?", (int(reading_match.group(1)),)).fetchone()
                return self.respond(HTTPStatus.OK if row else HTTPStatus.NOT_FOUND, public_reading(row) if row else {"erro": "Leitura não encontrada."})
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        scale_route = self.route_escalas()
        if scale_route and scale_route[1] is not None:
            try:
                payload = self.read_json()
                status = payload.get("status") if isinstance(payload, dict) else None
                if status not in {"escalada", "presente", "falta", "desistiu"}:
                    raise ValueError("Selecione presença ou falta.")
                with connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    scale = db.execute("SELECT * FROM pedido_escalas WHERE id = ? AND pedido_id = ?", (scale_route[1], scale_route[0])).fetchone()
                    if not scale:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Escala não encontrada."})
                    order = db.execute("SELECT * FROM pedidos WHERE id = ?", (scale_route[0],)).fetchone()
                    if scale['status']=='desistiu' and status!='desistiu': raise ValueError('Preserve a desistência registrada. Escolha uma substituição.')
                    if status=='desistiu' and scale['status'] not in ('escalada','desistiu'): raise ValueError('Desistência disponível apenas antes da presença ou falta.')
                    if status != scale["status"]:
                        reason = clean_text(payload.get("motivo"), "o motivo da falta ou desistência", 300) if status in ("falta","desistiu") else None
                        if reason is not None and len(reason) < 5:
                            raise ValueError("Informe o motivo da falta com pelo menos 5 caracteres.")
                        if status in {"presente", "falta"} and scale["data"] > datetime.now(FORTALEZA).date().isoformat():
                            raise ValueError("Presença ou falta só pode ser registrada a partir da data da diária.")
                        if scale["status"] == "presente":
                            daily = db.execute("SELECT data_pagamento FROM diarias WHERE pedido_escala_id = ?", (scale["id"],)).fetchone()
                            if daily and daily["data_pagamento"]:
                                raise ValueError("A diária já foi paga. Corrija o pagamento antes de alterar a presença.")
                            if db.execute("""SELECT 1 FROM cobranca_itens i JOIN diarias d ON d.id = i.diaria_id
                                WHERE d.pedido_escala_id = ?""", (scale["id"],)).fetchone():
                                raise ValueError("Esta presença já entrou numa cobrança. Cancele a cobrança antes de corrigir a falta.")
                            db.execute("DELETE FROM diarias WHERE pedido_escala_id = ?", (scale["id"],))
                        if scale["status"] == "falta" and status != "falta":
                            person = db.execute("SELECT * FROM diaristas WHERE id=?", (scale["diarista_id"],)).fetchone()
                            if not person or person["bloqueada"] or order["situacao"] in {"cancelado", "concluido"}:
                                raise ValueError("Confira o cadastro e a situação do pedido antes de reativar a escala.")
                            validate_worker_shift(db, person, order, scale["data"], scoped_availability=bool(scale["disponibilidade_pedido_confirmada"]))
                            count = db.execute("SELECT count(*) FROM pedido_escalas WHERE pedido_id = ? AND data = ? AND status NOT IN ('falta','desistiu')", (scale_route[0], scale["data"])).fetchone()[0]
                            if count >= order["quantidade_diaristas"]:
                                raise ValueError("A quantidade de diaristas deste dia já foi preenchida.")
                        if status == "presente":
                            local = order["supermercado"] + (f" · {order['unidade']}" if order["unidade"] else "")
                            network_rate = db.execute("SELECT * FROM tarifas_redes WHERE lower(rede) = lower(?)", (order["supermercado"],)).fetchone()
                            sector_rate = db.execute("""SELECT valor_pago_centavos FROM tarifas_setores
                                WHERE lower(setor) = lower(?) AND (lower(rede) = lower(?) OR rede IS NULL) AND valor_pago_centavos IS NOT NULL
                                ORDER BY CASE WHEN lower(rede) = lower(?) THEN 0 ELSE 1 END LIMIT 1""",
                                (order["setor"], order["supermercado"], order["supermercado"])).fetchone()
                            paid_rate = sector_rate[0] if sector_rate else (network_rate["valor_padrao_centavos"] if network_rate else None)
                            received_rate = network_rate["valor_recebido_centavos"] if network_rate else None
                            contract = extended.effective_contract(db, order, scale['data'])
                            if contract:
                                paid_rate = contract['valor_pago_centavos'] if contract['valor_pago_centavos'] is not None else paid_rate
                                received_rate = contract['valor_recebido_centavos'] if contract['valor_recebido_centavos'] is not None else received_rate
                            due = calendar.payment_due(scale['data'], network_rate['pagamento_primeira_quinzena'], network_rate['pagamento_segunda_quinzena'], network_rate['pagamento_semanal_dia']) if network_rate else None
                            db.execute("""INSERT INTO diarias (diarista_id, data, local, setor, observacoes, pedido_escala_id,
                                valor_centavos, valor_recebido_centavos, vencimento_pagamento, criado_em, contrato_id, vencimento_recebimento, vencimento_origem)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                                (scale["diarista_id"], scale["data"], local, order["setor"],
                                 f"Presença no pedido #{scale_route[0]}", scale["id"], paid_rate, received_rate,
                                 due, datetime.now(timezone.utc).isoformat(), contract["id"] if contract else None, due, "calendario" if due else "nao_informado"))
                        now = datetime.now(timezone.utc).isoformat()
                        db.execute("""UPDATE pedido_escalas SET status = ?, atualizado_em = ?,
                            falta_motivo = ?, falta_confirmada_por = ?, falta_confirmada_em = ?,
                            substituida_por_escala_id = CASE WHEN ? IN ('falta','desistiu') THEN substituida_por_escala_id ELSE NULL END
                            WHERE id = ?""", (status, now, reason if status=='falta' else None, "Servidor local" if status=='falta' else None,
                            now if status=='falta' else None, status, scale["id"]))
                        if status=='desistiu': db.execute('UPDATE pedido_escalas SET desistencia_motivo=?,desistencia_em=?,desistencia_por=? WHERE id=?',(reason,now,'Servidor local',scale['id']))
                        scale_lifecycle.sync(db,scale_route[0])
                        if scale['status'] == 'presente' and status != 'presente':
                            db.execute("UPDATE pedido_escalas SET loja_validacao='pendente',loja_responsavel='',loja_observacao='',chegada_em=NULL,saida_em=NULL,loja_validada_em=NULL,loja_validada_por=NULL WHERE id=?", (scale['id'],))
                    row = next(row for row in order_scale_rows(db, scale_route[0]) if row["id"] == scale["id"])
                return self.respond(HTTPStatus.OK, row)
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        payment_match = re.fullmatch(r"/api/diaristas/(\d+)/diarias/(\d+)/pagamento", urlparse(self.path).path)
        if payment_match:
            try:
                payload = self.read_json()
                if not isinstance(payload, dict) or not any(key in payload for key in ("data_pagamento", "valor", "vencimento_pagamento", "forma_pagamento")):
                    raise ValueError("Informe os dados do pagamento.")
                updates = {}
                if "data_pagamento" in payload:
                    updates["data_pagamento"] = validate_date(payload["data_pagamento"], "o pagamento", False)
                if "valor" in payload:
                    updates["valor_centavos"] = money_cents(payload["valor"])
                if "vencimento_pagamento" in payload:
                    updates["vencimento_pagamento"] = validate_date(payload["vencimento_pagamento"], "o vencimento", False)
                if "forma_pagamento" in payload:
                    updates["forma_pagamento"] = clean_text(payload["forma_pagamento"], "a forma de pagamento", 80, False)
                if "motivo_ajuste" in payload:
                    updates["motivo_ajuste"] = clean_text(payload["motivo_ajuste"], "o motivo da correção", 300, False)
                with connect() as db:
                    old = db.execute("SELECT * FROM diarias WHERE id = ? AND diarista_id = ?", (int(payment_match.group(2)), int(payment_match.group(1)))).fetchone()
                    if not old:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Diária não encontrada."})
                    if old["pagamento_lote_id"] is not None:
                        raise ValueError("Reabra o fechamento antes de corrigir esta diária.")
                    effective = {key: updates.get(key, old[key]) for key in ("data_pagamento", "valor_centavos", "vencimento_pagamento")}
                    changed_due = 'vencimento_pagamento' in updates and updates['vencimento_pagamento'] != old['vencimento_pagamento']
                    validate_payment_consistency(effective["data_pagamento"], effective["valor_centavos"], effective["vencimento_pagamento"], bool(old['pedido_escala_id'] and old['vencimento_origem']=='nao_informado' and not changed_due))
                    if changed_due:
                        updates['vencimento_origem'] = 'manual'
                    if old["data_pagamento"] and any(old[key] != value for key, value in updates.items() if key != "motivo_ajuste"):
                        reason = updates.get("motivo_ajuste", "")
                        if len(reason.strip()) < 8 or reason == old["motivo_ajuste"]:
                            raise ValueError("Explique a correção da diária já paga (mínimo de 8 caracteres).")
                    fields = ", ".join(f"{key} = ?" for key in updates)
                    cur = db.execute(f"UPDATE diarias SET {fields} WHERE id = ? AND diarista_id = ?", (*updates.values(), int(payment_match.group(2)), int(payment_match.group(1))))
                    if not cur.rowcount:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Diária não encontrada."})
                    row = db.execute("SELECT * FROM diarias WHERE id = ?", (int(payment_match.group(2)),)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        match = re.fullmatch(r"/api/diaristas/(\d+)/bloqueio", urlparse(self.path).path)
        if not match:
            return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rota não encontrada."})
        try:
            payload = self.read_json()
            if not isinstance(payload, dict) or not isinstance(payload.get("bloqueada"), bool):
                raise ValueError("Informe o estado do bloqueio.")
            with connect() as db:
                cur = db.execute("UPDATE diaristas SET bloqueada = ?, atualizado_em = ? WHERE id = ?", (int(payload["bloqueada"]), datetime.now(timezone.utc).isoformat(), int(match.group(1))))
                if not cur.rowcount:
                    return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Cadastro não encontrado."})
                row = db.execute("SELECT * FROM diaristas WHERE id = ?", (int(match.group(1)),)).fetchone()
            return self.respond(HTTPStatus.OK, public_row(row))
        except (ValueError, json.JSONDecodeError, TypeError) as exc:
            return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})

    def do_DELETE(self):
        if not self._allowed_origin():
            return self.respond(HTTPStatus.FORBIDDEN, {"erro": "Acesso não permitido."})
        model = re.fullmatch(r"/api/modelos-pedidos/(\d+)", urlparse(self.path).path)
        if model:
            with connect() as db:
                cur = db.execute('DELETE FROM pedido_modelos WHERE id=?', (int(model.group(1)),))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {'ok': bool(cur.rowcount)})
        reading_match = re.fullmatch(r"/api/leituras-pendentes/(\d+)", urlparse(self.path).path)
        if reading_match:
            with connect() as db:
                cur = db.execute("DELETE FROM leituras_pendentes WHERE id = ?", (int(reading_match.group(1)),))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})
        sector_match = re.fullmatch(r"/api/tarifas/setores/(\d+)", urlparse(self.path).path)
        if sector_match:
            with connect() as db:
                cur = db.execute("DELETE FROM tarifas_setores WHERE id = ?", (int(sector_match.group(1)),))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})
        scale_route = self.route_escalas()
        if scale_route and scale_route[1] is not None:
            with connect() as db:
                scale = db.execute("SELECT status FROM pedido_escalas WHERE id = ? AND pedido_id = ?", (scale_route[1], scale_route[0])).fetchone()
                if not scale:
                    return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Escala não encontrada."})
                if scale["status"] != "escalada":
                    return self.respond(HTTPStatus.CONFLICT, {"erro": "Presenças e faltas registradas não podem ser excluídas."})
                db.execute("UPDATE pedido_escalas SET substituida_por_escala_id = NULL WHERE substituida_por_escala_id = ?", (scale_route[1],))
                db.execute("DELETE FROM pedido_escalas WHERE id = ?", (scale_route[1],))
                scale_lifecycle.sync(db,scale_route[0])
            return self.respond(HTTPStatus.OK, {"ok": True})
        order_match = re.fullmatch(r"/api/pedidos/(\d+)", urlparse(self.path).path)
        if order_match:
            try:
                payload = self.read_json() if int(self.headers.get("Content-Length", "0")) else {}
                order_id = int(order_match.group(1))
                with connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    old = db.execute("SELECT * FROM pedidos WHERE id = ?", (order_id,)).fetchone()
                    if not old:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Pedido não encontrado."})
                    if payload.get("expected_updated_at") and payload["expected_updated_at"] != old["atualizado_em"]:
                        return self.respond(HTTPStatus.CONFLICT, {"erro": "Este pedido foi alterado por outra pessoa. Atualize a lista e abra novamente antes de excluir."})
                    history = db.execute("SELECT 1 FROM pedido_escalas WHERE pedido_id = ? AND status <> 'escalada' LIMIT 1", (order_id,)).fetchone()
                    daily = db.execute("SELECT 1 FROM diarias d JOIN pedido_escalas e ON e.id=d.pedido_escala_id WHERE e.pedido_id=? LIMIT 1", (order_id,)).fetchone()
                    invoice = db.execute("SELECT 1 FROM cobranca_itens WHERE pedido_id=? LIMIT 1", (order_id,)).fetchone()
                    checks = db.execute("SELECT 1 FROM loja_validacoes v JOIN pedido_escalas e ON e.id=v.escala_id WHERE e.pedido_id=? LIMIT 1", (order_id,)).fetchone()
                    if history or daily or invoice or checks:
                        return self.respond(HTTPStatus.CONFLICT, {"erro": "Este pedido possui histórico de presença, falta, desistência, conferência ou financeiro. Cancele o pedido para preservar esses registros."})
                    if db.execute("SELECT 1 FROM ocorrencias WHERE pedido_id=? OR escala_id IN (SELECT id FROM pedido_escalas WHERE pedido_id=?) LIMIT 1", (order_id, order_id)).fetchone():
                        return self.respond(HTTPStatus.CONFLICT, {"erro": "Este pedido possui ocorrências registradas. Cancele o pedido para preservar o histórico."})
                    removed = db.execute("DELETE FROM pedido_escalas WHERE pedido_id=?", (order_id,)).rowcount
                    db.execute("DELETE FROM pedidos WHERE id=?", (order_id,))
                return self.respond(HTTPStatus.OK, {"ok": True, "escalas_removidas": removed})
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
            except sqlite3.IntegrityError:
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Este pedido possui registros vinculados. Cancele o pedido para preservar o histórico."})
        finance_match = re.fullmatch(r"/api/financeiro/(\d+)", urlparse(self.path).path)
        if finance_match:
            with connect() as db:
                old = db.execute("SELECT data_pagamento FROM financeiro_lancamentos WHERE id = ?", (int(finance_match.group(1)),)).fetchone()
                if old and old["data_pagamento"]:
                    return self.respond(HTTPStatus.CONFLICT, {"erro": "Este lançamento já foi liquidado. Registre uma correção com motivo."})
                cur = db.execute("DELETE FROM financeiro_lancamentos WHERE id = ?", (int(finance_match.group(1)),))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})
        daily_route = self.route_diarias()
        if daily_route and daily_route[1] is not None:
            with connect() as db:
                daily = db.execute("SELECT data_pagamento, pedido_escala_id FROM diarias WHERE id = ? AND diarista_id = ?", (daily_route[1], daily_route[0])).fetchone()
                if daily and daily["pedido_escala_id"] is not None:
                    return self.respond(HTTPStatus.CONFLICT, {"erro": "Esta diária está vinculada a uma presença. Corrija a presença no pedido."})
                if daily and daily["data_pagamento"]:
                    return self.respond(HTTPStatus.CONFLICT, {"erro": "Esta diária já foi paga e faz parte do histórico financeiro. Corrija os dados do pagamento em vez de excluí-la."})
                cur = db.execute("DELETE FROM diarias WHERE id = ? AND diarista_id = ?", (daily_route[1], daily_route[0]))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})
        record_id = self.route_id()
        if record_id is None:
            return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rota não encontrada."})
        with connect() as db:
            if db.execute("SELECT 1 FROM pedido_escalas WHERE diarista_id = ? LIMIT 1", (record_id,)).fetchone():
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Esta diarista possui escalas registradas. Bloqueie o cadastro para preservar o histórico."})
            if db.execute("SELECT 1 FROM diarias WHERE diarista_id = ? LIMIT 1", (record_id,)).fetchone():
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Este cadastro tem diárias registradas. Mantenha a ficha para preservar o histórico; se necessário, bloqueie a diarista para novas diárias."})
            cur = db.execute("DELETE FROM diaristas WHERE id = ?", (record_id,))
        return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})


if __name__ == "__main__":
    init_db()
    print(f"Cadastro de diaristas: http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
