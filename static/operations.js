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
    const queue = [];
    const tomorrowDate = new Date(`${today}T12:00:00Z`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);
    for (const order of orders) {
      if (order.situacao === 'cancelado') continue;
      for (const shift of order.turnos) {
        const active = (scales[order.id] || []).filter(scale => scale.data === shift.data && scale.status !== 'falta');
        const vacancies = Math.max(0, order.quantidade_diaristas - active.length);
        if (shift.data >= today && order.situacao !== 'concluido') open += vacancies;
        if (canOperate && shift.data >= today && shift.data <= tomorrow && vacancies && order.situacao !== 'concluido')
          queue.push({ priority: shift.data === today ? 0 : 1, label: `${vacancies} vaga(s) · ${order.supermercado} ${order.unidade} · ${order.setor} · ${dateLabel(shift.data)}`, kind: 'order', id: order.id });
      }
      const awaiting = (scales[order.id] || []).filter(scale => scale.status === 'escalada' && scale.data <= today);
      attendance += awaiting.length;
      if (canOperate) for (const scale of awaiting.slice(0, 4))
        queue.push({ priority: -1, label: `Confirmar ${scale.diarista_nome} · ${order.supermercado} · ${dateLabel(scale.data)}`, kind: 'order', id: order.id });
    }
    const pending = readings.filter(row => row.status === 'pendente').length;
    const overdueRows = finance.filter(row => row.valor_centavos != null && row.vencimento && row.vencimento < today &&
      (row.origem === 'cobranca' ? row.valor_recebido_centavos < row.valor_centavos : !row.data_pagamento));
    const overdue = overdueRows.length;
    if (canFinance) for (const item of overdueRows.slice(0, 5)) queue.push({ priority: 2,
      label: `${item.origem === 'cobranca' ? 'Cobrança' : 'Pagamento'} vencido · ${item.contraparte} · ${moneyLabel(item.origem === 'cobranca' ? item.valor_centavos - item.valor_recebido_centavos : item.valor_centavos)}`,
      kind: item.origem === 'cobranca' ? 'invoice' : 'finance', id: item.id });
    if (canReadings && pending) queue.push({ priority: 3, label: `${pending} leitura(s) aguardando revisão`, kind: 'reading' });
    for (const [id, value] of [['home-open', open], ['home-attendance', attendance], ['home-reading', pending], ['home-overdue', overdue]]) {
      document.getElementById(id).textContent = String(value);
    }
    const list = document.getElementById('home-actions'); list.replaceChildren();
    if (canOperate && open && !queue.some(item => item.kind === 'order' && item.priority >= 0))
      queue.push({ priority: 4, label: `${open} vaga(s) em datas posteriores`, kind: 'orders' });
    for (const action of queue.sort((a, b) => a.priority - b.priority).slice(0, 15)) {
      const link = document.createElement('a'); link.href = action.kind === 'reading' ? '#leitura' : ['invoice','finance'].includes(action.kind) ? '#financeiro' : '#pedidos'; link.className = 'home-action';
      const number = document.createElement('strong'); number.textContent = action.kind === 'order' ? '▤' : action.kind === 'invoice' ? '◉' : '↗';
      const text = document.createElement('span'); text.textContent = action.label;
      const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
      link.append(number, text, arrow); list.append(link);
      if (action.kind === 'order') link.addEventListener('click', async event => {
        event.preventDefault(); location.hash = '#pedidos'; await loadOrders(); await openOrderDetail(action.id);
      });
      if (action.kind === 'invoice') link.addEventListener('click', async event => {
        event.preventDefault(); location.hash = '#financeiro'; await loadFinance(); window.openInvoiceDetail(action.id);
      });
    }
    if (!list.children.length) list.textContent = 'Tudo em dia. As novas pendências aparecerão aqui.';
  } catch (error) {
    notice.textContent = `Não foi possível atualizar as pendências: ${error.message}`;
    notice.hidden = false;
  }
}
