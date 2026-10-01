"""Calendário quinzenal comum ao recebimento e ao pagamento de diárias."""
from calendar import monthrange
from datetime import date

INITIAL_CALENDARS = {"Fazendinha": (20, 5), "Hipermarket": (20, 5),
                     "Super Lagoa": (30, 15), "Super do Povo": (30, 15)}


def payment_due(service_date, first_day, second_day):
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
    if days == [None, None]:
        return dict(zip(("pagamento_primeira_quinzena", "pagamento_segunda_quinzena"), days))
    if any(type(day) is not int or not 1 <= day <= 31 for day in days):
        raise ValueError("Informe os dois dias de pagamento, de 1 a 31, ou deixe ambos em branco.")
    return dict(zip(("pagamento_primeira_quinzena", "pagamento_segunda_quinzena"), days))


def refresh_pending(db, network):
    for row in db.execute("""SELECT d.id, d.data, d.vencimento_origem,
            r.pagamento_primeira_quinzena, r.pagamento_segunda_quinzena
        FROM diarias d JOIN pedido_escalas e ON e.id=d.pedido_escala_id
        JOIN pedidos p ON p.id=e.pedido_id JOIN tarifas_redes r ON lower(r.rede)=lower(p.supermercado)
        WHERE r.id=? AND d.data_pagamento IS NULL AND d.pagamento_lote_id IS NULL
          AND d.vencimento_origem IN ('calendario', 'nao_informado')""", (network,)).fetchall():
        due = payment_due(row["data"], row["pagamento_primeira_quinzena"], row["pagamento_segunda_quinzena"])
        db.execute("UPDATE diarias SET vencimento_pagamento=?, vencimento_recebimento=?, vencimento_origem=? WHERE id=?",
                   (due, due, "calendario" if due else "nao_informado", row["id"]))
