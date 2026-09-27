const financeToday = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
let visibleFinanceRows = [];

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
  if (item.data_pagamento) return { label: item.tipo === 'receita' ? 'Recebido' : 'Pago', style: 'settled' };
  if (item.vencimento && item.vencimento < financeToday()) return { label: 'Atrasado', style: 'overdue' };
  return { label: item.tipo === 'receita' ? 'A receber' : 'A pagar', style: 'open' };
}

function financePeriodDate(item) {
  return item.data_pagamento || item.vencimento || item.referencia;
}

function filteredFinanceRows() {
  const month = $('#finance-month').value;
  const allMonths = $('#finance-all-months').checked;
  const type = $('#finance-type-filter').value;
  const status = $('#finance-status-filter').value;
  const query = $('#finance-search').value.trim().toLocaleLowerCase('pt-BR');
  return financeRecords.filter(item => {
    if (!allMonths && month && !financePeriodDate(item)?.startsWith(month)) return false;
    if (type !== 'todos' && item.tipo !== type) return false;
    if (status === 'pago' && !item.data_pagamento) return false;
    if (status === 'pendente' && item.data_pagamento) return false;
    if (status === 'sem-valor' && item.valor_centavos != null) return false;
    if (query && !`${item.descricao} ${item.contraparte} ${item.categoria}`.toLocaleLowerCase('pt-BR').includes(query)) return false;
    return true;
  }).sort((a, b) => financePeriodDate(b).localeCompare(financePeriodDate(a)) || b.id - a.id);
}

function renderFinance() {
  const month = $('#finance-month').value;
  const total = (type, paid) => financeRecords.reduce((sum, item) => {
    if (item.tipo !== type || item.valor_centavos == null) return sum;
    if (paid && item.data_pagamento?.startsWith(month)) return sum + item.valor_centavos;
    if (!paid && !item.data_pagamento) return sum + item.valor_centavos;
    return sum;
  }, 0);
  const incoming = total('receita', true);
  const outgoing = total('despesa', true);
  $('#finance-in').textContent = moneyLabel(incoming);
  $('#finance-out').textContent = moneyLabel(outgoing);
  $('#finance-balance').textContent = moneyLabel(incoming - outgoing);
  $('#finance-receivable').textContent = moneyLabel(total('receita', false));
  $('#finance-payable').textContent = moneyLabel(total('despesa', false));
  const missing = financeRecords.filter(item => item.origem === 'diaria' && item.valor_centavos == null).length;
  const warning = $('#finance-warning');
  warning.hidden = missing === 0;
  if (missing) {
    const text = document.createElement('span');
    text.textContent = `${missing} diária${missing === 1 ? '' : 's'} sem valor informado. Complete esse dado para que os totais reflitam todos os pagamentos.`;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'text-button'; button.textContent = 'Ver diárias';
    button.addEventListener('click', () => { $('#finance-all-months').checked = true; $('#finance-status-filter').value = 'sem-valor'; renderFinance(); });
    warning.replaceChildren(text, button);
  }

  visibleFinanceRows = filteredFinanceRows();
  $('#finance-empty').hidden = visibleFinanceRows.length !== 0;
  $('#finance-table-wrap').hidden = visibleFinanceRows.length === 0;
  const body = $('#finance-rows'); body.replaceChildren();
  visibleFinanceRows.forEach(item => {
    const row = document.createElement('tr');
    const description = document.createElement('td');
    const title = document.createElement('strong'); title.textContent = item.descricao;
    const category = document.createElement('small'); category.textContent = item.origem === 'diaria' ? 'Diária · Pagamento de diarista' : item.categoria;
    description.append(title, category); row.append(description);
    row.append(cell(item.contraparte));
    const reference = item.data_pagamento ? `Pago em ${dateLabel(item.data_pagamento)}` : item.vencimento ? `Vence em ${dateLabel(item.vencimento)}` : `Diária de ${dateLabel(item.referencia)}`;
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
    edit.textContent = item.origem === 'diaria' && item.valor_centavos == null ? 'Completar' : 'Editar';
    edit.setAttribute('aria-label', `${edit.textContent} ${item.descricao}`);
    edit.addEventListener('click', () => item.origem === 'diaria' ? startPayment(item, 'finance') : openFinanceForm(item));
    actions.append(edit);
    if (item.origem === 'manual') {
      if (!item.data_pagamento) {
        const settle = document.createElement('button'); settle.type = 'button'; settle.className = 'text-button';
        settle.textContent = item.tipo === 'receita' ? 'Receber' : 'Pagar';
        settle.setAttribute('aria-label', `${settle.textContent} ${item.descricao}`);
        settle.addEventListener('click', () => openFinanceForm(item, true));
        actions.append(settle);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button finance-remove';
      remove.textContent = 'Excluir'; remove.setAttribute('aria-label', `Excluir ${item.descricao}`);
      remove.addEventListener('click', () => deleteFinanceEntry(item));
      actions.append(remove);
    }
    row.append(actions); body.append(row);
  });
}

async function loadFinance() {
  try { financeRecords = await request('/api/financeiro'); renderFinance(); }
  catch (err) { showFinanceFeedback(`Não foi possível carregar o financeiro: ${err.message}`, true); }
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
  } else {
    $('#finance-due').value = financeToday();
  }
  updateFinanceType();
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
    item.tipo === 'receita' ? 'Entrada' : 'Saída', item.origem === 'diaria' ? 'Diária' : 'Manual', item.descricao,
    item.contraparte, item.categoria, item.referencia, item.vencimento || '', item.data_pagamento || '',
    item.valor_centavos == null ? '' : (item.valor_centavos / 100).toFixed(2).replace('.', ','),
    financeStatus(item).label, item.forma_pagamento || '', item.observacoes || '',
  ]);
  const escape = value => {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = '\ufeff' + [headers, ...rows].map(row => row.map(escape).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `financeiro-direct-${$('#finance-all-months').checked ? 'todos' : $('#finance-month').value}.csv`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showPage() {
  const page = ['financeiro', 'pedidos', 'redes'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'diaristas';
  for (const name of ['diaristas', 'pedidos', 'redes', 'financeiro']) {
    const active = name === page;
    $(`#${name}-page`).hidden = !active;
    const link = $(`#nav-${name}`);
    link.classList.toggle('nav-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${{ diaristas: 'Diaristas', pedidos: 'Pedidos', redes: 'Redes e lojas', financeiro: 'Financeiro' }[page]} | Direct Promoções`;
  if (page === 'financeiro') loadFinance();
  if (page === 'pedidos' && typeof loadOrders === 'function') loadOrders();
  if (page === 'redes' && typeof loadStores === 'function') loadStores();
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
$('#finance-search').addEventListener('input', renderFinance);
$('#finance-type-filter').addEventListener('change', renderFinance);
$('#finance-status-filter').addEventListener('change', renderFinance);
$('#finance-export-button').addEventListener('click', exportFinanceCsv);
window.addEventListener('hashchange', showPage);
showPage();
