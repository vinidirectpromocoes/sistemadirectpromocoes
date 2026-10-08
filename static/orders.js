let orderRecords = [];
let orderEditingId = null;
let orderDetailId = null;
let orderScales = [];
let orderWorkers = [];
let orderDetailBusy = false;
let weeklyScales = {};
let orderCatalogStores = [];
let orderCatalogSectors = [];

function orderFilters() {
  return {query:orderNormalize($('#orders-search').value),network:$('#orders-network-filter').value,store:$('#orders-store-filter').value,sector:$('#orders-sector-filter').value,status:$('#orders-status-filter').value,start:$('#orders-start-filter').value,end:$('#orders-end-filter').value};
}
function orderFilteredShifts(order, filters=orderFilters()) {
  if(filters.start && filters.end && filters.start>filters.end) return [];
  return (order.turnos || []).filter(shift=>(!filters.start || shift.data>=filters.start) && (!filters.end || shift.data<=filters.end));
}
function filteredOrderRecords(filters=orderFilters()) {
  return orderRecords.filter(order=>
    (filters.network==='todos' || orderNormalize(order.supermercado)===filters.network) &&
    (filters.store==='todos' || orderNormalize(order.unidade)===filters.store) &&
    (filters.sector==='todos' || orderNormalize(order.setor)===filters.sector) &&
    (filters.status==='todos' || order.situacao===filters.status) &&
    (!filters.query || orderNormalize(`${order.supermercado} ${order.unidade} ${order.setor} ${order.contato || ''} ${order.id}`).includes(filters.query)) &&
    orderFilteredShifts(order,filters).length>0);
}
function updateOrderFilterOptions() {
  const populate=(selector,values,label)=>{
    const select=$(selector),previous=select.value,unique=new Map();
    for(const value of values) if(value && !unique.has(orderNormalize(value))) unique.set(orderNormalize(value),value);
    select.replaceChildren(new Option(label,'todos'),...Array.from(unique).sort((a,b)=>a[1].localeCompare(b[1],'pt-BR')).map(([key,label])=>new Option(label,key)));
    select.value=unique.has(previous)?previous:'todos';
  };
  populate('#orders-network-filter',orderRecords.map(o=>o.supermercado),'Todas as redes');
  const network=$('#orders-network-filter').value;
  const orders=orderRecords.filter(o=>network==='todos' || orderNormalize(o.supermercado)===network);
  populate('#orders-store-filter',orders.map(o=>o.unidade),'Todas as lojas');
  const store=$('#orders-store-filter').value;
  populate('#orders-sector-filter',orders.filter(o=>store==='todos' || orderNormalize(o.unidade)===store).map(o=>o.setor),'Todos os setores');
}
function applyOrderFilters() { updateOrderFilterOptions();renderOrders();renderOrderMetrics(); }

const orderNormalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');

function matchingOrderStore(market, unit) {
  if (!market || !unit) return null;
  return orderCatalogStores.find(store => orderNormalize(store.rede) === orderNormalize(market) && orderNormalize(store.nome) === orderNormalize(unit)) || null;
}

function updateOrderStoreOptions() {
  const market = $('#order-market');
  const unit = $('#order-unit');
  const networks = [...new Set(orderCatalogStores.map(store => store.rede))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('#order-market-options').replaceChildren(...networks.map(name => new Option(name)));
  const chosenNetwork = networks.find(name => orderNormalize(name) === orderNormalize(market.value));
  if (chosenNetwork && market.value !== chosenNetwork) market.value = chosenNetwork;
  const units = orderCatalogStores.filter(store => !chosenNetwork || store.rede === chosenNetwork);
  $('#order-unit-options').replaceChildren(...[...new Set(units.map(store => store.nome))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(name => new Option(name)));
  $('#order-sector-options').replaceChildren(...[...new Set(orderCatalogSectors)].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(name => new Option(name)));
  const store = matchingOrderStore(market.value, unit.value);
  const hint = $('#order-store-hint');
  hint.textContent = store ? `Loja do catálogo: ${[store.endereco, store.bairro, `${store.cidade}/${store.uf}`].filter(Boolean).join(' · ')}` :
    unit.value.trim() ? 'Loja não encontrada nessa rede. Confira o nome em Redes e lojas.' : 'Selecione uma loja do catálogo para conferir o endereço.';
}

async function loadOrderCatalog() {
  const [stores, tariffs] = await Promise.all([request('/api/lojas'), request('/api/tarifas')]);
  orderCatalogStores = stores;
  orderCatalogSectors = (tariffs.setores || []).map(rate => rate.setor);
  updateOrderStoreOptions();
}

function renderOrderMetrics() {
  const filters=orderFilters(),records=filteredOrderRecords(filters);
  let demand = 0, filled = 0, present = 0, absent = 0, awaiting = 0;
  for (const order of records) {
    if (order.situacao === 'cancelado') continue;
    const dates=new Set(orderFilteredShifts(order,filters).map(shift=>shift.data));
    demand += dates.size*order.quantidade_diaristas;
    const scales = (weeklyScales[order.id] || []).filter(scale=>dates.has(scale.data));
    filled += scales.filter(scale => !['falta','desistiu'].includes(scale.status)).length;
    present += scales.filter(scale => scale.status === 'presente').length;
    absent += scales.filter(scale => scale.status === 'falta').length;
    awaiting += scales.filter(scale => scale.status === 'escalada' && scale.data <= orderToday()).length;
  }
  $('#orders-fill-rate').textContent = `${demand ? Math.round(filled / demand * 100) : 0}%`;
  $('#orders-absence-rate').textContent = `${present + absent ? Math.round(absent / (present + absent) * 100) : 0}%`;
  $('#orders-awaiting-attendance').textContent = String(awaiting);

}

const orderStatusLabels = {
  novo: 'Novo', em_selecao: 'Em seleção', confirmado: 'Confirmado',
  concluido: 'Concluído', cancelado: 'Cancelado',
};
const orderPlural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

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

function orderCoverage(order,filters=orderFilters(),now=Date.now()) {
  if(order.situacao==='cancelado')return {color:'neutral',label:'Pedido cancelado'};
  const gaps=orderFilteredShifts(order,filters).filter(t=>(weeklyScales[order.id]||[]).filter(s=>s.data===t.data&&!['falta','desistiu'].includes(s.status)).length<order.quantidade_diaristas);
  if(!gaps.length)return {color:'green',label:'Equipe preenchida em todos os dias exibidos'};
  const running=gaps.some(t=>Date.parse(`${t.data}T${t.inicio}:00-03:00`)<=now&&now<Date.parse(`${t.data}T${t.fim}:00-03:00`));
  return running?{color:'yellow',label:'Diária já iniciou e há vaga sem diarista'}:{color:'red',label:'Pedido não atendido: há vaga sem diarista'};
}

function orderAssignedNames(order, filters=orderFilters()) {
  const dates=new Set(orderFilteredShifts(order,filters).map(shift=>shift.data));
  return [...new Set((weeklyScales[order.id] || []).filter(scale=>dates.has(scale.data) && !['falta','desistiu'].includes(scale.status)).map(scale=>scale.diarista_nome).filter(Boolean))];
}

function renderOrders() {
  updateOrderFilterOptions();
  const filters=orderFilters(),records=filteredOrderRecords(filters);
  const open = records.filter(item => item.situacao === 'novo' || item.situacao === 'em_selecao');
  $('#orders-open-count').textContent = open.length;
  $('#orders-demand-count').textContent = open.reduce((sum,item)=>sum+orderFilteredShifts(item,filters).length*item.quantidade_diaristas,0);
  $('#orders-confirmed-count').textContent = records.filter(item => item.situacao === 'confirmado').length;
  $('#orders-done-count').textContent = records.filter(item => item.situacao === 'concluido').length;
  const active=Object.entries(filters).filter(([key,value])=>value && (!['network','store','sector','status'].includes(key) || value!=='todos')).length;
  $('#orders-filter-toggle').textContent=active?`Filtros (${active})`:'Filtros';
  $('#orders-filter-clear').disabled=!active;
  $('#orders-filter-count').textContent=`${records.length} de ${orderPlural(orderRecords.length,'pedido','pedidos')} · ${orderPlural(records.reduce((sum,o)=>sum+orderFilteredShifts(o,filters).length*o.quantidade_diaristas,0),'diária','diárias')} no período${active?' · filtros aplicados':''}`;
  $('#orders-filter-error').hidden=!(filters.start && filters.end && filters.start>filters.end);
  const filtered = records.sort((a, b) => {
    const closedA = ['concluido', 'cancelado'].includes(a.situacao);
    const closedB = ['concluido', 'cancelado'].includes(b.situacao);
    if (closedA !== closedB) return closedA ? 1 : -1;
    return a.turnos[0].data.localeCompare(b.turnos[0].data) || b.id - a.id;
  });
  $('#orders-empty').hidden = orderRecords.length !== 0;
  $('#orders-no-results').hidden = orderRecords.length === 0 || filtered.length !== 0;
  $('#orders-table-wrap').hidden = filtered.length === 0;
  const body = $('#orders-rows'); body.replaceChildren();
  DirectPager.slice('orders',filtered,$('#orders-table-wrap'),renderOrders).forEach(item => {
    const shifts=orderFilteredShifts(item,filters),days=shifts.length,totalDemand=days*item.quantidade_diaristas;
    const row = document.createElement('tr');
    const market = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = item.supermercado;
    const unit = document.createElement('small'); unit.textContent = item.unidade || 'Unidade não informada';
    market.append(name, unit); row.append(market, cell(item.setor));
    const dates = document.createElement('td');
    const first = shifts[0];
    const dateTitle = document.createElement('strong');
    dateTitle.textContent = days === 1 ? dateLabel(first.data) : `${dateLabel(first.data)} + ${days - 1} ${days === 2 ? 'data' : 'datas'}`;
    const hours = document.createElement('small');
    const sameHours = shifts.every(shift => shift.inicio === first.inicio && shift.fim === first.fim);
    hours.textContent = sameHours ? `${first.inicio} às ${first.fim}` : 'Horários variáveis · veja a ficha';
    dates.append(dateTitle, hours); row.append(dates);
    const demand = document.createElement('td');
    const perDay = document.createElement('strong'); perDay.textContent = orderPlural(item.quantidade_diaristas, 'diarista/dia', 'diaristas/dia');
    const total = document.createElement('small'); total.textContent = `${orderPlural(days, 'dia', 'dias')} · ${orderPlural(totalDemand, 'diária', 'diárias')}${filters.start || filters.end?' no período':''}`;
    demand.append(perDay, total);
    const names=orderAssignedNames(item,filters);
    if(names.length) {
      const assigned=document.createElement('small'); assigned.className='order-assigned-names';
      assigned.textContent=`Escalado${names.length>1?'s':''}: ${names.join(', ')}`;
      demand.append(assigned);
    }
    row.append(demand);
    const state = document.createElement('td');
    const coverage=orderCoverage(item,filters);
    const indicator=document.createElement('span'); indicator.className=`order-neon ${coverage.color}`; indicator.setAttribute('role','img'); indicator.setAttribute('aria-label',coverage.label); indicator.title=coverage.label;
    state.append(indicator);
    const badge = document.createElement('span'); badge.className = `order-status ${item.situacao}`;
    badge.textContent = orderStatusLabels[item.situacao]; state.append(badge); row.append(state);
    const action = document.createElement('td'); action.className = 'actions';
    const view = document.createElement('button'); view.type = 'button'; view.className = 'order-view-button';
    view.textContent = '◉'; view.setAttribute('aria-label', `Ver pedido de ${item.supermercado}`);
    view.title = 'Ver pedido'; view.addEventListener('click', () => openOrderDetail(item.id));
    action.append(view);
    if(!window.directRemote || ['admin','operacao'].includes(window.directRemote.role)) {
      const edit=document.createElement('button');edit.type='button';edit.className='order-view-button order-edit-button';
      edit.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5zM14 5l5 5"/></svg>';
      edit.setAttribute('aria-label',`Editar pedido #${item.id}`);edit.title='Editar pedido';edit.addEventListener('click',()=>openOrderForm(item));action.append(edit);
    }
    row.append(action);row.addEventListener('click',event=>{if(!event.target.closest('button'))openOrderDetail(item.id);}); body.append(row);
  });
}

async function loadOrders() {
  try {
    const [records,allScales] = await Promise.all([request('/api/pedidos'),request('/api/escalas')]);
    orderRecords=records;
    loadOrderCatalog().catch(() => {});
    weeklyScales = Object.groupBy ? Object.groupBy(allScales, scale => scale.pedido_id) :
      allScales.reduce((groups, scale) => ((groups[scale.pedido_id] ||= []).push(scale), groups), {});
    renderOrders();
    renderOrderMetrics();
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
  window.directPendingForm = null;
  if ($('#order-detail-dialog').open) $('#order-detail-dialog').close();
  orderEditingId = item?.id ?? null;
  document.getElementById('order-form').dataset.version = item?.atualizado_em || '';
  window.directStoreRequestId = null;
  window.directDraftId = null;
  $('#order-form').reset();
  $('#order-form-error').hidden = true;
  $('#order-model-feedback').hidden = true;
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
  updateOrderStoreOptions();
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
    ...(window.directStoreRequestId?{solicitacao_loja_id:window.directStoreRequestId}:{}),
    ...(window.directDraftId ? { chave_operacao: window.directDraftId } : {}),
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
      method: orderEditingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, expected_updated_at: $('#order-form').dataset.version || null }),
    });
    const edited = Boolean(orderEditingId);
    await window.DirectOffline?.saved(window.directDraftId); window.directDraftId = null;
    const pendingError = await window.directResolvePendingForm?.('pedido');
    $('#order-dialog').close();
    await loadOrders();
    window.DirectManagementUI?.refresh();
    if (typeof loadHome === 'function') loadHome().catch(() => {});
    showOrderFeedback(pendingError || (edited ? 'Pedido atualizado.' : 'Pedido registrado.'));
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
  const id = orderDetailId;
  const savedScales = await request(`/api/pedidos/${id}/escalas`);
  weeklyScales[id] = savedScales;
  if (orderDetailId !== id) return;
  orderScales = savedScales;
  renderOrderShifts();
  await loadOrders();
  if (typeof loadHome === 'function') loadHome().catch(() => {});
}

async function addOrderWorker(dates, workerId) {
  if (!dates.length || !workerId || orderDetailBusy) return;
  const id = orderDetailId;
  let saved = false;
  orderDetailBusy = true;
  $('#order-detail-error').hidden = true;
  $('#order-detail-success').hidden = true;
  try {
    await request(`/api/pedidos/${id}/escalas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dates.length === 1 ? { data: dates[0], diarista_id: workerId } : { datas: dates, diarista_id: workerId }),
    });
    saved = true;
    if (orderDetailId === id) {
      await refreshOrderScales();
      if (orderDetailId !== id) return;
      const notice = $('#order-detail-success');
      notice.textContent = dates.length === 1 ? 'Diarista escalada neste dia.' : `Diarista escalada em ${dates.length} dias deste pedido.`;
      notice.hidden = false;
      notice.scrollIntoView({ block: 'nearest' });
    }
  } catch (err) {
    if (orderDetailId === id) orderDetailError(saved
      ? `A escala foi salva, mas não foi possível atualizar a tela. Reabra o pedido para conferir. ${err.message}`
      : `Não foi possível confirmar a escala. Reabra o pedido antes de tentar novamente. ${err.message}`);
  }
  finally { orderDetailBusy = false; }
}

function chooseOrderWorker(data, select, picker) {
  if (!select.value || orderDetailBusy) return;
  const item = orderRecords.find(row => row.id === orderDetailId);
  const worker = orderWorkers.find(row => row.id === Number(select.value));
  if (!item || !worker) return;
  document.querySelectorAll('.order-assign-choice').forEach(panel => panel.remove());
  if (item.turnos.length === 1) return addOrderWorker([data], worker.id);
  const assigned = new Set(orderScales.filter(scale => scale.diarista_id === worker.id).map(scale => scale.data));
  let full = 0;
  const dates = item.turnos.filter(shift => {
    if (assigned.has(shift.data)) return false;
    const occupied = orderScales.filter(scale => scale.data === shift.data && !['falta','desistiu'].includes(scale.status)).length;
    if (occupied >= item.quantidade_diaristas) { full++; return false; }
    return true;
  }).map(shift => shift.data);
  const panel = document.createElement('div'); panel.className = 'order-assign-choice';
  const question = document.createElement('strong'); question.textContent = `Escalar ${worker.nome} só em ${dateLabel(data)} ou nos outros dias deste pedido?`;
  panel.append(question);
  const details = document.createElement('p');
  details.textContent = `${dates.length} dia${dates.length === 1 ? '' : 's'} com vaga neste pedido.${full ? ` ${full} já preenchido${full === 1 ? '' : 's'}.` : ''}`;
  panel.append(details);
  const actions = document.createElement('div'); actions.className = 'order-assign-actions';
  const single = document.createElement('button'); single.type = 'button'; single.className = 'button button-quiet'; single.textContent = 'Só este dia';
  single.addEventListener('click', () => addOrderWorker([data], worker.id));
  const all = document.createElement('button'); all.type = 'button'; all.className = 'button button-primary'; all.textContent = `Todos os dias possíveis (${dates.length})`; all.disabled = dates.length < 2;
  all.addEventListener('click', () => addOrderWorker(dates, worker.id));
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button button-quiet'; cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => { select.value = ''; panel.remove(); });
  actions.append(single, all, cancel); panel.append(actions); picker.after(panel);
  panel.scrollIntoView({ block: 'nearest' });
}

async function changeOrderAttendance(scale, status) {
  if (orderDetailBusy || scale.status === status) return;
  if (['presente', 'falta'].includes(status) && scale.data > orderToday()) return orderDetailError(`Esta diária está em ${dateLabel(scale.data)}. Confira o ano e a data do pedido; a presença fica disponível a partir desse dia.`);
  if (scale.status === 'presente' && status === 'falta' && scale.diaria?.data_pagamento) {
    return orderDetailError('Essa diária já foi paga. Abra Pagamento, retire a data do pagamento e depois corrija para falta.');
  }
  if (scale.status === 'presente' && status === 'falta' && !window.confirm(`Corrigir a presença de ${scale.diarista_nome} para falta? A diária pendente será retirada do Financeiro.`)) return;
  let motivo = null;
  if (['falta','desistiu'].includes(status)) {
    motivo = window.prompt(`Motivo ${status==='desistiu'?'da desistência':'da falta'} de ${scale.diarista_nome} em ${dateLabel(scale.data)}:`, '')?.trim();
    if (motivo == null) return;
    if (motivo.length < 5 || motivo.length > 300) return orderDetailError('Informe o motivo da falta com 5 a 300 caracteres.');
  }
  orderDetailBusy = true;
  $('#order-detail-error').hidden = true;
  try {
    await request(`/api/pedidos/${orderDetailId}/escalas/${scale.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, motivo }),
    });
    await refreshOrderScales();
    if (['falta','desistiu'].includes(status)) {
      const notice = $('#order-detail-success');
      notice.textContent = `${status==='desistiu'?'Desistência':'Falta'} registrada. Vaga aberta para substituição; previsão financeira atualizada.`;
      notice.hidden = false;
      const pending=orderScales.find(s=>s.id===scale.id),row=document.querySelector(`[data-scale-id="${scale.id}"]`);if(pending&&row&&!pending.substituida_por_escala_id){orderDetailBusy=false;showOrderSubstitute(pending,row);orderDetailBusy=true;}
    }
    if (!window.directRemote || ['admin', 'financeiro'].includes(window.directRemote.role)) {
      if (status === 'presente') $('#finance-month').value = scale.data.slice(0, 7);
      await loadFinance();
    }
    if (typeof loadHome === 'function') await loadHome();
  } catch (err) { orderDetailError(err.message); }
  finally { orderDetailBusy = false; }
}

function showOrderSubstitute(scale,row) {
  if(orderDetailBusy)return;
  document.querySelectorAll('.order-substitute-panel').forEach(p=>p.remove());
  const panel=document.createElement('div');panel.className='order-substitute-panel';
  const label=document.createElement('label');label.textContent='Pessoa substituta';
  const select=document.createElement('select');select.setAttribute('aria-label',`Pessoa substituta de ${scale.diarista_nome}`);select.append(new Option('Selecione a pessoa',''));
  for(const w of orderWorkers.filter(w=>!w.bloqueada&&w.id!==scale.diarista_id))select.append(new Option(w.nome,String(w.id)));
  label.append(select);panel.append(label);
  const reason=document.createElement('input');reason.type='text';reason.maxLength=300;reason.placeholder='Motivo da desistência';reason.setAttribute('aria-label','Motivo da desistência para substituir');
  if(scale.status==='escalada')panel.append(reason);
  const allLabel=document.createElement('label');allLabel.className='scope-choice';const all=document.createElement('input');all.type='checkbox';allLabel.append(all,document.createTextNode('Substituir nos demais dias deste pedido a partir deste dia'));panel.append(allLabel);
  const scope=document.createElement('label');scope.className='scope-choice';const checkbox=document.createElement('input');checkbox.type='checkbox';scope.append(checkbox,document.createTextNode('Confirmei a disponibilidade da substituta para este dia e horário'));panel.append(scope);
  const actions=document.createElement('div');actions.className='order-assign-actions';
  const save=document.createElement('button');save.type='button';save.className='button button-primary';save.textContent='Salvar substituição';
  save.addEventListener('click',async()=>{
    if(orderDetailBusy||!select.value)return;
    if(scale.status==='escalada'&&reason.value.trim().length<5)return orderDetailError('Informe o motivo da desistência com pelo menos 5 caracteres.');
    orderDetailBusy=true;save.disabled=true;
    try {
      await request(`/api/pedidos/${scale.pedido_id}/escalas/${scale.id}/substituir`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({diarista_id:Number(select.value),motivo:reason.value.trim(),disponibilidade_confirmada:checkbox.checked,todos_restantes:all.checked})});
      await refreshOrderScales();if(typeof loadFinance==='function'&&(!window.directRemote||['admin','financeiro'].includes(window.directRemote.role)))await loadFinance();
      $('#order-detail-success').textContent='Substituição registrada. Histórico preservado; confirme se a nova pessoa vai e depois registre presença ou falta.';$('#order-detail-success').hidden=false;
    }catch(error){orderDetailError(error.message);}finally{orderDetailBusy=false;save.disabled=false;}
  });
  const cancel=document.createElement('button');cancel.type='button';cancel.className='button button-quiet';cancel.textContent='Cancelar';cancel.addEventListener('click',()=>{panel.remove();refreshOrderScales().catch(e=>orderDetailError(e.message));});actions.append(save,cancel);panel.append(actions);row.append(panel);panel.scrollIntoView({block:'nearest'});
  window.DirectUI.replacement(panel,{scale,order:orderRecords.find(o=>o.id===scale.pedido_id),workers:orderWorkers,stores:orderCatalogStores,orders:orderRecords,scales:orderScales,select,all});
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
  window.DirectAutomationUI?.suggest(item,orderWorkers,orderCatalogStores,orderRecords,weeklyScales,orderScales);
  const list = $('#order-detail-shifts'); list.replaceChildren();
  item.turnos.forEach(shift => {
    const scales = orderScales.filter(scale => scale.data === shift.data);
    const active = scales.filter(scale => !['falta','desistiu'].includes(scale.status)).length;
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
      const row = document.createElement('div'); row.className = 'order-worker-row';row.dataset.scaleId=scale.id;
      const identity = document.createElement('div'); identity.className = 'order-worker-identity';
      const name = document.createElement('strong'); name.textContent = scale.diarista_nome;
      const state = document.createElement('span'); state.className = `order-attendance-status ${scale.status}`;
      state.textContent = { escalada: 'Escalado', presente: 'Presença', falta: 'Falta', desistiu:'Desistiu' }[scale.status];
      identity.append(name, state); row.append(identity);
      if (['falta','desistiu'].includes(scale.status)) {
        const absence = document.createElement('small'); absence.className = 'order-absence-detail';
        const replacement = scales.find(item => item.id === scale.substituida_por_escala_id);
        absence.textContent = `${scale.desistencia_motivo || scale.falta_motivo || 'Motivo não registrado (histórico anterior)'} · ${scale.desistencia_por || scale.falta_confirmada_por || 'Autor não registrado'}${(scale.desistencia_em || scale.falta_confirmada_em) ? ` · ${new Date(scale.desistencia_em || scale.falta_confirmada_em).toLocaleString('pt-BR')}` : ''}${replacement ? ` · Substituta: ${replacement.diarista_nome}` : ' · Substituição pendente'}`;
        row.append(absence);
      }
      const actions = document.createElement('div'); actions.className = 'order-worker-actions';
      if (!window.directRemote || window.directRemote.role !== 'consulta') {
        const profile = document.createElement('button'); profile.type = 'button'; profile.className = 'text-button';
        profile.textContent = 'Ver ficha'; profile.setAttribute('aria-label', `Ver ficha de ${scale.diarista_nome}`);
        profile.addEventListener('click', async () => {
          $('#order-detail-dialog').close();
          location.hash = '#diaristas';
          await load();
          await openDetail(scale.diarista_id);
        });
        actions.append(profile);
      }
      for (const [status, label] of canOperate && scale.status!=='desistiu' ? [['presente', 'Presença'], ['falta', 'Falta']] : []) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `order-attendance-button ${status}${scale.status === status ? ' selected' : ''}`;
        button.textContent = label; button.disabled = scale.status === status || shift.data > orderToday();
        if (shift.data > orderToday()) button.title = `Disponível em ${dateLabel(shift.data)}. Confira a data e o ano do pedido.`;
        button.setAttribute('aria-label', `${label} de ${scale.diarista_nome} em ${dateLabel(shift.data)}`);
        button.addEventListener('click', () => changeOrderAttendance(scale, status)); actions.append(button);
      }
      if(canOperate && !['cancelado','concluido'].includes(item.situacao)) {
        if(scale.status==='escalada') {
          const withdraw=document.createElement('button');withdraw.type='button';withdraw.className='order-attendance-button desistiu';withdraw.textContent='Desistência';
          withdraw.setAttribute('aria-label',`Desistência de ${scale.diarista_nome} em ${dateLabel(shift.data)}`);withdraw.addEventListener('click',()=>changeOrderAttendance(scale,'desistiu'));actions.append(withdraw);
        }
        if(scale.status!=='presente' && !scale.substituida_por_escala_id) {
          const replace=document.createElement('button');replace.type='button';replace.className='order-attendance-button substitute';replace.textContent='Substituir';
          replace.setAttribute('aria-label',`Substituir ${scale.diarista_nome} em ${dateLabel(shift.data)}`);replace.addEventListener('click',()=>showOrderSubstitute(scale,row));actions.append(replace);
        }
      }
      row.append(actions);
      window.DirectOperations?.appendScale(row, scale);
      if (scale.status === 'presente' && (!window.directRemote || ['admin', 'financeiro'].includes(window.directRemote.role))) {
        const payment = document.createElement('div'); payment.className = 'order-payment-line';
        const label = document.createElement('span');
        label.textContent = scale.diaria?.data_pagamento ? `Pago em ${dateLabel(scale.diaria.data_pagamento)}` : scale.diaria?.valor_centavos != null ? 'Pagamento pendente' : 'Pagamento pendente · valor não informado';
        payment.append(label);
        if (scale.diaria) {
          const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Pagamento';
          if (scale.diaria.pagamento_lote_id) {
            edit.textContent = `Lote #${scale.diaria.pagamento_lote_id}`;
            edit.addEventListener('click', () => { $('#order-detail-dialog').close(); location.hash = '#financeiro'; });
          } else edit.addEventListener('click', () => {
            $('#order-detail-dialog').close();
            startPayment({ ...scale.diaria, diarista_id: scale.diarista_id, data: scale.data, setor: item.setor, local: `${item.supermercado}${item.unidade ? ` · ${item.unidade}` : ''}` }, 'order');
          });
          payment.append(edit);
        }
        row.append(payment);
      }
      body.append(row);
    });
    if (canOperate && !['concluido', 'cancelado'].includes(item.situacao) && active < item.quantidade_diaristas) {
      const picker = document.createElement('div'); picker.className = 'order-worker-picker';
      const select = document.createElement('select'); select.setAttribute('aria-label', `Escolher diarista para ${dateLabel(shift.data)}`);
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecione uma diarista'; select.append(placeholder);
      const store = matchingOrderStore(item.supermercado, item.unidade);
      const candidates = orderWorkers.map(worker => ({ worker, match: window.DirectMatching.rank(worker, shift, item, store, orderRecords, weeklyScales) }))
        .filter(({ worker }) => !worker.bloqueada && !scales.some(scale => scale.diarista_id === worker.id))
        .sort((a, b) => (b.match.score || 0) - (a.match.score || 0) || a.worker.nome.localeCompare(b.worker.nome, 'pt-BR'));
      candidates.forEach(({ worker, match }, index) => {
        const option = document.createElement('option'); option.value = String(worker.id);
        option.textContent = `${index < 3 && match.eligible ? '★ ' : ''}${worker.nome}${(match.reasons || []).length ? ` · ${match.reasons.join(', ')}` : ''}`; select.append(option);
      });
      if (!candidates.length) placeholder.textContent = 'Nenhuma diarista cadastrada disponível para selecionar';
      const add = document.createElement('button'); add.type = 'button'; add.className = 'button button-outline'; add.textContent = 'Escalar';
      add.disabled = !candidates.length;
      select.addEventListener('change', () => chooseOrderWorker(shift.data, select, picker));
      add.addEventListener('click', () => chooseOrderWorker(shift.data, select, picker));
      picker.append(select, add); body.append(picker);
    }
    card.append(body); list.append(card);
  });
}

async function openOrderDetail(id) {
  if (!orderRecords.some(row => row.id === id)) await loadOrders();
  const item = orderRecords.find(row => row.id === id);
  if (!item) return showOrderFeedback('Pedido não encontrado.', true);
  orderDetailId = id;
  $('#order-detail-error').hidden = true;
  $('#order-detail-success').hidden = true;
  $('#order-detail-title').textContent = item.supermercado;
  let reserves=document.getElementById('order-enterprise-reserves');if(!reserves){reserves=document.createElement('button');reserves.id='order-enterprise-reserves';reserves.type='button';reserves.className='button button-outline';document.querySelector('#order-detail-dialog .dialog-footer').prepend(reserves);}reserves.textContent='Reservas e qualificações';reserves.hidden=window.directRemote&&!['admin','operacao'].includes(directRemote.role);reserves.onclick=async()=>{try{$('#order-detail-dialog').close();await DirectModules.ensure('empresa');await DirectEnterprise.reserves(id);}catch(e){showOrderFeedback(e.message,true);}};
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
  const optional = document.createElement('details'); optional.className='profile-more';
  const summary=document.createElement('summary');summary.textContent='Ver detalhes do pedido';optional.append(summary);
  const fields=$('#order-detail-fields');for(const section of [...fields.children].slice(1))optional.append(section);fields.append(optional);
  const showStore = () => {
    if (orderDetailId !== id || !$('#order-detail-dialog').open) return;
    const store = matchingOrderStore(item.supermercado, item.unidade);
    $('#order-detail-store')?.remove();
    if (!store) return;
    const section = detailSection('Loja cadastrada', [['Endereço', [store.endereco, store.bairro, `${store.cidade}/${store.uf}`].filter(Boolean).join(' · ')]]);
    section.id = 'order-detail-store';
    const guidance=DirectMessagesModel.guidance(store);if(guidance){const d=document.createElement('details'),s=document.createElement('summary'),t=document.createElement('p');d.className='profile-more';s.textContent='Orientações da loja';t.className='automation-guidance';t.textContent=guidance.replace(/\*/g,'');d.append(s,t);section.append(d);}
    const link = document.createElement('button'); link.type = 'button'; link.className = 'text-button'; link.textContent = 'Ver em Redes e lojas';
    link.addEventListener('click', () => {
      $('#order-detail-dialog').close();
      $('#stores-search').value = store.nome;
      location.hash = '#redes';
      loadStores();
    });
    section.append(link);
    $('#order-detail-fields').append(section);
  };
  $('#order-detail-shifts').textContent = 'Carregando escalas...';
  $('#order-detail-dialog').showModal();
  showStore();
  loadOrderCatalog().then(showStore).catch(() => {});
  try {
    const canOperate = !window.directRemote || ['admin', 'operacao'].includes(window.directRemote.role);
    const result = await Promise.all([canOperate ? request('/api/diaristas') : Promise.resolve([]), request(`/api/pedidos/${id}/escalas`)]);
    if (orderDetailId !== id || !$('#order-detail-dialog').open) return;
    [orderWorkers, orderScales] = result; renderOrderShifts();
  } catch (err) { orderDetailError(`Não foi possível carregar as escalas: ${err.message}`); }
}

async function deleteOrder() {
  const item = orderRecords.find(row => row.id === orderDetailId);
  if (!item || !window.confirm(`Excluir o pedido de ${item.supermercado}${item.unidade ? ' · ' + item.unidade : ''}? As escalas deste pedido também serão removidas. O cadastro dos diaristas será mantido. Esta ação não pode ser desfeita.`)) return;
  const button = $('#order-delete-button'); button.disabled = true;
  try {
    await request(`/api/pedidos/${item.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_updated_at: item.atualizado_em || null }) });
    $('#order-detail-dialog').close(); orderDetailId = null;
    await loadOrders(); showOrderFeedback('Pedido excluído.');
    window.DirectManagementUI?.refresh();
    if (typeof loadHome === 'function') loadHome().catch(() => {});
  } catch (err) { orderDetailError(err.message); }
  finally { button.disabled = false; }
}

function orderDialogBackdrop(event) {
  const dialog = event.currentTarget;
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
}

$('#new-order-button').addEventListener('click', () => openOrderForm());
$('#orders-empty-new').addEventListener('click', () => openOrderForm());
$('#orders-search').addEventListener('input', applyOrderFilters);
for(const id of ['orders-network-filter','orders-store-filter','orders-sector-filter','orders-status-filter','orders-start-filter','orders-end-filter']) $('#'+id).addEventListener('change',applyOrderFilters);
$('#orders-filter-toggle').addEventListener('click',()=>{const panel=$('#orders-filter-fields');panel.hidden=!panel.hidden;$('#orders-filter-toggle').setAttribute('aria-expanded',String(!panel.hidden));});
$('#orders-filter-clear').addEventListener('click',()=>{for(const id of ['orders-search','orders-start-filter','orders-end-filter']) $('#'+id).value='';for(const id of ['orders-network-filter','orders-store-filter','orders-sector-filter','orders-status-filter']) $('#'+id).value='todos';applyOrderFilters();});
$('#order-close-button').addEventListener('click', () => $('#order-dialog').close());
$('#order-cancel-button').addEventListener('click', () => $('#order-dialog').close());
$('#order-form').addEventListener('submit', saveOrder);
$('#order-market').addEventListener('input', updateOrderStoreOptions);
$('#order-unit').addEventListener('input', updateOrderStoreOptions);
$('#order-add-day').addEventListener('click', () => addOrderShift().focus());
$('#order-quantity').addEventListener('input', updateOrderPreview);
$('#order-detail-close').addEventListener('click', () => $('#order-detail-dialog').close());
$('#order-detail-close-bottom').addEventListener('click', () => $('#order-detail-dialog').close());
$('#order-edit-button').addEventListener('click', () => openOrderForm(orderRecords.find(row => row.id === orderDetailId)));
$('#order-delete-button').addEventListener('click', deleteOrder);
$('#order-dialog').addEventListener('click', orderDialogBackdrop);
$('#order-detail-dialog').addEventListener('click', orderDialogBackdrop);
if (window.location.hash === '#pedidos') loadOrders();

setInterval(()=>{if(location.hash==='#pedidos'&&!orderDetailBusy)renderOrders();},60000);

window.addEventListener('direct:remote-changed',()=>{if($('#order-detail-dialog').open&&!orderDetailBusy){if(document.querySelector('.order-substitute-panel')){window.DirectUI?.notify('Dados atualizados. Sua edição de substituição foi preservada; a disponibilidade será conferida ao salvar.');return;}refreshOrderScales().catch(e=>orderDetailError(e.message));}});

window.addEventListener('direct:signed-out',()=>{ orderRecords=[]; orderWorkers=[]; orderScales=[]; $('#orders-rows').replaceChildren(); if($('#order-detail-dialog').open)$('#order-detail-dialog').close(); });
