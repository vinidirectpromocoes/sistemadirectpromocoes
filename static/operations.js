function homeToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function loadHome() {
  const notice = document.querySelector('#home-feedback');
  notice.hidden = true;
  try {
    const role = window.directRemote?.role || 'admin';
    const canFinance = ['admin', 'financeiro'].includes(role);
    const canReadings = ['admin', 'operacao'].includes(role);
    const canOperate = ['admin', 'operacao'].includes(role);
    document.querySelector('#home-reading').parentElement.hidden = !canReadings;
    document.querySelector('#home-overdue').parentElement.hidden = !canFinance;
    const [orders, finance, readings] = await Promise.all([
      request('/api/pedidos'), canFinance ? request('/api/financeiro') : [],
      canReadings ? request('/api/leituras-pendentes') : [],
    ]);
    const scales = {};
    await Promise.all(orders.filter(order => order.situacao !== 'cancelado').map(async order => {
      scales[order.id] = await request(`/api/pedidos/${order.id}/escalas`);
    }));
    const today = homeToday();
    let open = 0, attendance = 0;
    for (const order of orders) {
      if (['cancelado', 'concluido'].includes(order.situacao)) continue;
      for (const shift of order.turnos) {
        if (shift.data < today) continue;
        const active = (scales[order.id] || []).filter(scale => scale.data === shift.data && scale.status !== 'falta');
        open += Math.max(0, order.quantidade_diaristas - active.length);
      }
      attendance += (scales[order.id] || []).filter(scale => scale.status === 'escalada' && scale.data <= today).length;
    }
    const pending = readings.filter(row => row.status === 'pendente').length;
    const overdue = finance.filter(row => !row.data_pagamento && row.valor_centavos != null && row.vencimento && row.vencimento < today).length;
    for (const [id, value] of [['home-open', open], ['home-attendance', attendance], ['home-reading', pending], ['home-overdue', overdue]]) {
      document.getElementById(id).textContent = String(value);
    }
    const list = document.getElementById('home-actions'); list.replaceChildren();
    const actions = [
      [canOperate ? open : 0, 'Vagas a preencher nos próximos pedidos', '#pedidos'],
      [canOperate ? attendance : 0, 'Confirmar presença ou falta das escalas', '#pedidos'],
      [canReadings ? pending : 0, 'Completar leituras pendentes', '#leitura'],
      [canFinance ? overdue : 0, 'Conferir lançamentos vencidos', '#financeiro'],
    ];
    for (const [count, label, href] of actions.filter(item => item[0] > 0)) {
      const link = document.createElement('a'); link.href = href; link.className = 'home-action';
      const number = document.createElement('strong'); number.textContent = String(count);
      const text = document.createElement('span'); text.textContent = label;
      const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
      link.append(number, text, arrow); list.append(link);
    }
    if (!list.children.length) list.textContent = 'Tudo em dia. As novas pendências aparecerão aqui.';
  } catch (error) {
    notice.textContent = `Não foi possível atualizar as pendências: ${error.message}`;
    notice.hidden = false;
  }
}
