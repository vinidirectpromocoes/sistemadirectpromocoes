"""Servidor local para o cadastro de diaristas."""

from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from catalogo_lojas import LOJAS


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DB_PATH = Path(os.environ.get("DIARISTAS_DB_PATH", ROOT / "data" / "diaristas.db"))
PORT = int(os.environ.get("DIARISTAS_PORT", "8000"))
DAYS = {"segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"}
ORDER_STATUSES = {"novo", "em_selecao", "confirmado", "concluido", "cancelado"}


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
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
            trabalhando INTEGER NOT NULL,
            local_trabalho TEXT NOT NULL DEFAULT '',
            disponibilidade TEXT NOT NULL,
            pode_se_deslocar INTEGER NOT NULL,
            transporte TEXT NOT NULL DEFAULT '',
            observacoes_locomocao TEXT NOT NULL DEFAULT '',
            bloqueada INTEGER NOT NULL DEFAULT 0,
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL
        )""")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(diaristas)")}
        if "bloqueada" not in columns:
            db.execute("ALTER TABLE diaristas ADD COLUMN bloqueada INTEGER NOT NULL DEFAULT 0")
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
            criado_em TEXT NOT NULL
        )""")
        daily_columns = {row["name"] for row in db.execute("PRAGMA table_info(diarias)")}
        for column, definition in {
            "data_pagamento": "TEXT",
            "valor_centavos": "INTEGER",
            "vencimento_pagamento": "TEXT",
            "forma_pagamento": "TEXT NOT NULL DEFAULT ''",
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
            criado_em TEXT NOT NULL,
            atualizado_em TEXT NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_financeiro_vencimento ON financeiro_lancamentos(vencimento)")
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
        db.execute("CREATE INDEX IF NOT EXISTS idx_lojas_rede_cidade ON lojas(rede, cidade)")
        now = datetime.now(timezone.utc).isoformat()
        db.executemany("""INSERT OR IGNORE INTO lojas
            (rede, nome, endereco, bairro, cidade, fonte_url, situacao, observacao, criado_em, atualizado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (item + (now, now) for item in LOJAS))


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
    setores = payload.get("setores")
    if not isinstance(setores, list) or not setores or len(setores) > 12:
        raise ValueError("Informe ao menos um setor de experiência.")
    setores = list(dict.fromkeys(clean_text(item, "o setor", 60) for item in setores))
    address = {}
    for key, label, length in [
        ("logradouro", "o logradouro", 180), ("numero", "o número", 30),
        ("bairro", "o bairro", 100),
    ]:
        address[key] = clean_text(payload.get(key), label, length)
    address["complemento"] = clean_text(payload.get("complemento", ""), "o complemento", 120, False)
    cep = re.sub(r"\D", "", str(payload.get("cep", "")))
    if len(cep) != 8:
        raise ValueError("Informe um CEP com 8 dígitos.")
    trabalhando = payload.get("trabalhando")
    if not isinstance(trabalhando, bool):
        raise ValueError("Informe se está trabalhando atualmente.")
    local_trabalho = clean_text(payload.get("local_trabalho", ""), "o local de trabalho", 180, trabalhando)
    if not trabalhando:
        local_trabalho = ""
    disponibilidade = payload.get("disponibilidade")
    if not isinstance(disponibilidade, list) or not disponibilidade or len(disponibilidade) > 7:
        raise ValueError("Selecione ao menos um dia e horário disponível.")
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
    if not isinstance(pode_se_deslocar, bool):
        raise ValueError("Informe a disponibilidade de locomoção.")
    transporte = clean_text(payload.get("transporte", ""), "o meio de transporte", 80, pode_se_deslocar)
    observacoes = clean_text(payload.get("observacoes_locomocao", ""), "as observações de locomoção", 300, False)
    if not pode_se_deslocar:
        transporte = ""
    return {
        "nome": nome, "cpf": cpf, "setores": json.dumps(setores, ensure_ascii=False),
        "cep": cep, **address, "cidade": "Fortaleza", "uf": "CE",
        "trabalhando": int(trabalhando),
        "local_trabalho": local_trabalho,
        "disponibilidade": json.dumps(slots, ensure_ascii=False),
        "pode_se_deslocar": int(pode_se_deslocar), "transporte": transporte,
        "observacoes_locomocao": observacoes,
    }


def public_row(row):
    value = dict(row)
    value["setores"] = json.loads(value["setores"])
    value["disponibilidade"] = json.loads(value["disponibilidade"])
    value["trabalhando"] = bool(value["trabalhando"])
    value["pode_se_deslocar"] = bool(value["pode_se_deslocar"])
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


def validate_daily_finance(payload):
    return {
        "data_pagamento": validate_date(payload.get("data_pagamento"), "o pagamento", False),
        "valor_centavos": money_cents(payload.get("valor")),
        "vencimento_pagamento": validate_date(payload.get("vencimento_pagamento"), "o vencimento", False),
        "forma_pagamento": clean_text(payload.get("forma_pagamento", ""), "a forma de pagamento", 80, False),
    }


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
    }


def finance_rows():
    with connect() as db:
        manual = db.execute("SELECT * FROM financeiro_lancamentos ORDER BY vencimento DESC, id DESC").fetchall()
        daily = db.execute("""SELECT d.*, p.nome AS diarista_nome FROM diarias d
                              JOIN diaristas p ON p.id = d.diarista_id
                              ORDER BY d.data DESC, d.id DESC""").fetchall()
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


REDES = ("Super do Povo", "Super Lagoa", "Fazendinha", "Hipermarket", "Pinheiro", "Variedades")


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
    }


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
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def route_id(self):
        match = re.fullmatch(r"/api/diaristas/(\d+)", urlparse(self.path).path)
        return int(match.group(1)) if match else None

    def route_diarias(self):
        match = re.fullmatch(r"/api/diaristas/(\d+)/diarias(?:/(\d+))?", urlparse(self.path).path)
        return (int(match.group(1)), int(match.group(2)) if match.group(2) else None) if match else None

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            raise ValueError("Envie os dados em JSON.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > 20000:
            raise ValueError("O cadastro está vazio ou é grande demais.")
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        if not self._allowed_origin():
            return self.respond(HTTPStatus.FORBIDDEN, {"erro": "Acesso não permitido."})
        path = urlparse(self.path).path
        if path == "/api/diaristas":
            with connect() as db:
                rows = db.execute("SELECT * FROM diaristas ORDER BY nome COLLATE NOCASE").fetchall()
            return self.respond(HTTPStatus.OK, [public_row(row) for row in rows])
        if path == "/api/financeiro":
            return self.respond(HTTPStatus.OK, finance_rows())
        if path == "/api/pedidos":
            with connect() as db:
                rows = db.execute("SELECT * FROM pedidos ORDER BY id DESC").fetchall()
            return self.respond(HTTPStatus.OK, [public_order(row) for row in rows])
        if path == "/api/lojas":
            with connect() as db:
                rows = db.execute("SELECT * FROM lojas ORDER BY rede COLLATE NOCASE, cidade COLLATE NOCASE, nome COLLATE NOCASE").fetchall()
            return self.respond(HTTPStatus.OK, [dict(row) for row in rows])
        daily_route = self.route_diarias()
        if daily_route and daily_route[1] is None:
            with connect() as db:
                if not db.execute("SELECT 1 FROM diaristas WHERE id = ?", (daily_route[0],)).fetchone():
                    return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Cadastro não encontrado."})
                rows = db.execute("SELECT * FROM diarias WHERE diarista_id = ? ORDER BY data DESC, id DESC", (daily_route[0],)).fetchall()
            return self.respond(HTTPStatus.OK, [dict(row) for row in rows])
        if path == "/":
            path = "/index.html"
        assets = {"/index.html": "text/html; charset=utf-8", "/style.css": "text/css; charset=utf-8", "/brand.css": "text/css; charset=utf-8", "/app.js": "text/javascript; charset=utf-8", "/finance.js": "text/javascript; charset=utf-8", "/orders.js": "text/javascript; charset=utf-8", "/stores.js": "text/javascript; charset=utf-8", "/remote.js": "text/javascript; charset=utf-8", "/vendor/supabase-2.117.2.js": "text/javascript; charset=utf-8", "/stores.css": "text/css; charset=utf-8", "/login.css": "text/css; charset=utf-8", "/favicon.svg": "image/svg+xml", "/logo-direct-promocoes.jpg": "image/jpeg", "/logo-direct-promocoes-transparente.png": "image/png"}
        if path in assets:
            return self.respond(HTTPStatus.OK, (STATIC / path[1:]).read_bytes(), assets[path])
        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Página não encontrada."})

    def do_POST(self):
        if not self._allowed_origin():
            return self.respond(HTTPStatus.FORBIDDEN, {"erro": "Acesso não permitido."})
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
                data = validate_order(self.read_json())
                now = datetime.now(timezone.utc).isoformat()
                with connect() as db:
                    columns = ", ".join(data)
                    marks = ", ".join("?" for _ in data)
                    cur = db.execute(f"INSERT INTO pedidos ({columns}, criado_em, atualizado_em) VALUES ({marks}, ?, ?)", (*data.values(), now, now))
                    row = db.execute("SELECT * FROM pedidos WHERE id = ?", (cur.lastrowid,)).fetchone()
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
        store_match = re.fullmatch(r"/api/lojas/(\d+)", urlparse(self.path).path)
        if store_match:
            try:
                data = validate_store(self.read_json())
                store_id = int(store_match.group(1))
                with connect() as db:
                    fields = ", ".join(f"{key} = ?" for key in data)
                    cur = db.execute(f"UPDATE lojas SET {fields}, atualizado_em = ? WHERE id = ?", (*data.values(), datetime.now(timezone.utc).isoformat(), store_id))
                    if not cur.rowcount:
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
                data = validate_order(self.read_json())
                order_id = int(order_match.group(1))
                with connect() as db:
                    fields = ", ".join(f"{key} = ?" for key in data)
                    cur = db.execute(f"UPDATE pedidos SET {fields}, atualizado_em = ? WHERE id = ?", (*data.values(), datetime.now(timezone.utc).isoformat(), order_id))
                    if not cur.rowcount:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Pedido não encontrado."})
                    row = db.execute("SELECT * FROM pedidos WHERE id = ?", (order_id,)).fetchone()
                return self.respond(HTTPStatus.OK, public_order(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        finance_match = re.fullmatch(r"/api/financeiro/(\d+)", urlparse(self.path).path)
        if finance_match:
            try:
                data = validate_finance_entry(self.read_json())
                entry_id = int(finance_match.group(1))
                with connect() as db:
                    fields = ", ".join(f"{key} = ?" for key in data)
                    cur = db.execute(f"UPDATE financeiro_lancamentos SET {fields}, atualizado_em = ? WHERE id = ?", (*data.values(), datetime.now(timezone.utc).isoformat(), entry_id))
                    if not cur.rowcount:
                        return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Lançamento não encontrado."})
                    row = db.execute("SELECT * FROM financeiro_lancamentos WHERE id = ?", (entry_id,)).fetchone()
                return self.respond(HTTPStatus.OK, dict(row))
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                return self.respond(HTTPStatus.BAD_REQUEST, {"erro": str(exc)})
        record_id = self.route_id()
        if record_id is None:
            return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rota não encontrada."})
        try:
            data = validate(self.read_json())
            with connect() as db:
                fields = ", ".join(f"{key} = ?" for key in data)
                cur = db.execute(f"UPDATE diaristas SET {fields}, atualizado_em = ? WHERE id = ?", (*data.values(), datetime.now(timezone.utc).isoformat(), record_id))
                if not cur.rowcount:
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
                with connect() as db:
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
        order_match = re.fullmatch(r"/api/pedidos/(\d+)", urlparse(self.path).path)
        if order_match:
            with connect() as db:
                cur = db.execute("DELETE FROM pedidos WHERE id = ?", (int(order_match.group(1)),))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})
        finance_match = re.fullmatch(r"/api/financeiro/(\d+)", urlparse(self.path).path)
        if finance_match:
            with connect() as db:
                cur = db.execute("DELETE FROM financeiro_lancamentos WHERE id = ?", (int(finance_match.group(1)),))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})
        daily_route = self.route_diarias()
        if daily_route and daily_route[1] is not None:
            with connect() as db:
                daily = db.execute("SELECT data_pagamento FROM diarias WHERE id = ? AND diarista_id = ?", (daily_route[1], daily_route[0])).fetchone()
                if daily and daily["data_pagamento"]:
                    return self.respond(HTTPStatus.CONFLICT, {"erro": "Esta diária já foi paga e faz parte do histórico financeiro. Corrija os dados do pagamento em vez de excluí-la."})
                cur = db.execute("DELETE FROM diarias WHERE id = ? AND diarista_id = ?", (daily_route[1], daily_route[0]))
            return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})
        record_id = self.route_id()
        if record_id is None:
            return self.respond(HTTPStatus.NOT_FOUND, {"erro": "Rota não encontrada."})
        with connect() as db:
            if db.execute("SELECT 1 FROM diarias WHERE diarista_id = ? LIMIT 1", (record_id,)).fetchone():
                return self.respond(HTTPStatus.CONFLICT, {"erro": "Este cadastro tem diárias registradas. Mantenha a ficha para preservar o histórico; se necessário, bloqueie a diarista para novas diárias."})
            cur = db.execute("DELETE FROM diaristas WHERE id = ?", (record_id,))
        return self.respond(HTTPStatus.OK if cur.rowcount else HTTPStatus.NOT_FOUND, {"ok": bool(cur.rowcount)})


if __name__ == "__main__":
    init_db()
    print(f"Cadastro de diaristas: http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
