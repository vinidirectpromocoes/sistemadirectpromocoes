let orderRecords = [];
let orderEditingId = null;
let orderDetailId = null;
let orderScales = [];
let orderWorkers = [];
let orderDetailBusy = false;
let weeklyScales = {};
let weeklyPage = 0;
const weeklyPageSize = 7;

function renderWeekly() {
  const target = $('#weekly-days'); target.replaceChildren();
  let demand = 0, filled = 0, present = 0, absent = 0, awaiting = 0;
  for (const order of orderRecords) {
    if (order.situacao === 'cancelado') continue;
    demand += order.total_diarias;
    const scales = weeklyScales[order.id] || [];
    filled += scales.filter(scale => scale.status !== 'falta').length;
    present += scales.filter(scale => scale.status === 'presente').length;
    absent += scales.filter(scale => scale.status === 'falta').length;
    awaiting += scales.filter(scale => scale.status === 'escalada' && scale.data <= orderToday()).length;
  }
  $('#orders-fill-rate').textContent = `${demand ? Math.round(filled / demand * 100) : 0}%`;
  $('#orders-absence-rate').textContent = `${present + absent ? Math.round(absent / (present + absent) * 100) : 0}%`;
  $('#orders-awaiting-attendance').textContent = String(awaiting);
  const firstDate = $('#weekly-date').value || orderToday();
  const shiftsByDate = new Map();
  for (const order of orderRecords) {
    if (order.situacao === 'cancelado') continue;
    for (const shift of order.turnos || []) {
      if (shift.data < firstDate) continue;
      const shifts = shiftsByDate.get(shift.data) || [];
      shifts.push({ order, shift });
      shiftsByDate.set(shift.data, shifts);
    }
  }
  const dates = [...shiftsByDate.keys()].sort();
  const pageCount = Math.ceil(dates.length / weeklyPageSize);
  weeklyPage = Math.min(weeklyPage, Math.max(0, pageCount - 1));
  const visibleDates = dates.slice(weeklyPage * weeklyPageSize, (weeklyPage + 1) * weeklyPageSize);
  const pagination = $('#weekly-pagination');
  pagination.hidden = pageCount <= 1;
  $('#weekly-page-label').textContent = `Página ${weeklyPage + 1} de ${pageCount}`;
  $('#weekly-prev').disabled = weeklyPage === 0;
  $('#weekly-next').disabled = weeklyPage >= pageCount - 1;
  if (!visibleDates.length) {
    const empty = document.createElement('p'); empty.className = 'weekly-empty';
    empty.textContent = 'Nenhuma diária a partir desta data.';
    target.append(empty);
  }
  for (const key of visibleDates) {
    const card = document.createElement('article'); card.className = 'weekly-day';
    const heading = document.createElement('h3'); heading.textContent = dateLabel(key); card.append(heading);
    const shifts = shiftsByDate.get(key).sort((a, b) => a.shift.inicio.localeCompare(b.shift.inicio) || a.order.supermercado.localeCompare(b.order.supermercado, 'pt-BR'));
    for (const { order, shift } of shifts) {
      const active = (weeklyScales[order.id] || []).filter(scale => scale.data === key && scale.status !== 'falta');
      const button = document.createElement('button'); button.type = 'button';
      button.className = `weekly-shift${active.length < order.quantidade_diaristas ? ' is-open' : ''}`;
      const title = document.createElement('strong'); title.textContent = `${order.supermercado} · ${order.unidade || 'Loja não informada'}`;
      const subtitle = document.createElement('span'); subtitle.textContent = `${shift.inicio}–${shift.fim} · ${order.setor}`;
      const people = document.createElement('span'); people.textContent = `${active.length}/${order.quantidade_diaristas} · ${active.map(scale => scale.diarista_nome).join(', ') || 'Vaga aberta'}`;
      button.append(title, subtitle, people); button.addEventListener('click', () => openOrderDetail(order.id)); card.append(button);
    }
    target.append(card);
  }
}

const orderStatusLabels = {
  novo: 'Novo', em_selecao: 'Em seleção', confirmado: 'Confirmado',
  concluido: 'Concluído', cancelado: 'Cancelado',
};
const orderPlural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const orderWeekdays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function workerAvailableForShift(worker, shift) {
  const weekday = orderWeekdays[new Date(`${shift.data}T12:00:00`).getDay()];
  return Array.isArray(worker.disponibilidade) && worker.disponibilidade.some(slot =>
    slot.dia === weekday && slot.inicio <= shift.inicio && slot.fim >= shift.fim
  );
}

function orderToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function showOrderFeedback(message, isError = false) {
  const box = $('#orders-feedback');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = false;
  window.clearTimeout(showOrderFeedback.timer);
  showOrderFeedback.timer = window.setTimeout(() => { box.hidden = true; }, 5000);
}

function renderOrders() {
  const open = orderRecords.filter(item => item.situacao === 'novo' || item.situacao === 'em_selecao');
  $('#orders-open-count').textContent = open.length;
  $('#orders-demand-count').textContent = open.reduce((sum, item) => sum + item.total_diarias, 0);
  $('#orders-confirmed-count').textContent = orderRecords.filter(item => item.situacao === 'confirmado').length;
  $('#orders-done-count').textContent = orderRecords.filter(item => item.situacao === 'concluido').length;

  const query = $('#orders-search').value.trim().toLocaleLowerCase('pt-BR');
  const status = $('#orders-status-filter').value;
  const filtered = orderRecords.filter(item => {
    if (status !== 'todos' && item.situacao !== status) return false;
    return !query || `${item.supermercado} ${item.unidade} ${item.setor} ${item.contato}`.toLocaleLowerCase('pt-BR').includes(query);
  }).sort((a, b) => {
    const closedA = ['concluido', 'cancelado'].includes(a.situacao);
    const closedB = ['concluido', 'cancelado'].includes(b.situacao);
    if (closedA !== closedB) return closedA ? 1 : -1;
    return a.turnos[0].data.localeCompare(b.turnos[0].data) || b.id - a.id;
  });
  $('#orders-empty').hidden = orderRecords.length !== 0;
  $('#orders-no-results').hidden = orderRecords.length === 0 || filtered.length !== 0;
  $('#orders-table-wrap').hidden = filtered.length === 0;
  const body = $('#orders-rows'); body.replaceChildren();
  filtered.forEach(item => {
    const row = document.createElement('tr');
    const market = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = item.supermercado;
    const unit = document.createElement('small'); unit.textContent = item.unidade || 'Unidade não informada';
    market.append(name, unit); row.append(market, cell(item.setor));
    const dates = document.createElement('td');
    const first = item.turnos[0];
    const dateTitle = document.createElement('strong');
    dateTitle.textContent = item.quantidade_dias === 1 ? dateLabel(first.data) : `${dateLabel(first.data)} + ${item.quantidade_dias - 1} ${item.quantidade_dias === 2 ? 'data' : 'datas'}`;
    const hours = document.createElement('small');
    const sameHours = item.turnos.every(shift => shift.inicio === first.inicio && shift.fim === first.fim);
    hours.textContent = sameHours ? `${first.inicio} às ${first.fim}` : 'Horários variáveis · veja a ficha';
    dates.append(dateTitle, hours); row.append(dates);
    const demand = document.createElement('td');
    const perDay = document.createElement('strong'); perDay.textContent = orderPlural(item.quantidade_diaristas, 'diarista/dia', 'diaristas/dia');
    const total = document.createElement('small'); total.textContent = `${orderPlural(item.quantidade_dias, 'dia', 'dias')} · ${orderPlural(item.total_diarias, 'diária', 'diárias')}`;
    demand.append(perDay, total); row.append(demand);
    const state = document.createElement('td');
    const badge = document.createElement('span'); badge.className = `order-status ${item.situacao}`;
    badge.textContent = orderStatusLabels[item.situacao]; state.append(badge); row.append(state);
    const action = document.createElement('td'); action.className = 'actions';
    const view = document.createElement('button'); view.type = 'button'; view.className = 'order-view-button';
    view.textContent = '◉'; view.setAttribute('aria-label', `Ver pedido de ${item.supermercado}`);
    view.title = 'Ver pedido'; view.addEventListener('click', () => openOrderDetail(item.id));
    action.append(view); row.append(action); body.append(row);
  });
}

async function loadOrders() {
  try {
    orderRecords = await request('/api/pedidos');
    renderOrders();
    await Promise.all(orderRecords.filter(order => order.situacao !== 'cancelado').map(async order => {
      weeklyScales[order.id] = await request(`/api/pedidos/${order.id}/escalas`);
    }));
    renderWeekly();
  }
  catch (err) { showOrderFeedback(`Não foi possível carregar os pedidos: ${err.message}`, true); }
}

function orderDateAfter(value) {
  if (!value) return financeToday();
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function updateOrderPreview() {
  const days = $('#order-shifts').children.length;
  const quantity = Number($('#order-quantity').value) || 0;
  $('#order-demand-preview').textContent = `${orderPlural(days, 'dia', 'dias')} · ${orderPlural(days * quantity, 'diária solicitada', 'diárias solicitadas')}`;
  $('#order-add-day').disabled = days >= 90;
}

function addOrderShift(shift = null) {
  const container = $('#order-shifts');
  const previous = container.lastElementChild;
  const row = document.createElement('div'); row.className = 'order-shift-row';
  const dateField = document.createElement('label'); dateField.textContent = 'Data';
  const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.className = 'order-shift-date'; dateInput.required = true;
  dateInput.value = shift?.data || (previous ? orderDateAfter(previous.querySelector('.order-shift-date').value) : financeToday());
  dateField.append(dateInput);
  const startField = document.createElement('label'); startField.textContent = 'Início';
  const startInput = document.createElement('input'); startInput.type = 'time'; startInput.className = 'order-shift-start'; startInput.required = true;
  startInput.value = shift?.inicio || previous?.querySelector('.order-shift-start').value || '08:00'; startField.append(startInput);
  const endField = document.createElement('label'); endField.textContent = 'Fim';
  const endInput = document.createElement('input'); endInput.type = 'time'; endInput.className = 'order-shift-end'; endInput.required = true;
  endInput.value = shift?.fim || previous?.querySelector('.order-shift-end').value || '17:00'; endField.append(endInput);
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button order-shift-remove';
  remove.textContent = '×'; remove.setAttribute('aria-label', 'Remover esta data'); remove.title = 'Remover data';
  remove.addEventListener('click', () => { if (container.children.length > 1) { row.remove(); updateOrderPreview(); } });
  row.append(dateField, startField, endField, remove); container.append(row);
  updateOrderPreview();
  return dateInput;
}

function openOrderForm(item = null) {
  if ($('#order-detail-dialog').open) $('#order-detail-dialog').close();
  orderEditingId = item?.id ?? null;
  $('#order-form').reset();
  $('#order-form-error').hidden = true;
  $('#order-form-title').textContent = item ? 'Editar pedido' : 'Novo pedido';
  $('#order-save-button').textContent = item ? 'Salvar alterações' : 'Salvar pedido';
  $('#order-market').value = item?.supermercado || '';
  $('#order-unit').value = item?.unidade || '';
  $('#order-contact').value = item?.contato || '';
  $('#order-sector').value = item?.setor || '';
  $('#order-quantity').value = item?.quantidade_diaristas || 1;
  $('#order-status').value = item?.situacao || 'novo';
  $('#order-notes').value = item?.observacoes || '';
  $('#order-shifts').replaceChildren();
  (item?.turnos || [null]).forEach(addOrderShift);
  updateOrderPreview();
  $('#order-dialog').showModal();
  $('#order-market').focus();
}

function orderFormData() {
  return {
    supermercado: $('#order-market').value.trim(), unidade: $('#order-unit').value.trim(),
    contato: $('#order-contact').value.trim(), setor: $('#order-sector').value.trim(),
    quantidade_diaristas: Number($('#order-quantity').value), situacao: $('#order-status').value,
    observacoes: $('#order-notes').value.trim(),
    turnos: [...$('#order-shifts').children].map(row => ({
      data: row.querySelector('.order-shift-date').value,
      inicio: row.querySelector('.order-shift-start').value,
      fim: row.querySelector('.order-shift-end').value,
    })),
  };
}

function showOrderFormError(message) {
  const box = $('#order-form-error'); box.textContent = message; box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

async function saveOrder(event) {
  event.preventDefault();
  const data = orderFormData();
  if (!data.supermercado || !data.setor || !Number.isInteger(data.quantidade_diaristas) || data.quantidade_diaristas < 1 || data.quantidade_diaristas > 100) {
    return showOrderFormError('Preencha supermercado, setor e quantidade de diaristas entre 1 e 100.');
  }
  const dates = data.turnos.map(shift => shift.data);
  if (data.turnos.some(shift => !shift.data || !shift.inicio || !shift.fim || shift.inicio >= shift.fim) || new Set(dates).size !== dates.length) {
    return showOrderFormError('Confira as datas e horários. Cada data deve aparecer uma vez, com início anterior ao fim.');
  }
  const save = $('#order-save-button'); save.disabled = true;
  try {
    await request(orderEditingId ? `/api/pedidos/${orderEditingId}` : '/api/pedidos', {
      method: orderEditingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const edited = Boolean(orderEditingId);
    $('#order-dialog').close();
    await loadOrders();
    showOrderFeedback(edited ? 'Pedido atualizado.' : 'Pedido registrado.');
  } catch (err) { showOrderFormError(err.message); }
  finally { save.disabled = false; }
}

function orderDetailError(message) {
  const box = $('#order-detail-error');
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

async function refreshOrderScales() {
  if (!orderDetailId) return;
  orderScales = await request(`/api/pedidos/${orderDetailId}/escalas`);
  weeklyScales[orderDetailId] = orderScales;
  renderOrderShifts();
  renderWeekly();
}

async function addOrderWorker(data, select) {
  if (!select.value || orderDetailBusy) return;
  orderDetailBusy = true;
  $('#order-detail-error').hidden = true;
  try {
    await request(`/api/pedidos/${orderDetailId}/escalas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, diarista_id: Number(select.value) }),
    });
    await refreshOrderScales();
  } catch (err) { orderDetailError(err.message); }
  finally { orderDetailBusy = false; }
}

async function changeOrderAttendance(scale, status) {
  if (orderDetailBusy || scale.status === status) return;
  if (['presente', 'falta'].includes(status) && scale.data > orderToday()) return orderDetailError('Presença ou falta só pode ser registrada a partir da data da diária.');
  if (scale.status === 'presente' && status === 'falta' && scale.diaria?.data_pagamento) {
    return orderDetailError('Essa diária já foi paga. Abra Pagamento, retire a data do pagamento e depois corrija para falta.');
  }
  if (scale.status === 'presente' && status === 'falta' && !window.confirm(`Corrigir a presença de ${scale.diarista_nome} para falta? A diária pendente será retirada do Financeiro.`)) return;
  orderDetailBusy = true;
  $('#order-detail-error').hidden = true;
  try {
    await request(`/api/pedidos/${orderDetailId}/escalas/${scale.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    await refreshOrderScales();
    if (!window.directRemote || ['admin', 'financeiro'].includes(window.directRemote.role)) {
      if (status === 'presente') $('#finance-month').value = scale.data.slice(0, 7);
      await loadFinance();
    }
    if (typeof loadHome === 'function') await loadHome();
  } catch (err) { orderDetailError(err.message); }
  finally { orderDetailBusy = false; }
}

async function removeOrderWorker(scale) {
  if (orderDetailBusy) return;
  orderDetailBusy = true;
  $('#order-detail-error').hidden = true;
  try {
    await request(`/api/pedidos/${orderDetailId}/escalas/${scale.id}`, { method: 'DELETE' });
    await refreshOrderScales();
  } catch (err) { orderDetailError(err.message); }
  finally { orderDetailBusy = false; }
}

function renderOrderShifts() {
  const item = orderRecords.find(row => row.id === orderDetailId);
  if (!item) return;
  const canOperate = !window.directRemote || ['admin', 'operacao'].includes(window.directRemote.role);
  const list = $('#order-detail-shifts'); list.replaceChildren();
  item.turnos.forEach(shift => {
    const scales = orderScales.filter(scale => scale.data === shift.data);
    const active = scales.filter(scale => scale.status !== 'falta').length;
    const card = document.createElement('div'); card.className = 'order-day-card';
    const header = document.createElement('div'); header.className = 'order-detail-shift';
    const date = document.createElement('strong'); date.textContent = dateLabel(shift.data);
    const time = document.createElement('span'); time.textContent = `${shift.inicio} às ${shift.fim}`;
    const quantity = document.createElement('small'); quantity.textContent = `${active}/${item.quantidade_diaristas} escalada${item.quantidade_diaristas === 1 ? '' : 's'}`;
    header.append(date, time, quantity); card.append(header);
    const body = document.createElement('div'); body.className = 'order-day-body';
    if (!scales.length) {
      const empty = document.createElement('p'); empty.className = 'order-day-empty'; empty.textContent = 'Nenhuma diarista escalada para este dia.'; body.append(empty);
    }
    scales.forEach(scale => {
      const row = document.createElement('div'); row.className = 'order-worker-row';
      const identity = document.createElement('div'); identity.className = 'order-worker-identity';
      const name = document.createElement('strong'); name.textContent = scale.diarista_nome;
      const state = document.createElement('span'); state.className = `order-attendance-status ${scale.status}`;
      state.textContent = { escalada: 'Aguardando', presente: 'Presença', falta: 'Falta' }[scale.status];
      identity.append(name, state); row.append(identity);
      const actions = document.createElement('div'); actions.className = 'order-worker-actions';
      for (const [status, label] of canOperate ? [['presente', 'Presença'], ['falta', 'Falta']] : []) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `order-attendance-button ${status}${scale.status === status ? ' selected' : ''}`;
        button.textContent = label; button.disabled = scale.status === status || shift.data > orderToday();
        if (shift.data > orderToday()) button.title = 'Registro disponível a partir da data da diária.';
        button.setAttribute('aria-label', `${label} de ${scale.diarista_nome} em ${dateLabel(shift.data)}`);
        button.addEventListener('click', () => changeOrderAttendance(scale, status)); actions.append(button);
      }
      if (canOperate && scale.status === 'escalada') {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Retirar';
        remove.setAttribute('aria-label', `Retirar ${scale.diarista_nome} da escala`);
        remove.addEventListener('click', () => removeOrderWorker(scale)); actions.append(remove);
      }
      row.append(actions);
      if (scale.status === 'presente' && (!window.directRemote || ['admin', 'financeiro'].includes(window.directRemote.role))) {
        const payment = document.createElement('div'); payment.className = 'order-payment-line';
        const label = document.createElement('span');
        label.textContent = scale.diaria?.data_pagamento ? `Pago em ${dateLabel(scale.diaria.data_pagamento)}` : scale.diaria?.valor_centavos != null ? 'Pagamento pendente' : 'Pagamento pendente · valor não informado';
        payment.append(label);
        if (scale.diaria) {
          const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Pagamento';
          edit.addEventListener('click', () => {
            $('#order-detail-dialog').close();
            startPayment({ ...scale.diaria, diarista_id: scale.diarista_id, data: scale.data, setor: item.setor, local: `${item.supermercado}${item.unidade ? ` · ${item.unidade}` : ''}` }, 'order');
          });
          payment.append(edit);
        }
        row.append(payment);
      }
      body.append(row);
    });
    if (canOperate && active < item.quantidade_diaristas) {
      const picker = document.createElement('div'); picker.className = 'order-worker-picker';
      const select = document.createElement('select'); select.setAttribute('aria-label', `Escolher diarista para ${dateLabel(shift.data)}`);
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecione uma diarista'; select.append(placeholder);
      const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const candidates = orderWorkers.filter(worker => !worker.bloqueada && workerAvailableForShift(worker, shift) && !scales.some(scale => scale.diarista_id === worker.id));
      candidates.sort((a, b) => {
        const matches = worker => (worker.setores || []).some(sector => normalize(sector).includes(normalize(item.setor)) || normalize(item.setor).includes(normalize(sector)));
        return Number(matches(b)) - Number(matches(a)) || a.nome.localeCompare(b.nome, 'pt-BR');
      });
      candidates.forEach(worker => {
        const option = document.createElement('option'); option.value = String(worker.id);
        const match = (worker.setores || []).some(sector => normalize(sector).includes(normalize(item.setor)) || normalize(item.setor).includes(normalize(sector)));
        option.textContent = `${match ? '★ ' : ''}${worker.nome}${match ? ' · experiência no setor' : ''}`; select.append(option);
      });
      const add = document.createElement('button'); add.type = 'button'; add.className = 'button button-outline'; add.textContent = 'Escalar';
      add.addEventListener('click', () => addOrderWorker(shift.data, select));
      picker.append(select, add); body.append(picker);
    }
    card.append(body); list.append(card);
  });
}

async function openOrderDetail(id) {
  const item = orderRecords.find(row => row.id === id);
  if (!item) return showOrderFeedback('Pedido não encontrado.', true);
  orderDetailId = id;
  $('#order-detail-error').hidden = true;
  $('#order-detail-title').textContent = item.supermercado;
  $('#order-detail-fields').replaceChildren(
    detailSection('Solicitação', [
      ['Supermercado', item.supermercado], ['Unidade ou local', item.unidade || '—'],
      ['Contato', item.contato || '—'], ['Setor', item.setor],
    ]),
    detailSection('Demanda e situação', [
      ['Diaristas por dia', String(item.quantidade_diaristas)],
      ['Quantidade de dias', String(item.quantidade_dias)],
      ['Total de diárias solicitadas', String(item.total_diarias)],
      ['Situação', orderStatusLabels[item.situacao]],
    ]),
    detailSection('Informações adicionais', [
      ['Observações', item.observacoes || '—'],
      ['Pedido registrado em', new Date(item.criado_em).toLocaleString('pt-BR')],
    ]),
  );
  $('#order-detail-shifts').textContent = 'Carregando escalas...';
  $('#order-detail-dialog').showModal();
  try {
    [orderWorkers, orderScales] = await Promise.all([request('/api/diaristas'), request(`/api/pedidos/${id}/escalas`)]);
    if (orderDetailId === id && $('#order-detail-dialog').open) renderOrderShifts();
  } catch (err) { orderDetailError(`Não foi possível carregar as escalas: ${err.message}`); }
}

async function deleteOrder() {
  const item = orderRecords.find(row => row.id === orderDetailId);
  if (!item || !window.confirm(`Excluir o pedido de ${item.supermercado}? Esta ação não pode ser desfeita.`)) return;
  try {
    await request(`/api/pedidos/${item.id}`, { method: 'DELETE' });
    $('#order-detail-dialog').close(); orderDetailId = null;
    await loadOrders(); showOrderFeedback('Pedido excluído.');
  } catch (err) { $('#order-detail-error').textContent = err.message; $('#order-detail-error').hidden = false; }
}

function orderDialogBackdrop(event) {
  const dialog = event.currentTarget;
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
}

$('#new-order-button').addEventListener('click', () => openOrderForm());
$('#orders-empty-new').addEventListener('click', () => openOrderForm());
$('#orders-search').addEventListener('input', renderOrders);
$('#orders-status-filter').addEventListener('change', renderOrders);
$('#weekly-date').value = orderToday();
$('#weekly-date').addEventListener('change', () => { weeklyPage = 0; renderWeekly(); });
$('#weekly-prev').addEventListener('click', () => { if (weeklyPage > 0) { weeklyPage--; renderWeekly(); } });
$('#weekly-next').addEventListener('click', () => { weeklyPage++; renderWeekly(); });
$('#order-close-button').addEventListener('click', () => $('#order-dialog').close());
$('#order-cancel-button').addEventListener('click', () => $('#order-dialog').close());
$('#order-form').addEventListener('submit', saveOrder);
$('#order-add-day').addEventListener('click', () => addOrderShift().focus());
$('#order-quantity').addEventListener('input', updateOrderPreview);
$('#order-detail-close').addEventListener('click', () => $('#order-detail-dialog').close());
$('#order-detail-close-bottom').addEventListener('click', () => $('#order-detail-dialog').close());
$('#order-edit-button').addEventListener('click', () => openOrderForm(orderRecords.find(row => row.id === orderDetailId)));
$('#order-delete-button').addEventListener('click', deleteOrder);
$('#order-dialog').addEventListener('click', orderDialogBackdrop);
$('#order-detail-dialog').addEventListener('click', orderDialogBackdrop);
if (window.location.hash === '#pedidos') loadOrders();
