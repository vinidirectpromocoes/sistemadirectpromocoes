const financeToday = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
let visibleFinanceRows = [];
let financeOpenGroupId = null;
let financeForecastInput = null;
let financeLoadSequence = 0;

function renderFinanceForecast() {
  if (!financeForecastInput) return;
  const period = $('#forecast-period').value === 'month' ? $('#finance-month').value : '';
  const data = window.DirectForecast.calculate(financeForecastInput.orders, financeForecastInput.scales, financeForecastInput.tariffs, period);
  const count = (value, singular, plural) => `${value} ${value === 1 ? singular : plural}`;
  for (const [key, field] of [['revenue', 'revenue'], ['cost', 'cost'], ['margin', 'margin']]) {
    $(`#forecast-${key}`).textContent = moneyLabel(data.expected[field]);
    $(`#forecast-${key}-ideal`).textContent = `Cenário ideal: ${moneyLabel(data.ideal[field])}`;
  }
  $('#forecast-extra').textContent = moneyLabel(data.expected.extras);
  $('#forecast-net').textContent = moneyLabel(data.expected.net);
  const warning = $('#forecast-warning');
  warning.hidden = !data.missingRevenue && !data.missingCost;
  warning.textContent = `Há ${data.missingRevenue} diária(s) sem tarifa de faturamento e ${data.missingCost} sem tarifa de pagamento. Complete os valores em Configurações; os totais acima incluem apenas valores conhecidos.`;
  const revenue = Math.max(0, data.expected.revenue);
  const costShare = revenue ? Math.min(100, data.expected.cost / revenue * 100) : 0;
  const extraEnd = revenue ? Math.min(100, (data.expected.cost + data.expected.extras) / revenue * 100) : 0;
  const ring = $('#forecast-ring');
  ring.style.setProperty('--forecast-cost-share', `${costShare}%`);
  ring.style.setProperty('--forecast-extra-end', `${extraEnd}%`);
  ring.setAttribute('aria-label', `Faturamento ${moneyLabel(data.expected.revenue)}, diárias ${moneyLabel(data.expected.cost)}, extras ${moneyLabel(data.expected.extras)}, resultado líquido estimado ${moneyLabel(data.expected.net)}`);
  $('#forecast-ring-total').textContent = moneyLabel(data.expected.revenue);
  $('#forecast-presence-note').textContent = `${count(data.byOrder.length, 'pedido', 'pedidos')} · ${count(data.demand, 'diária solicitada', 'diárias solicitadas')} · ${count(data.expectedDays, 'prevista', 'previstas')} · ${count(data.present, 'presença', 'presenças')} · ${count(data.absent, 'falta', 'faltas')}`;
  $('#forecast-orders-summary').textContent = `Conferir ${count(data.byOrder.length, 'pedido incluído', 'pedidos incluídos')}`;
  if (typeof window.renderReconciliation === 'function') window.renderReconciliation();
  const orderList = $('#forecast-orders-list'); orderList.replaceChildren();
  if (!data.byOrder.length) orderList.textContent = 'Nenhum pedido neste período.';
  data.byOrder.forEach(order => {
    const row = document.createElement('div'); row.className = 'forecast-order';
    const title = document.createElement('strong'); title.textContent = `Pedido #${order.id} · ${order.network}${order.unit ? ` · ${order.unit}` : ''} · ${order.sector}`;
    const detail = document.createElement('span'); detail.textContent = `${order.days}/${order.requested} diárias previstas · ${count(order.present, 'presença', 'presenças')} · ${count(order.absent, 'falta', 'faltas')}`;
    const values = document.createElement('small'); values.textContent = `Faturamento ${moneyLabel(order.revenue)} · diárias ${moneyLabel(order.cost)} · extras ${moneyLabel(order.extras)} · líquido estimado ${moneyLabel(order.net)}`;
    const open = document.createElement('button'); open.type = 'button'; open.className = 'text-button forecast-order-open'; open.textContent = 'Abrir pedido';
    open.setAttribute('aria-label', `Abrir pedido número ${order.id}`);
    open.addEventListener('click', async () => { location.hash = '#pedidos'; await loadOrders(); openOrderDetail(order.id); });
    row.append(title, detail, values, open); orderList.append(row);
  });
  const list = $('#forecast-networks'); list.replaceChildren();
  if (!data.byNetwork.some(item => item.days)) { list.textContent = data.byOrder.length ? 'Nenhuma diária prevista após as faltas registradas.' : 'Nenhum pedido neste período.'; return; }
  const max = Math.max(1, ...data.byNetwork.map(item => item.revenue));
  data.byNetwork.filter(item => item.days).forEach(item => {
    const row = document.createElement('div'); row.className = 'forecast-network';
    const head = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = item.name;
    const value = document.createElement('span'); value.textContent = moneyLabel(item.revenue);
    head.append(name, value);
    const track = document.createElement('div'); track.className = 'forecast-network-track';
    const bar = document.createElement('span'); bar.style.width = `${item.revenue / max * 100}%`;
    track.append(bar);
    const detail = document.createElement('small'); detail.textContent = `${item.days} diária(s) · diárias ${moneyLabel(item.cost)} · extras ${moneyLabel(item.extras)} · líquido estimado ${moneyLabel(item.net)}`;
    row.append(head, track, detail); list.append(row);
  });
}

function showFinanceFeedback(message, isError = false) {
  const box = $('#finance-feedback');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = false;
  window.clearTimeout(showFinanceFeedback.timer);
  showFinanceFeedback.timer = window.setTimeout(() => { box.hidden = true; }, 5000);
}

function financeStatus(item) {
  if (item.valor_centavos == null) return { label: 'Sem valor', style: 'incomplete' };
  if (item.origem === 'cobranca') {
    if (item.valor_recebido_centavos >= item.valor_centavos) return { label: 'Recebida', style: 'settled' };
    if (item.valor_recebido_centavos > 0) return { label: 'Parcial', style: 'partial' };
    if (item.vencimento < financeToday()) return { label: 'Atrasada', style: 'overdue' };
    return { label: 'A receber', style: 'open' };
  }
  if (item.data_pagamento) return { label: item.tipo === 'receita' ? 'Recebido' : 'Pago', style: 'settled' };
  if (item.origem === 'diaria' && !item.vencimento) return { label: 'Sem vencimento', style: 'incomplete' };
  if (item.vencimento && item.vencimento < financeToday()) return { label: 'Atrasado', style: 'overdue' };
  return { label: item.tipo === 'receita' ? 'A receber' : 'A pagar', style: 'open' };
}

function financePeriodDate(item) {
  return item.data_pagamento || item.vencimento || item.referencia;
}

function filteredFinanceRows({ ignoreType = false, ignoreStatus = false } = {}) {
  const month = $('#finance-month').value;
  const allMonths = $('#finance-all-months').checked;
  const type = $('#finance-type-filter').value;
  const status = $('#finance-status-filter').value;
  const query = $('#finance-search').value.trim().toLocaleLowerCase('pt-BR');
  return financeRecords.filter(item => {
    if (!allMonths && month && !financePeriodDate(item)?.startsWith(month)) return false;
    if (!ignoreType && type !== 'todos' && item.tipo !== type) return false;
    const settled = financeStatus(item).style === 'settled';
    if (!ignoreStatus && status === 'pago' && !settled) return false;
    if (!ignoreStatus && status === 'pendente' && settled) return false;
    if (!ignoreStatus && status === 'sem-valor' && item.valor_centavos != null) return false;
    if (!ignoreStatus && status === 'sem-vencimento' && !(item.origem === 'diaria' && !item.data_pagamento && item.valor_centavos != null && !item.vencimento)) return false;
    if (query && !`${item.descricao} ${item.contraparte} ${item.categoria}`.toLocaleLowerCase('pt-BR').includes(query)) return false;
    return true;
  }).sort((a, b) => String(financePeriodDate(b) || '').localeCompare(String(financePeriodDate(a) || '')) || b.id - a.id);
}

function renderFinanceChart(chartId, legendId, segments, centerValue, centerLabel, filterId) {
  const chart = $(`#${chartId}`);
  const legend = $(`#${legendId}`);
  chart.replaceChildren();
  legend.replaceChildren();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const selected = $(`#${filterId}`).value;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', chart.getAttribute('aria-label'));
  const circle = (className, color) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    node.setAttribute('class', className);
    node.setAttribute('cx', '60'); node.setAttribute('cy', '60'); node.setAttribute('r', '43');
    node.setAttribute('fill', 'none'); node.setAttribute('stroke', color); node.setAttribute('stroke-width', '15');
    return node;
  };
  svg.append(circle('finance-donut-track', 'currentColor'));
  const circumference = 2 * Math.PI * 43;
  let offset = 0;
  segments.forEach(segment => {
    const active = selected === segment.filter;
    if (total && segment.value) {
      const slice = circle(`finance-donut-slice${active ? ' is-active' : ''}`, segment.color);
      slice.setAttribute('stroke-dasharray', `${Math.max(0, segment.value / total * circumference - 1)} ${circumference}`);
      slice.setAttribute('stroke-dashoffset', String(-offset));
      slice.setAttribute('transform', 'rotate(-90 60 60)');
      slice.setAttribute('tabindex', '0');
      slice.setAttribute('role', 'button');
      slice.setAttribute('aria-label', `${segment.label}: ${segment.display}. ${active ? 'Remover filtro' : 'Filtrar lançamentos'}`);
      slice.addEventListener('click', () => { $(`#${filterId}`).value = active ? 'todos' : segment.filter; renderFinance(); });
      slice.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); slice.dispatchEvent(new Event('click')); }
      });
      svg.append(slice);
      offset += segment.value / total * circumference;
    }
    const button = document.createElement('button');
    button.type = 'button'; button.className = `finance-legend-button${active ? ' is-active' : ''}`;
    button.disabled = segment.value === 0;
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${segment.label}: ${segment.display}. ${active ? 'Remover filtro' : 'Filtrar lançamentos'}`);
    const dot = document.createElement('span'); dot.className = `finance-legend-dot ${segment.colorClass}`; dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.textContent = segment.label;
    const value = document.createElement('strong'); value.textContent = segment.display;
    button.append(dot, name, value);
    button.addEventListener('click', () => { $(`#${filterId}`).value = active ? 'todos' : segment.filter; renderFinance(); });
    legend.append(button);
  });
  const center = document.createElement('div'); center.className = 'finance-donut-center';
  const value = document.createElement('strong'); value.textContent = centerValue;
  const label = document.createElement('span'); label.textContent = centerLabel;
  center.append(value, label); chart.append(svg, center);
}

function renderFinanceCharts() {
  const typeRows = filteredFinanceRows({ ignoreType: true });
  const typeAmount = kind => typeRows.reduce((sum, item) => sum + (item.tipo === kind ? item.valor_centavos || 0 : 0), 0);
  const income = typeAmount('receita');
  const expense = typeAmount('despesa');
  const compactMoney = value => `R$ ${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100)}`;
  renderFinanceChart('finance-type-chart', 'finance-type-legend', [
    { label: 'Entradas', value: income, display: moneyLabel(income), color: '#2378eb', colorClass: 'income', filter: 'receita' },
    { label: 'Saídas', value: expense, display: moneyLabel(expense), color: '#f0a04d', colorClass: 'expense', filter: 'despesa' },
  ], compactMoney(income + expense), 'valor conhecido', 'finance-type-filter');
  const statusRows = filteredFinanceRows({ ignoreStatus: true });
  const settled = statusRows.filter(item => financeStatus(item).style === 'settled').length;
  const pending = statusRows.length - settled;
  renderFinanceChart('finance-status-chart', 'finance-status-legend', [
    { label: 'Liquidados', value: settled, display: String(settled), color: '#22aa84', colorClass: 'settled', filter: 'pago' },
    { label: 'Pendentes', value: pending, display: String(pending), color: '#e9984b', colorClass: 'pending', filter: 'pendente' },
  ], String(statusRows.length), statusRows.length === 1 ? 'lançamento' : 'lançamentos', 'finance-status-filter');
  const anyFilter = $('#finance-all-months').checked || $('#finance-month').value !== financeToday().slice(0, 7) || $('#finance-search').value || $('#finance-type-filter').value !== 'todos' || $('#finance-status-filter').value !== 'todos';
  $('#finance-clear-filters').hidden = !anyFilter;
}

function groupedFinanceRows(items) {
  const byDiarista = new Map();
  items.forEach(item => {
    if (item.origem === 'diaria' && item.diarista_id != null) {
      const list = byDiarista.get(item.diarista_id) || [];
      list.push(item);
      byDiarista.set(item.diarista_id, list);
    }
  });
  const shown = new Set();
  return items.flatMap(item => {
    if (item.origem !== 'diaria' || item.diarista_id == null) return [item];
    if (shown.has(item.diarista_id)) return [];
    shown.add(item.diarista_id);
    const days = byDiarista.get(item.diarista_id);
    return days.length > 1 ? [{ kind: 'daily-group', diarista_id: item.diarista_id, items: days }] : [item];
  });
}

function financeGroupTotals(items) {
  return {
    known: items.reduce((sum, item) => sum + (item.valor_centavos || 0), 0),
    pending: items.reduce((sum, item) => sum + (item.data_pagamento ? 0 : item.valor_centavos || 0), 0),
    paid: items.reduce((sum, item) => sum + (item.data_pagamento ? item.valor_centavos || 0 : 0), 0),
    missing: items.filter(item => item.valor_centavos == null).length,
    paidCount: items.filter(item => item.data_pagamento).length,
  };
}

function financeGroupStatus(items, totals) {
  if (totals.missing) return { label: 'Incompleto', style: 'incomplete' };
  if (totals.paidCount === items.length) return { label: 'Pago', style: 'settled' };
  if (items.some(item => !item.data_pagamento && item.valor_centavos != null && !item.vencimento)) return { label: 'Sem vencimento', style: 'incomplete' };
  if (totals.paidCount) return { label: 'Parcial', style: 'partial' };
  if (items.some(item => item.vencimento && item.vencimento < financeToday())) return { label: 'Atrasado', style: 'overdue' };
  return { label: 'A pagar', style: 'open' };
}

function financeGroupDates(items) {
  const dates = items.map(item => item.data).sort();
  return dates[0] === dates.at(-1) ? `Diárias de ${dateLabel(dates[0])}` : `Diárias de ${dateLabel(dates[0])} a ${dateLabel(dates.at(-1))}`;
}

function financeGroupSummaryStat(label, value) {
  const card = document.createElement('div'); card.className = 'finance-group-stat';
  const caption = document.createElement('span'); caption.textContent = label;
  const amount = document.createElement('strong'); amount.textContent = value;
  card.append(caption, amount);
  return card;
}

function renderFinanceGroup() {
  const items = visibleFinanceRows.filter(item => item.origem === 'diaria' && item.diarista_id === financeOpenGroupId);
  if (!items.length) { if ($('#finance-group-dialog').open) $('#finance-group-dialog').close(); return false; }
  $('#finance-group-dialog').querySelector('.finance-group-notice')?.remove();
  $('#finance-group-dialog').querySelector('.finance-batch-button')?.remove();
  $('#finance-group-title').textContent = items[0].contraparte;
  const totals = financeGroupTotals(items);
  const summary = $('#finance-group-summary');
  summary.replaceChildren(
    financeGroupSummaryStat('Diárias', String(items.length)),
    financeGroupSummaryStat(totals.missing ? 'Subtotal com valor' : 'Total das diárias', totals.missing === items.length ? 'A definir' : moneyLabel(totals.known)),
    financeGroupSummaryStat('Pendente conhecido', moneyLabel(totals.pending)),
    financeGroupSummaryStat('Já pago', moneyLabel(totals.paid)),
  );
  const list = $('#finance-group-items'); list.replaceChildren();
  items.slice().sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id).forEach(item => {
    const row = document.createElement('article'); row.className = 'finance-daily-item';
    const main = document.createElement('div'); main.className = 'finance-daily-main';
    const when = document.createElement('strong'); when.textContent = dateLabel(item.data);
    const place = document.createElement('span'); place.textContent = `${item.setor} · ${item.local}`;
    main.append(when, place);
    const amount = document.createElement('strong'); amount.className = 'finance-daily-value'; amount.textContent = moneyLabel(item.valor_centavos);
    const meta = document.createElement('div'); meta.className = 'finance-daily-meta';
    const state = financeStatus(item);
    const badge = document.createElement('span'); badge.className = `finance-badge ${state.style}`; badge.textContent = state.label;
    const detail = document.createElement('span');
    detail.textContent = item.data_pagamento ? `Pago em ${dateLabel(item.data_pagamento)}${item.forma_pagamento ? ` · ${item.forma_pagamento}` : ''}` : item.vencimento ? `Vence em ${dateLabel(item.vencimento)}` : 'Vencimento não informado';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = item.valor_centavos == null ? 'Completar pagamento' : 'Editar pagamento';
    edit.setAttribute('aria-label', `${edit.textContent} da diária de ${dateLabel(item.data)}`);
    edit.disabled = Boolean(item.pagamento_lote_id);
    if (item.pagamento_lote_id) edit.title = 'Pagamento feito em lote. Reabra o fechamento para corrigir.';
    edit.addEventListener('click', () => { $('#finance-group-dialog').close(); startPayment(item, 'finance-group'); });
    meta.append(badge, detail, edit);
    row.append(main, amount, meta); list.append(row);
  });
  if (totals.missing) {
    const notice = document.createElement('p'); notice.className = 'finance-group-notice';
    notice.textContent = `${totals.missing} diária${totals.missing === 1 ? '' : 's'} sem valor. Complete para calcular o total definitivo.`;
    summary.after(notice);
  }
  const payable = items.filter(item => !item.data_pagamento && item.valor_centavos > 0);
  if (payable.length && typeof window.openPaymentBatch === 'function') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-primary';
    button.textContent = `Fechar pagamento (${payable.length})`;
    button.addEventListener('click', () => window.openPaymentBatch(financeOpenGroupId, payable));
    list.before(button);
    button.classList.add('finance-batch-button');
  }
  return true;
}

function openFinanceGroup(diaristaId) {
  financeOpenGroupId = diaristaId;
  if (renderFinanceGroup() && !$('#finance-group-dialog').open) $('#finance-group-dialog').showModal();
}

function renderFinance() {
  const month = $('#finance-month').value;
  const allMonths = $('#finance-all-months').checked;
  const total = (type, paid) => financeRecords.reduce((sum, item) => {
    if (item.tipo !== type || item.valor_centavos == null) return sum;
    if (item.origem === 'cobranca') {
      if (paid) return sum + item.recebimentos.reduce((value, receipt) =>
        value + (!receipt.estornado && (allMonths || receipt.data_recebimento.startsWith(month)) ? receipt.valor_centavos : 0), 0);
      return sum + Math.max(0, item.valor_centavos - item.valor_recebido_centavos);
    }
    if (paid && item.data_pagamento && (allMonths || item.data_pagamento.startsWith(month))) return sum + item.valor_centavos;
    if (!paid && !item.data_pagamento) return sum + item.valor_centavos;
    return sum;
  }, 0);
  const incoming = total('receita', true);
  const outgoing = total('despesa', true);
  $('#finance-in').textContent = moneyLabel(incoming);
  $('#finance-out').textContent = moneyLabel(outgoing);
  $('#finance-in').previousElementSibling.textContent = allMonths ? 'Entradas realizadas' : 'Entradas no mês';
  $('#finance-out').previousElementSibling.textContent = allMonths ? 'Saídas realizadas' : 'Saídas no mês';
  $('#finance-balance').textContent = moneyLabel(incoming - outgoing);
  $('#finance-receivable').textContent = moneyLabel(total('receita', false));
  $('#finance-payable').textContent = moneyLabel(total('despesa', false));
  renderFinanceForecast();
  const missing = financeRecords.filter(item => item.origem === 'diaria' && item.valor_centavos == null).length;
  const missingDue = financeRecords.filter(item => item.origem === 'diaria' && item.valor_centavos != null && !item.data_pagamento && !item.vencimento).length;
  const warning = $('#finance-warning');
  warning.hidden = missing === 0 && missingDue === 0;
  warning.replaceChildren();
  for (const [count, label, filter] of [
    [missing, 'sem valor informado; complete para calcular os totais', 'sem-valor'],
    [missingDue, 'sem vencimento; informe a data para acompanhar atrasos', 'sem-vencimento'],
  ]) {
    if (!count) continue;
    const note = document.createElement('div');
    const text = document.createElement('span'); text.textContent = `${count} diária${count === 1 ? '' : 's'} ${label}. `;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = 'Ver diárias';
    button.addEventListener('click', () => { $('#finance-all-months').checked = true; $('#finance-status-filter').value = filter; renderFinance(); });
    note.append(text, button); warning.append(note);
  }

  visibleFinanceRows = filteredFinanceRows();
  renderFinanceCharts();
  $('#finance-empty').hidden = visibleFinanceRows.length !== 0;
  $('#finance-table-wrap').hidden = visibleFinanceRows.length === 0;
  const body = $('#finance-rows'); body.replaceChildren();
  groupedFinanceRows(visibleFinanceRows).forEach(item => {
    if (item.kind === 'daily-group') {
      const days = item.items;
      const totals = financeGroupTotals(days);
      const row = document.createElement('tr'); row.className = 'finance-group-row';
      const description = document.createElement('td');
      const title = document.createElement('strong'); title.textContent = `${days.length} diárias agrupadas`;
      const category = document.createElement('small'); category.textContent = 'Pagamento de diarista';
      description.append(title, category); row.append(description);
      row.append(cell(days[0].contraparte));
      row.append(cell(financeGroupDates(days)));
      const type = document.createElement('td');
      const typeBadge = document.createElement('span'); typeBadge.className = 'finance-type despesa'; typeBadge.textContent = 'Saída'; type.append(typeBadge); row.append(type);
      const value = document.createElement('td'); value.className = 'finance-value-cell';
      const valueMain = document.createElement('strong'); valueMain.textContent = totals.missing === days.length ? 'Sem valor' : moneyLabel(totals.known);
      value.append(valueMain);
      if (totals.missing) { const hint = document.createElement('small'); hint.textContent = `${totals.missing} diária${totals.missing === 1 ? '' : 's'} sem valor`; value.append(hint); }
      row.append(value);
      const status = document.createElement('td'); const state = financeGroupStatus(days, totals);
      const badge = document.createElement('span'); badge.className = `finance-badge ${state.style}`; badge.textContent = state.label;
      status.append(badge); row.append(status);
      const actions = document.createElement('td'); actions.className = 'finance-actions';
      const view = document.createElement('button'); view.type = 'button'; view.className = 'text-button'; view.textContent = 'Ver diárias';
      view.setAttribute('aria-label', `Ver ${days.length} diárias de ${days[0].contraparte}`);
      view.addEventListener('click', () => openFinanceGroup(item.diarista_id));
      actions.append(view); row.append(actions); body.append(row);
      return;
    }
    const row = document.createElement('tr');
    const description = document.createElement('td');
    const title = document.createElement('strong'); title.textContent = item.descricao;
    const category = document.createElement('small'); category.textContent = item.origem === 'diaria' ? 'Diária · Pagamento de diarista' : item.categoria;
    description.append(title, category); row.append(description);
    row.append(cell(item.contraparte));
    const reference = item.origem === 'cobranca' ? `Vence em ${dateLabel(item.vencimento)}` : item.data_pagamento ? `Pago em ${dateLabel(item.data_pagamento)}` : item.vencimento ? `Vence em ${dateLabel(item.vencimento)}` : `Diária de ${dateLabel(item.referencia)}`;
    row.append(cell(reference));
    const typeCell = document.createElement('td');
    const typeBadge = document.createElement('span'); typeBadge.className = `finance-type ${item.tipo}`;
    typeBadge.textContent = item.tipo === 'receita' ? 'Entrada' : 'Saída'; typeCell.append(typeBadge); row.append(typeCell);
    row.append(cell(moneyLabel(item.valor_centavos), 'finance-value-cell'));
    const statusCell = document.createElement('td');
    const state = financeStatus(item);
    const badge = document.createElement('span'); badge.className = `finance-badge ${state.style}`; badge.textContent = state.label;
    statusCell.append(badge); row.append(statusCell);
    const actions = document.createElement('td'); actions.className = 'finance-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button';
    edit.textContent = item.origem === 'cobranca' ? 'Ver cobrança' : item.origem === 'diaria' && item.valor_centavos == null ? 'Completar' : 'Editar';
    edit.setAttribute('aria-label', `${edit.textContent} ${item.descricao}`);
    edit.disabled = item.origem === 'diaria' && Boolean(item.pagamento_lote_id);
    edit.addEventListener('click', () => item.origem === 'cobranca' ? window.openInvoiceDetail(item.id)
      : item.origem === 'diaria' ? startPayment(item, 'finance') : openFinanceForm(item));
    actions.append(edit);
    if (item.origem === 'manual') {
      if (!item.data_pagamento) {
        const settle = document.createElement('button'); settle.type = 'button'; settle.className = 'text-button';
        settle.textContent = item.tipo === 'receita' ? 'Receber' : 'Pagar';
        settle.setAttribute('aria-label', `${settle.textContent} ${item.descricao}`);
        settle.addEventListener('click', () => openFinanceForm(item, true));
        actions.append(settle);
      }
      if (!item.data_pagamento) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button finance-remove';
        remove.textContent = 'Excluir'; remove.setAttribute('aria-label', `Excluir ${item.descricao}`);
        remove.addEventListener('click', () => deleteFinanceEntry(item));
        actions.append(remove);
      }
    }
    row.append(actions); body.append(row);
  });
  if ($('#finance-group-dialog').open) renderFinanceGroup();
}

async function loadFinance() {
  const sequence = ++financeLoadSequence;
  try {
    const [records, orders, tariffs, allScales, extras] = await Promise.all([
      request('/api/financeiro'), request('/api/pedidos'), request('/api/tarifas'), request('/api/escalas'), request('/api/custos-extras'),
    ]);
    const scales = allScales.reduce((groups, scale) => ((groups[scale.pedido_id] ||= []).push(scale), groups), {});
    if (sequence !== financeLoadSequence) return;
    financeRecords = records;
    financeForecastInput = { orders, tariffs: { ...tariffs, extras }, scales };
    renderFinance();
    if (typeof window.renderWorkflow === 'function') await window.renderWorkflow(financeRecords, orders, scales);
  }
  catch (err) { if (sequence === financeLoadSequence) showFinanceFeedback(`Não foi possível carregar o financeiro: ${err.message}`, true); }
}

function updateFinanceType() {
  const income = $('#finance-type').value === 'receita';
  $('#finance-counterparty-label').firstChild.textContent = income ? 'Cliente ' : 'Fornecedor ou favorecido ';
  $('#finance-counterparty').placeholder = income ? 'Nome do cliente' : 'Nome de quem recebe';
  if (!$('#finance-category').value) $('#finance-category').placeholder = income ? 'Ex.: Serviços' : 'Ex.: Transporte';
}

function openFinanceForm(item = null, markPaid = false) {
  financeEditingId = item?.id ?? null;
  $('#finance-form').reset();
  $('#finance-form-error').hidden = true;
  $('#finance-form-title').textContent = item ? 'Editar lançamento' : 'Novo lançamento';
  $('#finance-save-button').textContent = item ? 'Salvar alterações' : 'Salvar lançamento';
  if (item) {
    $('#finance-type').value = item.tipo;
    $('#finance-value').value = moneyInput(item.valor_centavos);
    $('#finance-description').value = item.descricao;
    $('#finance-counterparty').value = item.contraparte;
    $('#finance-category').value = item.categoria;
    $('#finance-due').value = item.vencimento;
    $('#finance-paid').value = item.data_pagamento || (markPaid ? financeToday() : '');
    $('#finance-method').value = item.forma_pagamento || '';
    $('#finance-notes').value = item.observacoes || '';
    $('#finance-reason').value = '';
  } else {
    $('#finance-due').value = financeToday();
  }
  updateFinanceType();
  $('#finance-reason-wrap').hidden = !item?.data_pagamento;
  $('#finance-reason').required = Boolean(item?.data_pagamento);
  $('#finance-dialog').showModal();
  (markPaid ? $('#finance-paid') : $('#finance-value')).focus();
}

function financeFormData() {
  return {
    tipo: $('#finance-type').value,
    descricao: $('#finance-description').value,
    categoria: $('#finance-category').value,
    contraparte: $('#finance-counterparty').value,
    valor: $('#finance-value').value,
    vencimento: $('#finance-due').value,
    data_pagamento: $('#finance-paid').value || null,
    forma_pagamento: $('#finance-method').value,
    observacoes: $('#finance-notes').value,
    motivo_ajuste: $('#finance-reason').value.trim(),
  };
}

async function saveFinanceEntry(event) {
  event.preventDefault();
  const data = financeFormData();
  if (!data.descricao.trim() || !data.categoria.trim() || !data.contraparte.trim() || !data.valor || !data.vencimento) {
    $('#finance-form-error').textContent = 'Preencha descrição, cliente ou favorecido, categoria, valor e vencimento.';
    $('#finance-form-error').hidden = false;
    return;
  }
  if ($('#finance-reason').required && data.motivo_ajuste.length < 8) {
    $('#finance-form-error').textContent = 'Explique a correção deste lançamento já liquidado com pelo menos 8 caracteres.';
    $('#finance-form-error').hidden = false;
    return;
  }
  const button = $('#finance-save-button'); button.disabled = true;
  try {
    await request(financeEditingId ? `/api/financeiro/${financeEditingId}` : '/api/financeiro', {
      method: financeEditingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const edited = Boolean(financeEditingId);
    $('#finance-dialog').close();
    await loadFinance();
    showFinanceFeedback(edited ? 'Lançamento atualizado.' : 'Lançamento registrado.');
  } catch (err) { $('#finance-form-error').textContent = err.message; $('#finance-form-error').hidden = false; }
  finally { button.disabled = false; }
}

async function deleteFinanceEntry(item) {
  if (!window.confirm(`Excluir o lançamento “${item.descricao}”? Esta ação não pode ser desfeita.`)) return;
  try { await request(`/api/financeiro/${item.id}`, { method: 'DELETE' }); await loadFinance(); showFinanceFeedback('Lançamento excluído.'); }
  catch (err) { showFinanceFeedback(err.message, true); }
}

function exportFinanceCsv() {
  const headers = ['Tipo', 'Origem', 'Descrição', 'Cliente ou favorecido', 'Categoria', 'Data de referência', 'Vencimento', 'Data de pagamento', 'Valor (R$)', 'Situação', 'Forma de pagamento', 'Observações'];
  const rows = visibleFinanceRows.map(item => [
    item.tipo === 'receita' ? 'Entrada' : 'Saída', item.origem === 'diaria' ? 'Diária' : item.origem === 'cobranca' ? 'Cobrança' : 'Manual', item.descricao,
    item.contraparte, item.categoria, item.referencia, item.vencimento || '', item.data_pagamento || '',
    item.valor_centavos == null ? '' : (item.valor_centavos / 100).toFixed(2).replace('.', ','),
    financeStatus(item).label, item.forma_pagamento || '', item.observacoes || '',
  ]);
  const escape = value => {
    let text = String(value ?? '');
    if (/^[\s\u200b]*[=+@\-]/u.test(text)) text = `\t${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = '\ufeff' + [headers, ...rows].map(row => row.map(escape).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `financeiro-direct-${$('#finance-all-months').checked ? 'todos' : $('#finance-month').value}.csv`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openFinanceAudit() {
  const dialog = $('#finance-audit-dialog');
  const list = $('#finance-audit-list');
  list.textContent = 'Carregando alterações...';
  dialog.showModal();
  try {
    const rows = await request('/api/auditoria');
    list.replaceChildren();
    if (!rows.length) { list.textContent = 'Nenhuma alteração registrada após a ativação da auditoria.'; return; }
    rows.forEach(item => {
      const details = document.createElement('details'); details.className = 'finance-audit-item';
      const summary = document.createElement('summary');
      const action = { INSERT: 'Cadastro', UPDATE: 'Alteração', DELETE: 'Exclusão' }[item.operacao] || item.operacao;
      const entity = { diarias: 'Diária', financeiro_lancamentos: 'Lançamento', pedido_escalas: 'Escala', pedidos: 'Pedido', diaristas: 'Diarista', cobrancas: 'Cobrança', cobranca_itens: 'Item cobrado', cobranca_recebimentos: 'Recebimento', pagamento_lotes: 'Fechamento', tarifas_redes: 'Tarifa da rede', tarifas_setores: 'Tarifa do setor' }[item.tabela] || item.tabela;
      summary.textContent = `${action} · ${entity} #${item.registro_id} · ${new Date(item.alterado_em).toLocaleString('pt-BR')}`;
      const actor = document.createElement('small'); actor.textContent = `Responsável: ${item.email_autor || 'Processo administrativo'}`;
      const data = document.createElement('pre'); data.textContent = JSON.stringify({ antes: item.antes, depois: item.depois }, null, 2);
      details.append(summary, actor, data); list.append(details);
    });
  } catch (error) { list.textContent = `Não foi possível carregar o histórico: ${error.message}`; }
}

function showPage() {
  let page = ['inicio', 'diaristas', 'financeiro', 'pedidos', 'leitura', 'redes', 'configuracoes'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'inicio';
  const role = window.directRemote?.role;
  if (role && ({ financeiro: ['admin', 'financeiro'], configuracoes: ['admin', 'financeiro'], leitura: ['admin', 'operacao'], diaristas: ['admin', 'financeiro', 'operacao'] }[page] || ['admin', 'financeiro', 'operacao', 'consulta']).includes(role) === false) {
    page = 'inicio';
    if (location.hash !== '#inicio') location.hash = '#inicio';
  }
  for (const name of ['inicio', 'diaristas', 'pedidos', 'leitura', 'redes', 'financeiro', 'configuracoes']) {
    const active = name === page;
    $(`#${name}-page`).hidden = !active;
    const link = $(`#nav-${name}`);
    link.classList.toggle('nav-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${{ inicio: 'Início', diaristas: 'Diaristas', pedidos: 'Pedidos', leitura: 'Leitura IA', redes: 'Redes e lojas', financeiro: 'Financeiro', configuracoes: 'Configurações' }[page]} | Direct Promoções`;
  window.scrollTo(0, 0);
  if (page === 'inicio') loadHome();
  if (page === 'financeiro') loadFinance();
  if (page === 'pedidos' && typeof loadOrders === 'function') loadOrders();
  if (page === 'redes' && typeof loadStores === 'function') loadStores();
  if (page === 'configuracoes' && typeof loadSettings === 'function') loadSettings().catch(() => {});
}

$('#finance-month').value = financeToday().slice(0, 7);
$('#new-finance-button').addEventListener('click', () => openFinanceForm());
$('#finance-close-button').addEventListener('click', () => $('#finance-dialog').close());
$('#finance-cancel-button').addEventListener('click', () => $('#finance-dialog').close());
$('#finance-form').addEventListener('submit', saveFinanceEntry);
$('#finance-dialog').addEventListener('click', event => {
  const dialog = $('#finance-dialog');
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
$('#finance-type').addEventListener('change', updateFinanceType);
$('#finance-month').addEventListener('change', renderFinance);
$('#finance-all-months').addEventListener('change', renderFinance);
$('#forecast-period').addEventListener('change', renderFinanceForecast);
window.addEventListener('focus', () => { if (!$('#financeiro-page').hidden) loadFinance(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#financeiro-page').hidden) loadFinance(); });
$('#finance-search').addEventListener('input', renderFinance);
$('#finance-type-filter').addEventListener('change', renderFinance);
$('#finance-status-filter').addEventListener('change', renderFinance);
$('#finance-clear-filters').addEventListener('click', () => {
  $('#finance-month').value = financeToday().slice(0, 7);
  $('#finance-all-months').checked = false;
  $('#finance-search').value = '';
  $('#finance-type-filter').value = 'todos';
  $('#finance-status-filter').value = 'todos';
  renderFinance();
});
$('#finance-export-button').addEventListener('click', exportFinanceCsv);
$('#finance-audit-button').addEventListener('click', openFinanceAudit);
$('#finance-audit-close').addEventListener('click', () => $('#finance-audit-dialog').close());
$('#finance-audit-close-bottom').addEventListener('click', () => $('#finance-audit-dialog').close());
$('#finance-group-close').addEventListener('click', () => $('#finance-group-dialog').close());
$('#finance-group-close-bottom').addEventListener('click', () => $('#finance-group-dialog').close());
$('#finance-group-dialog').addEventListener('click', event => {
  const dialog = $('#finance-group-dialog');
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
window.addEventListener('hashchange', showPage);
showPage();
