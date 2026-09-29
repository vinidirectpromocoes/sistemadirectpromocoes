/* Cobrança por presença e fechamento de pagamentos, com valores em centavos. */
(() => {
  const get = id => document.getElementById(id);
  const send = (url, method, data) => request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  let invoices = [], batches = [], finance = [], orders = [], scales = {};
  let selectedInvoiceId = null, selectedWorkerId = null, payable = [];

  function row(title, detail, amount) {
    const item = document.createElement('div'); item.className = 'workflow-line';
    const main = document.createElement('div');
    const heading = document.createElement('strong'); heading.textContent = title;
    const sub = document.createElement('small'); sub.textContent = detail;
    main.append(heading, sub);
    const value = document.createElement('strong'); value.textContent = amount;
    item.append(main, value);
    return item;
  }
  function error(id, message) {
    const box = get(id); box.textContent = message; box.hidden = false;
  }
  function remaining(invoice) {
    return Math.max(0, invoice.valor_centavos - invoice.valor_recebido_centavos);
  }
  function invoiceState(invoice) {
    if (invoice.status === 'cancelada') return 'Cancelada';
    if (!remaining(invoice)) return 'Recebida';
    if (invoice.valor_recebido_centavos) return 'Parcial';
    return invoice.vencimento < financeToday() ? 'Atrasada' : 'A receber';
  }
  function renderInvoices() {
    const active = invoices.filter(item => item.status === 'aberta');
    get('invoice-billed').textContent = moneyLabel(active.reduce((sum, item) => sum + item.valor_centavos, 0));
    get('invoice-received').textContent = moneyLabel(active.reduce((sum, item) => sum + item.valor_recebido_centavos, 0));
    get('invoice-open').textContent = moneyLabel(active.reduce((sum, item) => sum + remaining(item), 0));
    const list = get('invoice-list'); list.replaceChildren();
    if (!invoices.length) { list.textContent = 'Nenhuma cobrança gerada. Confirme presenças nos pedidos para começar.'; return; }
    for (const item of invoices) {
      const entry = document.createElement('article'); entry.className = 'workflow-entry';
      const main = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${item.rede} · #${item.id}${item.numero_nota ? ` · Nota ${item.numero_nota}` : ''}`;
      const period = document.createElement('small'); period.textContent = `${dateLabel(item.periodo_inicio)} a ${dateLabel(item.periodo_fim)} · ${item.itens.length} diária(s) · vence ${dateLabel(item.vencimento)}`;
      main.append(title, period);
      const info = document.createElement('div'); info.className = 'workflow-entry-values';
      const amount = document.createElement('strong'); amount.textContent = moneyLabel(item.valor_centavos);
      const state = document.createElement('span'); state.textContent = `${invoiceState(item)} · saldo ${moneyLabel(remaining(item))}`;
      const view = document.createElement('button'); view.type = 'button'; view.className = 'button button-outline'; view.textContent = 'Ver diárias';
      view.addEventListener('click', () => window.openInvoiceDetail(item.id));
      info.append(amount, state, view); entry.append(main, info); list.append(entry);
    }
  }
  function renderBatches() {
    const list = get('batch-list'); list.replaceChildren();
    if (!batches.length) { list.textContent = 'Ainda não há pagamentos fechados em lote.'; return; }
    for (const item of batches.slice(0, 100)) {
      const entry = document.createElement('article'); entry.className = 'workflow-entry';
      const main = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${item.diarista_nome || item.diaristas?.nome || `Diarista #${item.diarista_id}`} · ${item.quantidade} diária(s)`;
      const detail = document.createElement('small'); detail.textContent = `Lote #${item.id} · ${dateLabel(item.data_pagamento)}${item.forma ? ` · ${item.forma}` : ''} · ${item.status === 'pago' ? 'Pago' : 'Reaberto'}`;
      main.append(title, detail);
      const side = document.createElement('div'); side.className = 'workflow-entry-values';
      const amount = document.createElement('strong'); amount.textContent = moneyLabel(item.valor_centavos); side.append(amount);
      if (item.status === 'pago') {
        const details = document.createElement('details'); details.className = 'workflow-reopen';
        const summary = document.createElement('summary'); summary.textContent = 'Reabrir fechamento';
        const form = document.createElement('form');
        const input = document.createElement('input'); input.required = true; input.minLength = 8; input.maxLength = 300; input.placeholder = 'Motivo da correção'; input.setAttribute('aria-label', 'Motivo da reabertura');
        const button = document.createElement('button'); button.className = 'button button-quiet'; button.type = 'submit'; button.textContent = 'Reabrir';
        form.append(input, button);
        form.addEventListener('submit', async event => {
          event.preventDefault(); button.disabled = true;
          try { await send(`/api/pagamento-lotes/${item.id}/reabrir`, 'PATCH', { motivo: input.value.trim() }); await loadFinance(); await loadHome(); }
          catch (cause) { window.alert(cause.message); button.disabled = false; }
        });
        details.append(summary, form); side.append(details);
      }
      entry.append(main, side); list.append(entry);
    }
  }
  function renderInvoicePreview() {
    const network = get('invoice-network').value.toLocaleLowerCase('pt-BR');
    const start = get('invoice-start').value, end = get('invoice-end').value;
    if (!network || !start || !end || start > end) { get('invoice-preview').textContent = 'Escolha rede e período para conferir as presenças.'; return; }
    const orderByScale = new Map();
    for (const order of orders) for (const scale of scales[order.id] || []) orderByScale.set(scale.id, { order, scale });
    const billed = new Set(invoices.flatMap(item => item.itens.map(x => x.diaria_id)));
    const days = finance.filter(item => item.origem === 'diaria' && item.pedido_escala_id && !billed.has(item.id) && item.data >= start && item.data <= end &&
      orderByScale.get(item.pedido_escala_id)?.order.supermercado.toLocaleLowerCase('pt-BR') === network);
    const missing = days.filter(item => item.valor_recebido_centavos == null).length;
    const sum = days.reduce((total, item) => total + (item.valor_recebido_centavos || 0), 0);
    get('invoice-preview').textContent = `${days.length} presença(s) ainda não cobradas · ${moneyLabel(sum)}${missing ? ` · ${missing} sem tarifa: corrija antes de gerar.` : ''}`;
  }
  function renderInvoiceDetail() {
    const invoice = invoices.find(item => item.id === selectedInvoiceId);
    if (!invoice) return;
    get('invoice-detail-title').textContent = `${invoice.rede} · cobrança #${invoice.id}`;
    get('invoice-detail-summary').textContent = `Nota: ${invoice.numero_nota || 'não informada'} · ${dateLabel(invoice.periodo_inicio)} a ${dateLabel(invoice.periodo_fim)} · Total ${moneyLabel(invoice.valor_centavos)} · Recebido ${moneyLabel(invoice.valor_recebido_centavos)} · Saldo ${moneyLabel(remaining(invoice))}`;
    const items = get('invoice-detail-items'); items.replaceChildren();
    for (const item of invoice.itens) items.append(row(`Pedido #${item.pedido_id} · ${item.unidade || item.supermercado}`, `${dateLabel(item.data)} · ${item.setor} · ${item.diarista_nome}`, moneyLabel(item.valor_centavos)));
    if (!invoice.itens.length) items.textContent = 'Itens liberados após cancelamento.';
    const receipts = get('invoice-detail-receipts'); receipts.replaceChildren();
    for (const item of invoice.recebimentos) {
      const entry = document.createElement('div');
      entry.append(row(`${dateLabel(item.data_recebimento)}${item.estornado ? ' · Estornado' : ''}`, item.estornado ? item.motivo_estorno : item.forma || 'Forma não informada', moneyLabel(item.valor_centavos)));
      if (!item.estornado && invoice.status === 'aberta') {
        const details = document.createElement('details'); details.className = 'workflow-reopen';
        const summary = document.createElement('summary'); summary.textContent = 'Corrigir este recebimento';
        const form = document.createElement('form');
        const input = document.createElement('input'); input.required = true; input.minLength = 8; input.maxLength = 300;
        input.placeholder = 'Motivo do estorno'; input.setAttribute('aria-label', 'Motivo do estorno');
        const button = document.createElement('button'); button.type = 'submit'; button.className = 'button button-quiet'; button.textContent = 'Estornar';
        form.append(input, button);
        form.addEventListener('submit', async event => {
          event.preventDefault(); button.disabled = true;
          try { await send(`/api/recebimentos/${item.id}/estornar`, 'PATCH', { motivo: input.value.trim() }); await loadFinance(); await loadHome(); }
          catch (cause) { error('invoice-detail-error', cause.message); button.disabled = false; }
        });
        details.append(summary, form); entry.append(details);
      }
      receipts.append(entry);
    }
    if (!invoice.recebimentos.length) receipts.textContent = 'Nenhum recebimento registrado.';
    get('invoice-receive-form').hidden = invoice.status !== 'aberta' || !remaining(invoice);
    get('invoice-cancel-form').hidden = invoice.status !== 'aberta' || invoice.valor_recebido_centavos > 0;
    get('invoice-receive-value').value = (remaining(invoice) / 100).toFixed(2);
    get('invoice-receive-date').value = financeToday();
    get('invoice-detail-error').hidden = true;
  }
  window.openInvoiceDetail = id => {
    selectedInvoiceId = id; renderInvoiceDetail();
    if (!get('invoice-detail-dialog').open) get('invoice-detail-dialog').showModal();
  };
  window.openPaymentBatch = (workerId, items) => {
    selectedWorkerId = workerId;
    payable = items.filter(item => !item.data_pagamento && item.valor_centavos > 0);
    if (!payable.length) return;
    if (get('finance-group-dialog').open) get('finance-group-dialog').close();
    get('batch-dialog-title').textContent = `Pagar ${payable[0].contraparte}`;
    const list = get('batch-choices'); list.replaceChildren();
    for (const item of payable) {
      const label = document.createElement('label'); label.className = 'workflow-choice';
      const check = document.createElement('input'); check.type = 'checkbox'; check.value = String(item.id); check.checked = true;
      check.addEventListener('change', updateBatchTotal);
      const text = document.createElement('span'); text.textContent = `${dateLabel(item.data)} · ${item.setor} · ${item.local}`;
      const value = document.createElement('strong'); value.textContent = moneyLabel(item.valor_centavos);
      label.append(check, text, value); list.append(label);
    }
    get('batch-date').value = financeToday(); get('batch-method').value = '';
    get('batch-error').hidden = true; updateBatchTotal();
    get('batch-dialog').showModal();
  };
  function updateBatchTotal() {
    const chosen = new Set([...get('batch-choices').querySelectorAll('input:checked')].map(input => Number(input.value)));
    get('batch-total').textContent = `${chosen.size} diária(s) · ${moneyLabel(payable.reduce((sum, item) => sum + (chosen.has(item.id) ? item.valor_centavos : 0), 0))}`;
  }
  window.renderWorkflow = async (records, orderRows, orderScales) => {
    finance = records; orders = orderRows; scales = orderScales;
    invoices = records.filter(item => item.origem === 'cobranca');
    // Cobranças canceladas não aparecem no razão, mas permanecem no histórico.
    const [allInvoices, allBatches] = await Promise.all([request('/api/cobrancas'), request('/api/pagamento-lotes')]);
    invoices = allInvoices; batches = allBatches;
    renderInvoices(); renderBatches();
    if (get('invoice-detail-dialog').open) renderInvoiceDetail();
  };

  get('invoice-new').addEventListener('click', () => {
    const networks = [...new Set(orders.map(item => item.supermercado))].sort((a,b) => a.localeCompare(b,'pt-BR'));
    const select = get('invoice-network'); select.replaceChildren();
    for (const name of networks) { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); }
    get('invoice-start').value = `${financeToday().slice(0, 7)}-01`;
    get('invoice-end').value = financeToday(); get('invoice-due').value = financeToday(); get('invoice-note').value = '';
    get('invoice-create-error').hidden = true; renderInvoicePreview(); get('invoice-create-dialog').showModal();
  });
  for (const id of ['invoice-network', 'invoice-start', 'invoice-end']) get(id).addEventListener('change', renderInvoicePreview);
  get('invoice-create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = get('invoice-create-submit'); button.disabled = true; get('invoice-create-error').hidden = true;
    try {
      await send('/api/cobrancas', 'POST', { rede: get('invoice-network').value,
        periodo_inicio: get('invoice-start').value, periodo_fim: get('invoice-end').value,
        vencimento: get('invoice-due').value, numero_nota: get('invoice-note').value.trim() });
      get('invoice-create-dialog').close(); await loadFinance(); await loadHome();
    } catch (cause) { error('invoice-create-error', cause.message); }
    finally { button.disabled = false; }
  });
  get('invoice-receive-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      await send(`/api/cobrancas/${selectedInvoiceId}/recebimentos`, 'POST', { valor: get('invoice-receive-value').value,
        data_recebimento: get('invoice-receive-date').value, forma: get('invoice-receive-method').value.trim() });
      await loadFinance(); await loadHome();
    } catch (cause) { error('invoice-detail-error', cause.message); }
    finally { button.disabled = false; }
  });
  get('invoice-cancel-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      await send(`/api/cobrancas/${selectedInvoiceId}/cancelar`, 'PATCH', { motivo: get('invoice-cancel-reason').value.trim() });
      await loadFinance(); await loadHome();
    } catch (cause) { error('invoice-detail-error', cause.message); }
    finally { button.disabled = false; }
  });
  get('batch-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = get('batch-submit'); button.disabled = true; get('batch-error').hidden = true;
    const ids = [...get('batch-choices').querySelectorAll('input:checked')].map(input => Number(input.value));
    if (!ids.length) { error('batch-error', 'Selecione pelo menos uma diária.'); button.disabled = false; return; }
    try {
      await send('/api/pagamento-lotes', 'POST', { diarista_id: selectedWorkerId, diaria_ids: ids,
        data_pagamento: get('batch-date').value, forma: get('batch-method').value.trim() });
      get('batch-dialog').close(); await loadFinance(); await loadHome();
    } catch (cause) { error('batch-error', cause.message); }
    finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => get(button.dataset.closeDialog).close()));
})();
