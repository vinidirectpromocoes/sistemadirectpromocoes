const $ = (selector) => document.querySelector(selector);
const days = [
  ['segunda', 'Segunda-feira'], ['terca', 'Terça-feira'], ['quarta', 'Quarta-feira'],
  ['quinta', 'Quinta-feira'], ['sexta', 'Sexta-feira'], ['sabado', 'Sábado'], ['domingo', 'Domingo'],
];
let records = [];
let editingId = null;
let detailId = null;
let paymentDailyId = null;
let paymentDiaristaId = null;
let paymentOrigin = 'detail';
let paymentWasPaid = false;
let financeRecords = [];
let financeEditingId = null;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moneyLabel = cents => cents == null ? 'Sem valor' : brl.format(cents / 100);
const moneyInput = cents => cents == null ? '' : (cents / 100).toFixed(2);

function formatCpf(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function formatCep(value) {
  return value.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
}

function validCpf(value) {
  const cpf = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const size of [9, 10]) {
    const total = [...cpf.slice(0, size)].reduce((sum, digit, index) => sum + Number(digit) * (size + 1 - index), 0);
    const calculated = (total * 10) % 11;
    if ((calculated === 10 ? 0 : calculated) !== Number(cpf[size])) return false;
  }
  return true;
}

function maskCpf(cpf) {
  return `***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function showFeedback(message, isError = false) {
  const box = $('#feedback');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = false;
  window.clearTimeout(showFeedback.timer);
  showFeedback.timer = window.setTimeout(() => { box.hidden = true; }, 5000);
}

function showFormError(message) {
  const box = $('#form-error');
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

let activeRequests = 0;
let loadingTimer;
async function request(url, options = {}) {
  activeRequests += 1;
  if (activeRequests === 1) {
    loadingTimer = window.setTimeout(() => {
      $('#global-loading').hidden = false;
      $('.app-shell').setAttribute('aria-busy', 'true');
    }, 140);
  }
  try {
    if (window.directRemote) return await window.directRemote.request(url, options);
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.erro || 'Não foi possível concluir a operação.');
    return data;
  } finally {
    activeRequests -= 1;
    if (activeRequests === 0) {
      window.clearTimeout(loadingTimer);
      $('#global-loading').hidden = true;
      $('.app-shell').removeAttribute('aria-busy');
    }
  }
}

function createAvailability() {
  const container = $('#day-list');
  days.forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'day-row';
    row.dataset.day = key;
    const checkLabel = document.createElement('label');
    checkLabel.className = 'day-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'day-enabled';
    checkLabel.append(checkbox, document.createTextNode(label));
    const times = document.createElement('div');
    times.className = 'day-times';
    const start = document.createElement('input');
    start.type = 'time'; start.className = 'day-start'; start.value = '08:00'; start.disabled = true;
    start.setAttribute('aria-label', `Início ${label}`);
    const end = document.createElement('input');
    end.type = 'time'; end.className = 'day-end'; end.value = '18:00'; end.disabled = true;
    end.setAttribute('aria-label', `Fim ${label}`);
    times.append(start, document.createTextNode('até'), end);
    times.hidden = true;
    row.append(checkLabel, times);
    container.append(row);
    checkbox.addEventListener('change', () => {
      start.disabled = end.disabled = !checkbox.checked || scheduleMode() !== 'especifico';
      row.classList.toggle('selected', checkbox.checked);
    });
  });
}

function scheduleMode() {
  return $('input[name="horario_tipo"]:checked')?.value || 'qualquer';
}

function updateScheduleMode() {
  const specific = scheduleMode() === 'especifico';
  document.querySelectorAll('.day-row').forEach(row => {
    const selected = row.querySelector('.day-enabled').checked;
    row.querySelector('.day-times').hidden = !specific;
    row.querySelector('.day-start').disabled = !specific || !selected;
    row.querySelector('.day-end').disabled = !specific || !selected;
  });
  $('#schedule-error').hidden = true;
}

function toggleConditional() {
  const working = $('input[name="trabalhando"]:checked')?.value === 'true';
  $('#workplace-wrap').hidden = !working;
  $('#local_trabalho').required = false;
  if ($('input[name="trabalhando"]:checked')?.value === 'false') $('#local_trabalho').value = '';
  const mobile = $('input[name="pode_se_deslocar"]:checked')?.value === 'true';
  $('#transport-wrap').hidden = !mobile;
  $('#transporte').required = false;
  if ($('input[name="pode_se_deslocar"]:checked')?.value === 'false') $('#transporte').value = '';
}

function setRadio(name, value) {
  const control = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (control) control.checked = true;
}

function openForm(record = null) {
  window.directPendingForm = null;
  if ($('#detail-dialog').open) $('#detail-dialog').close();
  editingId = record?.id ?? null;
  $('#diarista-form').reset();
  $('#form-error').hidden = true;
  $('#schedule-error').hidden = true;
  $('#dialog-title').textContent = record ? 'Editar diarista' : 'Nova diarista';
  $('#save-button').textContent = record ? 'Salvar alterações' : 'Salvar cadastro';
  document.querySelectorAll('.day-row').forEach(row => {
    const check = row.querySelector('.day-enabled');
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    row.querySelector('.day-start').value = '08:00';
    row.querySelector('.day-end').value = '18:00';
  });
  if (record) {
    for (const key of ['nome', 'cpf', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'local_trabalho', 'transporte', 'observacoes_locomocao']) {
      $(`#${key}`).value = key === 'cpf' ? formatCpf(record[key]) : key === 'cep' ? formatCep(record[key]) : record[key];
    }
    $('#setores').value = record.setores.join(', ');
    setRadio('trabalhando', record.trabalhando == null ? 'unknown' : String(record.trabalhando));
    setRadio('pode_se_deslocar', record.pode_se_deslocar == null ? 'unknown' : String(record.pode_se_deslocar));
    setRadio('horario_tipo', record.disponibilidade.every(slot => slot.inicio === '00:00' && slot.fim === '23:59') ? 'qualquer' : 'especifico');
    record.disponibilidade.forEach(slot => {
      const row = document.querySelector(`.day-row[data-day="${slot.dia}"]`);
      if (!row) return;
      const check = row.querySelector('.day-enabled');
      check.checked = true; check.dispatchEvent(new Event('change'));
      row.querySelector('.day-start').value = slot.inicio;
      row.querySelector('.day-end').value = slot.fim;
    });
  }
  updateScheduleMode();
  toggleConditional();
  $('#form-dialog').showModal();
  $('#nome').focus();
}

function formData() {
  const workingChoice = $('input[name="trabalhando"]:checked');
  const travelChoice = $('input[name="pode_se_deslocar"]:checked');
  const anyHours = scheduleMode() === 'qualquer';
  const availability = [...document.querySelectorAll('.day-row')].filter(row => row.querySelector('.day-enabled').checked).map(row => ({
    dia: row.dataset.day,
    inicio: anyHours ? '00:00' : row.querySelector('.day-start').value,
    fim: anyHours ? '23:59' : row.querySelector('.day-end').value,
  }));
  return {
    nome: $('#nome').value, cpf: $('#cpf').value,
    setores: $('#setores').value.split(',').map(value => value.trim()).filter(Boolean),
    cep: $('#cep').value, logradouro: $('#logradouro').value, numero: $('#numero').value,
    complemento: $('#complemento').value, bairro: $('#bairro').value,
    trabalhando: workingChoice && workingChoice.value !== 'unknown' ? workingChoice.value === 'true' : null, local_trabalho: $('#local_trabalho').value,
    disponibilidade: availability,
    pode_se_deslocar: travelChoice && travelChoice.value !== 'unknown' ? travelChoice.value === 'true' : null,
    transporte: $('#transporte').value, observacoes_locomocao: $('#observacoes_locomocao').value,
  };
}

function validateForm(data) {
  const required = [['nome', 'nome'], ['cpf', 'CPF']];
  for (const [key, label] of required) if (!(Array.isArray(data[key]) ? data[key].length : data[key].trim())) return `Preencha ${label}.`;
  if (!validCpf(data.cpf)) return 'Informe um CPF válido.';
  if (data.cep.trim() && data.cep.replace(/\D/g, '').length !== 8) return 'Informe um CEP válido.';
  const invalidSlot = data.disponibilidade.find(slot => !slot.inicio || !slot.fim || slot.inicio >= slot.fim);
  if (invalidSlot) return `Confira o horário de ${days.find(([key]) => key === invalidSlot.dia)?.[1] || invalidSlot.dia}: o início deve ser antes do fim.`;
  return null;
}

async function save(event) {
  event.preventDefault();
  const data = formData();
  const error = validateForm(data);
  if (error) {
    showFormError(error);
    if (error.includes('dia disponível') || error.includes('horário de ')) {
      const warning = $('#schedule-error'); warning.textContent = error; warning.hidden = false;
      warning.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  $('#form-error').hidden = true;
  $('#schedule-error').hidden = true;
  const button = $('#save-button');
  button.disabled = true;
  try {
    await request(editingId ? `/api/diaristas/${editingId}` : '/api/diaristas', {
      method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const wasEditing = Boolean(editingId);
    const pendingError = await window.directResolvePendingForm?.('diarista');
    $('#form-dialog').close();
    await load();
    showFeedback(pendingError || (wasEditing ? 'Cadastro atualizado com sucesso.' : 'Diarista cadastrada com sucesso.'));
  } catch (err) { showFormError(err.message); }
  finally { button.disabled = false; }
}

function cell(textValue, className = '') {
  const td = document.createElement('td');
  td.className = className;
  td.textContent = textValue;
  return td;
}

function eyeIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outline.setAttribute('d', 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z');
  const pupil = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pupil.setAttribute('cx', '12'); pupil.setAttribute('cy', '12'); pupil.setAttribute('r', '2.5');
  svg.append(outline, pupil);
  return svg;
}

function render() {
  const term = $('#search').value.trim().toLocaleLowerCase('pt-BR').replace(/\D/g, '');
  const rawTerm = $('#search').value.trim().toLocaleLowerCase('pt-BR');
  const filtered = records.filter(item => !rawTerm || item.nome.toLocaleLowerCase('pt-BR').includes(rawTerm) || item.setores.some(setor => setor.toLocaleLowerCase('pt-BR').includes(rawTerm)) || (term && item.cpf.includes(term)));
  $('#total-count').textContent = records.length;
  $('#available-count').textContent = records.filter(item => !item.bloqueada && item.disponibilidade.length).length;
  $('#blocked-count').textContent = records.filter(item => item.bloqueada).length;
  $('#empty-state').hidden = records.length !== 0;
  $('#no-results').hidden = records.length === 0 || filtered.length !== 0;
  $('#table-wrap').hidden = filtered.length === 0;
  const body = $('#rows');
  body.replaceChildren();
  filtered.forEach(item => {
    const tr = document.createElement('tr');
    const identity = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = item.nome;
    const cpf = document.createElement('small'); cpf.textContent = `CPF ${maskCpf(item.cpf)}`;
    identity.append(name, cpf);
    tr.append(identity, cell(item.setores.join(', '), 'sector-cell'), cell(item.bairro));
    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${item.bloqueada ? 'blocked' : 'available'}`;
    badge.textContent = item.bloqueada ? 'Bloqueada' : partialWorker(item) ? 'Cadastro parcial' : 'Disponível';
    status.append(badge); tr.append(status);
    const actions = document.createElement('td');
    actions.className = 'actions';
    const view = document.createElement('button');
    view.type = 'button'; view.className = 'view-button'; view.append(eyeIcon());
    view.setAttribute('aria-label', `Ver ficha e histórico de ${item.nome}`);
    view.title = 'Ver ficha e histórico';
    view.addEventListener('click', () => openDetail(item.id));
    actions.append(view); tr.append(actions); body.append(tr);
  });
}

function detailSection(title, entries) {
  const section = document.createElement('section');
  section.className = 'detail-section';
  const heading = document.createElement('h3'); heading.textContent = title;
  const list = document.createElement('dl');
  entries.forEach(([label, value]) => {
    const pair = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = value || 'Não informado';
    pair.append(term, description); list.append(pair);
  });
  section.append(heading, list);
  return section;
}

function partialWorker(record) {
  return !record.setores?.length || !record.cep || !record.logradouro || !record.numero || !record.bairro || !record.disponibilidade?.length || record.trabalhando == null || record.pode_se_deslocar == null || (record.trabalhando && !record.local_trabalho) || (record.pode_se_deslocar && !record.transporte);
}

function renderDetail(record) {
  $('#detail-title').textContent = record.nome;
  const status = $('#detail-status');
  const badge = document.createElement('span');
  badge.className = `badge ${record.bloqueada ? 'blocked' : 'available'}`;
  badge.textContent = record.bloqueada ? 'Bloqueada' : partialWorker(record) ? 'Cadastro parcial' : 'Disponível';
  const explanation = document.createElement('span');
  explanation.textContent = record.bloqueada ? 'Cadastro bloqueado para novas diárias.' : partialWorker(record) ? 'Cadastro salvo. Complete os dados quando receber as informações.' : 'Cadastro ativo para novas diárias.';
  status.replaceChildren(badge, explanation);
  $('#block-button').textContent = record.bloqueada ? 'Desbloquear' : 'Bloquear';
  $('#add-daily-button').disabled = record.bloqueada;
  $('#add-daily-button').title = record.bloqueada ? 'Desbloqueie a diarista para registrar uma nova diária.' : '';
  const schedule = record.disponibilidade.map(slot => {
    const label = days.find(([key]) => key === slot.dia)?.[1] || slot.dia;
    return `${label}: ${slot.inicio === '00:00' && slot.fim === '23:59' ? 'qualquer horário' : `${slot.inicio} às ${slot.fim}`}`;
  }).join('\n');
  const address = [[record.logradouro, record.numero].filter(Boolean).join(', '), record.complemento, record.bairro, record.cep ? `CEP ${formatCep(record.cep)}` : ''].filter(Boolean).join(' · ');
  $('#detail-fields').replaceChildren(
    detailSection('Dados pessoais', [['Nome completo', record.nome], ['CPF', formatCpf(record.cpf)], ['Setores de experiência', record.setores.join(', ')]]),
    detailSection('Endereço', [['Endereço completo', address]]),
    detailSection('Trabalho e disponibilidade', [['Trabalha atualmente', record.trabalhando == null ? 'Não informado' : record.trabalhando ? 'Sim' : 'Não'], ['Local de trabalho', record.local_trabalho || (record.trabalhando === false ? '—' : 'Não informado')], ['Dias e horários', schedule]]),
    detailSection('Locomoção', [['Pode se deslocar', record.pode_se_deslocar == null ? 'Não informado' : record.pode_se_deslocar ? 'Sim' : 'Não'], ['Meio de transporte', record.transporte || (record.pode_se_deslocar === false ? '—' : 'Não informado')], ['Observações', record.observacoes_locomocao || '—']]),
  );
}

function dateLabel(value) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function renderHistory(items) {
  $('#history-title').textContent = `Histórico de diárias (${items.length})`;
  const list = $('#history-list');
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Nenhuma diária registrada para esta diarista.';
    list.append(empty);
    return;
  }
  items.forEach(item => {
    const row = document.createElement('article'); row.className = 'history-item';
    const content = document.createElement('div');
    const date = document.createElement('strong'); date.textContent = dateLabel(item.data);
    const place = document.createElement('span'); place.textContent = `${item.setor} · ${item.local}`;
    content.append(date, place);
    const payment = document.createElement('small');
    payment.className = `payment-state ${item.data_pagamento ? 'paid' : 'pending'}`;
    payment.textContent = item.data_pagamento ? `Pagamento: ${dateLabel(item.data_pagamento)}` : 'Pagamento pendente';
    content.append(payment);
    if (!window.directRemote || ['admin', 'financeiro'].includes(window.directRemote.role)) {
      const amount = document.createElement('small');
      amount.textContent = `Valor: ${moneyLabel(item.valor_centavos)}${item.vencimento_pagamento ? ` · Vencimento: ${dateLabel(item.vencimento_pagamento)}` : ''}`;
      content.append(amount);
    }
    if (item.observacoes) { const notes = document.createElement('small'); notes.textContent = item.observacoes; content.append(notes); }
    const actions = document.createElement('div'); actions.className = 'history-actions';
    const editPayment = document.createElement('button'); editPayment.type = 'button'; editPayment.className = 'text-button';
    editPayment.textContent = item.data_pagamento ? 'Alterar pagamento' : 'Registrar pagamento';
    editPayment.setAttribute('aria-label', `${editPayment.textContent} da diária de ${dateLabel(item.data)}`);
    editPayment.addEventListener('click', () => startPayment(item));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button history-remove';
    remove.textContent = 'Excluir'; remove.setAttribute('aria-label', `Excluir diária de ${dateLabel(item.data)}`);
    remove.addEventListener('click', () => deleteDaily(item));
    if (!window.directRemote || ['admin', 'financeiro'].includes(window.directRemote.role)) actions.append(editPayment, remove);
    row.append(content, actions); list.append(row);
  });
}

async function loadHistory() {
  try { renderHistory(await request(`/api/diaristas/${detailId}/diarias`)); }
  catch (err) { $('#history-list').textContent = `Não foi possível carregar o histórico: ${err.message}`; }
}

async function openDetail(id) {
  const record = records.find(item => item.id === id);
  if (!record) return showFeedback('Cadastro não encontrado.', true);
  detailId = id;
  $('#detail-error').hidden = true;
  renderDetail(record);
  $('#history-list').textContent = 'Carregando histórico...';
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  await loadHistory();
}

async function toggleBlock() {
  const record = records.find(item => item.id === detailId);
  if (!record) return;
  if (!record.bloqueada && !window.confirm(`Bloquear ${record.nome} para novas diárias?`)) return;
  try {
    await request(`/api/diaristas/${detailId}/bloqueio`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bloqueada: !record.bloqueada }) });
    await load();
    await openDetail(detailId);
    showFeedback(record.bloqueada ? 'Diarista desbloqueada.' : 'Diarista bloqueada.');
  } catch (err) { showFeedback(err.message, true); }
}

function startDaily() {
  if (!detailId) return;
  if (records.find(item => item.id === detailId)?.bloqueada) {
    showFeedback('Desbloqueie a diarista antes de registrar uma nova diária.', true);
    return;
  }
  $('#detail-dialog').close();
  $('#daily-form').reset();
  $('#daily-error').hidden = true;
  const today = new Date();
  $('#daily-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const record = records.find(item => item.id === detailId);
  $('#daily-sector').value = record?.setores[0] || '';
  $('#daily-dialog').showModal();
  $('#daily-place').focus();
}

function cancelDaily() {
  $('#daily-dialog').close();
  openDetail(detailId);
}

async function saveDaily(event) {
  event.preventDefault();
  const data = { data: $('#daily-date').value, setor: $('#daily-sector').value.trim(), local: $('#daily-place').value.trim(), data_pagamento: $('#daily-payment-date').value || null, valor: $('#daily-value').value || null, vencimento_pagamento: $('#daily-due').value || null, forma_pagamento: $('#daily-method').value.trim(), observacoes: $('#daily-notes').value.trim() };
  if (!data.data || !data.setor || !data.local) { $('#daily-error').textContent = 'Preencha data, setor e local da diária.'; $('#daily-error').hidden = false; return; }
  if ((data.data_pagamento && !data.valor) || (data.valor && !data.data_pagamento && !data.vencimento_pagamento)) { $('#daily-error').textContent = 'Informe valor para uma diária paga e vencimento para uma diária pendente com valor.'; $('#daily-error').hidden = false; return; }
  const button = $('#daily-save-button'); button.disabled = true;
  try {
    await request(`/api/diaristas/${detailId}/diarias`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    $('#daily-dialog').close();
    await openDetail(detailId);
    await loadFinance();
    showFeedback('Diária registrada.');
  } catch (err) { $('#daily-error').textContent = err.message; $('#daily-error').hidden = false; }
  finally { button.disabled = false; }
}

function startPayment(item, origin = 'detail') {
  paymentDailyId = item.id;
  paymentDiaristaId = item.diarista_id || detailId;
  paymentOrigin = origin;
  paymentWasPaid = Boolean(item.data_pagamento);
  if ($('#detail-dialog').open) $('#detail-dialog').close();
  $('#payment-form').reset();
  $('#payment-error').hidden = true;
  $('#payment-context').textContent = `Diária de ${dateLabel(item.data)} · ${item.setor} · ${item.local}`;
  $('#payment-rate-hint').hidden = true;
  $('#payment-value').value = moneyInput(item.valor_centavos);
  $('#payment-due').value = item.vencimento_pagamento || '';
  $('#payment-date').value = item.data_pagamento || '';
  $('#payment-method').value = item.forma_pagamento || '';
  $('#payment-reason').value = '';
  $('#payment-reason-wrap').hidden = !paymentWasPaid;
  $('#payment-reason').required = paymentWasPaid;
  $('#payment-dialog').showModal();
  (item.valor_centavos == null ? $('#payment-value') : $('#payment-date')).focus();
  if (item.valor_centavos == null && typeof suggestedDailyPayout === 'function') {
    suggestedDailyPayout(item).then(rate => {
      if (!rate || !$('#payment-dialog').open || paymentDailyId !== item.id) return;
      if (!$('#payment-value').value) $('#payment-value').value = moneyInput(rate.cents);
      const hint = $('#payment-rate-hint');
      hint.textContent = `Valor sugerido: ${moneyLabel(rate.cents)} (${rate.specific ? `setor ${item.setor}` : `padrão ${rate.network}`}). Confirme o valor e o vencimento antes de salvar.`;
      hint.hidden = false;
    }).catch(() => {});
  }
}

function cancelPayment() {
  $('#payment-dialog').close();
  if (paymentOrigin === 'detail') openDetail(detailId);
  if (paymentOrigin === 'order' && orderDetailId) openOrderDetail(orderDetailId);
  if (paymentOrigin === 'finance-group') openFinanceGroup(financeOpenGroupId);
}

async function savePayment(event) {
  event.preventDefault();
  if ($('#payment-date').value && !$('#payment-value').value || $('#payment-value').value && !$('#payment-date').value && !$('#payment-due').value) {
    $('#payment-error').textContent = 'Informe valor para um pagamento feito e vencimento para uma diária pendente com valor.'; $('#payment-error').hidden = false; return;
  }
  if (paymentWasPaid && $('#payment-reason').value.trim().length < 8) {
    $('#payment-error').textContent = 'Explique a correção do pagamento já registrado com pelo menos 8 caracteres.'; $('#payment-error').hidden = false; return;
  }
  const button = $('#payment-save-button'); button.disabled = true;
  try {
    await request(`/api/diaristas/${paymentDiaristaId}/diarias/${paymentDailyId}/pagamento`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_pagamento: $('#payment-date').value || null, valor: $('#payment-value').value || null, vencimento_pagamento: $('#payment-due').value || null, forma_pagamento: $('#payment-method').value.trim(), motivo_ajuste: $('#payment-reason').value.trim() }),
    });
    $('#payment-dialog').close();
    if (paymentOrigin === 'detail') await openDetail(detailId);
    await loadFinance();
    if (paymentOrigin === 'finance') showFinanceFeedback('Pagamento da diária atualizado.');
    else if (paymentOrigin === 'finance-group') { showFinanceFeedback('Pagamento da diária atualizado.'); openFinanceGroup(financeOpenGroupId); }
    else if (paymentOrigin === 'order' && orderDetailId) await openOrderDetail(orderDetailId);
    else showFeedback('Informação de pagamento atualizada.');
  } catch (err) { $('#payment-error').textContent = err.message; $('#payment-error').hidden = false; }
  finally { button.disabled = false; }
}

async function deleteDaily(item) {
  if (!window.confirm(`Excluir a diária de ${dateLabel(item.data)} em ${item.local}?`)) return;
  try { await request(`/api/diaristas/${detailId}/diarias/${item.id}`, { method: 'DELETE' }); await loadHistory(); showFeedback('Diária excluída.'); }
  catch (err) { $('#detail-error').textContent = err.message; $('#detail-error').hidden = false; }
}

async function load() {
  try { records = await request('/api/diaristas'); render(); }
  catch (err) { showFeedback(`Não foi possível carregar os cadastros: ${err.message}`, true); }
}

async function deleteRecord(record) {
  if (!window.confirm(`Excluir o cadastro de ${record.nome}? Esta ação não pode ser desfeita.`)) return;
  try { await request(`/api/diaristas/${record.id}`, { method: 'DELETE' }); if ($('#detail-dialog').open) $('#detail-dialog').close(); detailId = null; await load(); showFeedback('Cadastro excluído.'); }
  catch (err) { $('#detail-error').textContent = err.message; $('#detail-error').hidden = false; }
}

createAvailability();
$('#cpf').addEventListener('input', event => { event.target.value = formatCpf(event.target.value); });
$('#cep').addEventListener('input', event => { event.target.value = formatCep(event.target.value); });
document.querySelectorAll('input[name="trabalhando"], input[name="pode_se_deslocar"]').forEach(input => input.addEventListener('change', toggleConditional));
document.querySelectorAll('input[name="horario_tipo"]').forEach(input => input.addEventListener('change', updateScheduleMode));
$('#new-button').addEventListener('click', () => openForm());
$('#empty-new-button').addEventListener('click', () => openForm());
$('#close-button').addEventListener('click', () => $('#form-dialog').close());
$('#cancel-button').addEventListener('click', () => $('#form-dialog').close());
$('#form-dialog').addEventListener('click', event => {
  const dialog = $('#form-dialog');
  const bounds = dialog.getBoundingClientRect();
  const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (event.target === dialog && outside) dialog.close();
});
$('#diarista-form').addEventListener('submit', save);
$('#search').addEventListener('input', render);
$('#detail-close-button').addEventListener('click', () => $('#detail-dialog').close());
$('#edit-button').addEventListener('click', () => { const record = records.find(item => item.id === detailId); if (record) openForm(record); });
$('#delete-button').addEventListener('click', () => { const record = records.find(item => item.id === detailId); if (record) deleteRecord(record); });
$('#block-button').addEventListener('click', toggleBlock);
$('#add-daily-button').addEventListener('click', startDaily);
$('#daily-close-button').addEventListener('click', cancelDaily);
$('#daily-cancel-button').addEventListener('click', cancelDaily);
$('#daily-form').addEventListener('submit', saveDaily);
$('#payment-close-button').addEventListener('click', cancelPayment);
$('#payment-cancel-button').addEventListener('click', cancelPayment);
$('#payment-form').addEventListener('submit', savePayment);
load();
