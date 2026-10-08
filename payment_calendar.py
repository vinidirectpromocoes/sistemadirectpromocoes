"""Calendários quinzenal e semanal comuns aos recebimentos e pagamentos."""
from calendar import monthrange
from datetime import date, timedelta

INITIAL_CALENDARS = {"Fazendinha": (20, 5), "Hipermarket": (20, 5),
                     "Super Lagoa": (30, 15), "Super do Povo": (30, 15)}
INITIAL_WEEKLY_CALENDARS = {"Pinheiro": 6, "Variedades": 6}


def payment_due(service_date, first_day, second_day, weekly_day=None):
    if weekly_day is not None:
        if type(weekly_day) is not int or weekly_day not in (5, 6):
            raise ValueError("O prazo semanal deve ser sexta-feira ou sábado.")
        service = date.fromisoformat(service_date)
        return (service - timedelta(days=service.weekday()) + timedelta(days=7 + weekly_day - 1)).isoformat()
    if first_day is None or second_day is None:
        return None
    service = date.fromisoformat(service_date)
    year, month = service.year, service.month
    day = first_day
    if service.day > 15:
        month += 1
        if month == 13:
            year, month = year + 1, 1
        day = second_day
    return date(year, month, min(day, monthrange(year, month)[1])).isoformat()


def validate_calendar(payload):
    if not isinstance(payload, dict):
        raise ValueError("Calendário inválido.")
    days = [payload.get(key) for key in ("pagamento_primeira_quinzena", "pagamento_segunda_quinzena")]
    weekly = payload.get("pagamento_semanal_dia")
    if weekly is not None and (type(weekly) is not int or weekly not in (5, 6) or days != [None, None]):
        raise ValueError("Escolha sexta-feira ou sábado para o prazo semanal e deixe os dias quinzenais em branco.")
    result = dict(zip(("pagamento_primeira_quinzena", "pagamento_segunda_quinzena"), days))
    result["pagamento_semanal_dia"] = weekly
    if days == [None, None]:
        return result
    if any(type(day) is not int or not 1 <= day <= 31 for day in days):
        raise ValueError("Informe os dois dias de pagamento, de 1 a 31, ou deixe ambos em branco.")
    return result


def refresh_pending(db, network):
    for row in db.execute("""SELECT d.id, d.data, d.vencimento_origem,
            r.pagamento_primeira_quinzena, r.pagamento_segunda_quinzena, r.pagamento_semanal_dia
        FROM diarias d JOIN pedido_escalas e ON e.id=d.pedido_escala_id
        JOIN pedidos p ON p.id=e.pedido_id JOIN tarifas_redes r ON lower(r.rede)=lower(p.supermercado)
        WHERE r.id=? AND d.data_pagamento IS NULL AND d.pagamento_lote_id IS NULL
          AND d.vencimento_origem IN ('calendario', 'nao_informado')""", (network,)).fetchall():
        due = payment_due(row["data"], row["pagamento_primeira_quinzena"], row["pagamento_segunda_quinzena"], row["pagamento_semanal_dia"])
        db.execute("UPDATE diarias SET vencimento_pagamento=?, vencimento_recebimento=?, vencimento_origem=? WHERE id=?",
                   (due, due, "calendario" if due else "nao_informado", row["id"]))
