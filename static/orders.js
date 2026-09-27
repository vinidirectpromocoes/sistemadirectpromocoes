let orderRecords = [];
let orderEditingId = null;
let orderDetailId = null;

const orderStatusLabels = {
  novo: 'Novo', em_selecao: 'Em seleção', confirmado: 'Confirmado',
  concluido: 'Concluído', cancelado: 'Cancelado',
};
const orderPlural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

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
  try { orderRecords = await request('/api/pedidos'); renderOrders(); }
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

function openOrderDetail(id) {
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
  const list = $('#order-detail-shifts'); list.replaceChildren();
  item.turnos.forEach(shift => {
    const row = document.createElement('div'); row.className = 'order-detail-shift';
    const date = document.createElement('strong'); date.textContent = dateLabel(shift.data);
    const time = document.createElement('span'); time.textContent = `${shift.inicio} às ${shift.fim}`;
    const quantity = document.createElement('small'); quantity.textContent = orderPlural(item.quantidade_diaristas, 'diarista', 'diaristas');
    row.append(date, time, quantity); list.append(row);
  });
  $('#order-detail-dialog').showModal();
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
