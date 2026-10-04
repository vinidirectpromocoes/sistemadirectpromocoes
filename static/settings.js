let settingsData = null;
let settingsLoading = null;
let editingSectorRateId = null;

function settingsMessage(value, error = false) {
  const box = document.querySelector('#settings-feedback');
  box.textContent = value;
  box.classList.toggle('error', error);
  box.hidden = false;
}

function settingsNode(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function settingsAmount(value) {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Math.round(Number(text) * 100);
  return amount > 0 && amount <= 10000000000 ? amount : null;
}

function settingsInput(cents) { return (cents / 100).toFixed(2); }
function settingsMoney(cents) { return brl.format(cents / 100); }

function settingsField(label, cents) {
  const field = settingsNode('label', 'settings-field', label);
  const input = document.createElement('input');
  input.type = 'number'; input.min = '0.01'; input.step = '0.01'; input.inputMode = 'decimal';
  input.required = true; input.value = settingsInput(cents);
  field.append(input);
  return [field, input];
}

function renderNetworkRates() {
  const grid = document.querySelector('#settings-network-grid');
  grid.replaceChildren();
  settingsData.redes.forEach(item => {
    const card = settingsNode('form', 'settings-network-card');
    const title = settingsNode('h3', '', item.rede);
    const [receivedField, received] = settingsField('Recebido da rede por diária (R$)', item.valor_recebido_centavos);
    const [defaultField, defaultPay] = settingsField('Pago à diarista por diária (R$)', item.valor_padrao_centavos);
    const fields = settingsNode('div', 'settings-network-fields'); fields.append(receivedField, defaultField);
    const margin = settingsNode('div', 'settings-margin');
    const caption = settingsNode('span', '', 'Diferença bruta por diária');
    const value = settingsNode('strong');
    const updateMargin = () => {
      const income = settingsAmount(received.value);
      const payout = settingsAmount(defaultPay.value);
      value.textContent = income && payout ? settingsMoney(income - payout) : '—';
      margin.classList.toggle('negative', Boolean(income && payout && income < payout));
    };
    received.addEventListener('input', updateMargin); defaultPay.addEventListener('input', updateMargin);
    margin.append(caption, value); updateMargin();
    const save = settingsNode('button', 'button button-outline', 'Salvar valores'); save.type = 'submit';
    card.append(title, fields, margin, save);
    card.addEventListener('submit', async event => {
      event.preventDefault();
      const income = settingsAmount(received.value);
      const payout = settingsAmount(defaultPay.value);
      if (!income || !payout) return settingsMessage('Informe valores válidos maiores que zero, com até duas casas decimais.', true);
      save.disabled = true;
      try {
        await request(`/api/tarifas/redes/${item.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor_recebido: settingsInput(income), valor_padrao: settingsInput(payout) }) });
        await loadSettings();
        settingsMessage(`Valores de ${item.rede} atualizados.`);
      } catch (error) { settingsMessage(`Não foi possível salvar: ${error.message}`, true); }
      finally { save.disabled = false; }
    });
    grid.append(card);
  });
}

function renderPaymentCalendars() {
  const grid = document.querySelector('#settings-calendar-grid'); grid.replaceChildren();
  for (const item of settingsData.redes) {
    const form = settingsNode('form', 'settings-network-card');
    form.setAttribute('aria-label', `Calendário de ${item.rede}`);
    const title = settingsNode('h3', '', item.rede);
    const modeLabel = settingsNode('label', 'settings-field', 'Frequência de pagamento');
    const mode = document.createElement('select');
    for (const [value, caption] of [['quinzenal','Quinzenal'],['semanal','Semanal — semana seguinte']]) {
      const option = settingsNode('option', '', caption); option.value = value; mode.append(option);
    }
    mode.value = item.pagamento_semanal_dia == null ? 'quinzenal' : 'semanal'; modeLabel.append(mode);
    const weekLabel = settingsNode('label', 'settings-field', 'Prazo na semana seguinte');
    const weekly = document.createElement('select');
    for (const [value, caption] of [['5','Sexta-feira'],['6','Sábado (pode pagar na sexta)']]) {
      const option = settingsNode('option', '', caption); option.value = value; weekly.append(option);
    }
    weekly.value = String(item.pagamento_semanal_dia ?? 6); weekLabel.append(weekly);
    const fields = settingsNode('div', 'settings-network-fields');
    const inputs = ['Dias 1–15: dia de pagamento', 'Dias 16–31: dia do mês seguinte'].map((caption, index) => {
      const label = settingsNode('label', 'settings-field', caption);
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '31'; input.step = '1'; input.inputMode = 'numeric'; input.placeholder = 'Não informado';
      input.value = (index ? item.pagamento_segunda_quinzena : item.pagamento_primeira_quinzena) ?? '';
      label.append(input); fields.append(label); return input;
    });
    const status = settingsNode('p', 'section-help', item.pagamento_primeira_quinzena == null ? 'Prazo não informado. Diárias sem prazo não são consideradas atrasadas.' : `1–15 → dia ${item.pagamento_primeira_quinzena} deste mês · 16–31 → dia ${item.pagamento_segunda_quinzena} do próximo mês`);
    const showMode = () => {
      const isWeekly = mode.value === 'semanal'; fields.hidden = isWeekly; weekLabel.hidden = !isWeekly;
      inputs.forEach(input => input.disabled = isWeekly); weekly.disabled = !isWeekly;
      if (isWeekly) status.textContent = `Diárias de segunda a domingo: pagamento ${weekly.value === '6' ? 'até sábado' : 'na sexta-feira'} da semana seguinte. Atraso somente após esse prazo.`;
      else status.textContent = item.pagamento_primeira_quinzena == null ? 'Prazo não informado. Diárias sem prazo não são consideradas atrasadas.' : `1–15 → dia ${item.pagamento_primeira_quinzena} deste mês · 16–31 → dia ${item.pagamento_segunda_quinzena} do próximo mês`;
    };
    mode.addEventListener('change', showMode); weekly.addEventListener('change', showMode); showMode();
    const save = settingsNode('button', 'button button-outline', 'Salvar calendário'); save.type = 'submit';
    form.append(title, modeLabel, fields, weekLabel, status, save);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const days = inputs.map(input => mode.value === 'semanal' || input.value === '' ? null : Number(input.value));
      if (!(days.every(day => day === null)) && !days.every(day => Number.isInteger(day) && day >= 1 && day <= 31)) return settingsMessage('Preencha os dois dias, de 1 a 31, ou deixe ambos em branco.', true);
      save.disabled = true;
      try {
        await request(`/api/tarifas/redes/${item.id}/calendario`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pagamento_primeira_quinzena:days[0], pagamento_segunda_quinzena:days[1], pagamento_semanal_dia: mode.value === 'semanal' ? Number(weekly.value) : null})});
        await loadSettings(); await loadFinance(); await loadHome();
        settingsMessage(`Calendário de ${item.rede} atualizado para recebimentos e pagamentos.`);
      } catch (error) { settingsMessage(`Não foi possível salvar: ${error.message}`, true); }
      finally { save.disabled = false; }
    });
    grid.append(form);
  }
}

function renderSectorRates() {
  const list = document.querySelector('#settings-sector-list');
  list.replaceChildren();
  document.querySelector('#settings-sector-empty').hidden = settingsData.setores.length > 0;
  settingsData.setores.forEach(item => {
    const row = settingsNode('article', 'settings-sector-row');
    const identity = settingsNode('div', 'settings-sector-identity');
    const scope = item.rede || 'Todas as redes';
    identity.append(settingsNode('strong', '', item.setor), settingsNode('span', '', scope));
    const amounts = settingsNode('label', 'settings-sector-amounts', 'Pago por diária (R$)');
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0.01'; input.step = '0.01'; input.inputMode = 'decimal';
    input.placeholder = 'A preencher';
    input.value = item.valor_pago_centavos == null ? '' : settingsInput(item.valor_pago_centavos);
    input.setAttribute('aria-label', `Valor pago por diária para ${item.setor} em ${scope}`);
    amounts.append(input);
    const actions = settingsNode('div', 'settings-sector-actions');
    const save = settingsNode('button', 'button button-outline settings-sector-save', 'Salvar valor'); save.type = 'button';
    save.setAttribute('aria-label', `Salvar valor de ${item.setor} em ${scope}`);
    save.addEventListener('click', async () => {
      const amount = input.value.trim() ? settingsAmount(input.value) : null;
      if (input.value.trim() && !amount) return settingsMessage('Informe um valor maior que zero, com até duas casas decimais.', true);
      save.disabled = true;
      try {
        await request(`/api/tarifas/setores/${item.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rede: item.rede, setor: item.setor, valor_pago: amount == null ? null : settingsInput(amount) })
        });
        await loadSettings(); settingsMessage(`Valor de ${item.setor} salvo.`);
      } catch (error) { settingsMessage(`Não foi possível salvar: ${error.message}`, true); save.disabled = false; }
    });
    const edit = settingsNode('button', 'text-button', 'Editar'); edit.type = 'button';
    edit.setAttribute('aria-label', `Editar setor ${item.setor} em ${scope}`);
    edit.addEventListener('click', () => openSectorRate(item));
    const remove = settingsNode('button', 'text-button settings-remove', 'Excluir'); remove.type = 'button';
    remove.setAttribute('aria-label', `Excluir setor ${item.setor} em ${scope}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Excluir o setor ${item.setor} em ${scope}?`)) return;
      remove.disabled = true;
      try {
        await request(`/api/tarifas/setores/${item.id}`, { method: 'DELETE' });
        await loadSettings(); settingsMessage('Setor removido. A diária padrão da rede será usada.');
      } catch (error) { settingsMessage(`Não foi possível excluir: ${error.message}`, true); remove.disabled = false; }
    });
    actions.append(save, edit, remove); row.append(identity, amounts, actions); list.append(row);
  });
}

function renderExtraCosts() {
  const grid = document.querySelector('#settings-extra-grid');
  grid.replaceChildren();
  for (const network of settingsData.redes) {
    const saved = (settingsData.extras || []).find(item => item.rede === network.rede) || {};
    const form = settingsNode('form', 'settings-network-card');
    form.append(settingsNode('h3', '', network.rede));
    const fields = settingsNode('div', 'settings-network-fields');
    const inputs = {};
    for (const [key, label] of [['transporte', 'Transporte'], ['taxas', 'Taxas'], ['outros', 'Outros custos']]) {
      const field = settingsNode('label', 'settings-field', `${label} por diária (R$)`);
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '0.01';
      input.inputMode = 'decimal'; input.required = true;
      input.value = ((saved[`${key}_centavos`] || 0) / 100).toFixed(2);
      inputs[key] = input; field.append(input); fields.append(field);
    }
    const save = settingsNode('button', 'button button-outline', 'Salvar custos'); save.type = 'submit';
    form.append(fields, save);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
      if (Object.values(values).some(value => !/^\d+(?:[.,]\d{1,2})?$/.test(value) || Number(value.replace(',', '.')) > 100000))
        return settingsMessage('Informe custos de zero a R$ 100.000,00 com até duas casas decimais.', true);
      save.disabled = true;
      try {
        await request('/api/custos-extras', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rede: network.rede, ...values }) });
        await loadSettings();
        settingsMessage(`Custos extras de ${network.rede} atualizados.`);
        if (typeof loadFinance === 'function') await loadFinance();
      } catch (error) { settingsMessage(`Não foi possível salvar: ${error.message}`, true); save.disabled = false; }
    });
    grid.append(form);
  }
}

async function loadSettings() {
  if (settingsLoading) return settingsLoading;
  settingsLoading = (async () => {
    try {
      const [rates, extras] = await Promise.all([request('/api/tarifas'), request('/api/custos-extras')]);
      settingsData = { ...rates, extras };
      renderNetworkRates(); renderPaymentCalendars(); renderSectorRates(); renderExtraCosts();
      document.querySelector('#staff-settings').hidden = window.directRemote?.role !== 'admin';
      if (window.directRemote?.role === 'admin') await loadStaff();
      const select = document.querySelector('#sector-rate-network');
      select.replaceChildren(new Option('Todas as redes', ''));
      settingsData.redes.forEach(item => select.add(new Option(item.rede, item.rede)));
      return settingsData;
    } catch (error) {
      settingsMessage(`Não foi possível carregar os valores: ${error.message}`, true);
      throw error;
    } finally { settingsLoading = null; }
  })();
  return settingsLoading;
}

async function loadStaff() {
  const items = await request('/api/equipe');
  const list = document.querySelector('#staff-list'); list.replaceChildren();
  if (!items.length) { list.textContent = 'Nenhum funcionário autorizado ainda.'; return; }
  for (const item of items.sort((a, b) => a.email.localeCompare(b.email))) {
    const row = settingsNode('div', 'staff-row');
    const identity = settingsNode('div');
    identity.append(settingsNode('strong', '', item.email), settingsNode('small', '', `${{ operacao: 'Operação', financeiro: 'Financeiro', consulta: 'Consulta' }[item.role]} · ${item.active ? 'Ativo' : 'Bloqueado'}`));
    const toggle = settingsNode('button', 'button button-outline', item.active ? 'Bloquear' : 'Ativar'); toggle.type = 'button';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await request('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: item.email, role: item.role, active: !item.active }) });
        await loadStaff(); settingsMessage(`Acesso de ${item.email} ${item.active ? 'bloqueado' : 'ativado'}.`);
      } catch (error) { settingsMessage(error.message, true); toggle.disabled = false; }
    });
    row.append(identity, toggle); list.append(row);
  }
}

document.querySelector('#staff-form').addEventListener('submit', async event => {
  event.preventDefault();
  const email = document.querySelector('#staff-email').value.trim().toLowerCase();
  const role = document.querySelector('#staff-role').value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return settingsMessage('Informe um e-mail válido.', true);
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    await request('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role, active: true }) });
    event.currentTarget.reset(); await loadStaff(); settingsMessage(`E-mail ${email} autorizado. Agora crie a conta em Supabase Authentication → Users.`);
  } catch (error) { settingsMessage(error.message, true); }
  finally { button.disabled = false; }
});

function openSectorRate(item = null) {
  editingSectorRateId = item?.id ?? null;
  const form = document.querySelector('#sector-rate-form'); form.reset();
  document.querySelector('#sector-rate-error').hidden = true;
  document.querySelector('#sector-rate-title').textContent = item ? 'Editar setor' : 'Adicionar setor';
  document.querySelector('#sector-rate-save').textContent = item ? 'Salvar alterações' : 'Salvar setor';
  if (item) {
    document.querySelector('#sector-rate-network').value = item.rede || '';
    document.querySelector('#sector-rate-name').value = item.setor;
    document.querySelector('#sector-rate-value').value = item.valor_pago_centavos == null ? '' : settingsInput(item.valor_pago_centavos);
  }
  document.querySelector('#sector-rate-dialog').showModal();
  (item ? document.querySelector('#sector-rate-value') : document.querySelector('#sector-rate-network')).focus();
}

async function saveSectorRate(event) {
  event.preventDefault();
  const rede = document.querySelector('#sector-rate-network').value || null;
  const setor = document.querySelector('#sector-rate-name').value.trim().replace(/\s+/g, ' ');
  const amountText = document.querySelector('#sector-rate-value').value.trim();
  const amount = amountText ? settingsAmount(amountText) : null;
  const error = document.querySelector('#sector-rate-error');
  if ((rede && !settingsData?.redes.some(item => item.rede === rede)) || !setor || setor.length > 80 || (amountText && !amount)) {
    error.textContent = 'Informe um setor e, se preencher o valor, use um número maior que zero.'; error.hidden = false; return;
  }
  if (settingsData.setores.some(item => item.id !== editingSectorRateId && item.rede === rede && item.setor.toLocaleLowerCase('pt-BR') === setor.toLocaleLowerCase('pt-BR'))) {
    error.textContent = 'Esse setor já está cadastrado nessa abrangência. Use Editar para alterá-lo.'; error.hidden = false; return;
  }
  const save = document.querySelector('#sector-rate-save'); save.disabled = true;
  try {
    await request(editingSectorRateId ? `/api/tarifas/setores/${editingSectorRateId}` : '/api/tarifas/setores', {
      method: editingSectorRateId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rede, setor, valor_pago: amount == null ? null : settingsInput(amount) })
    });
    document.querySelector('#sector-rate-dialog').close();
    await loadSettings(); settingsMessage(editingSectorRateId ? 'Valor do setor atualizado.' : 'Setor e valor cadastrados.');
  } catch (cause) { error.textContent = cause.message; error.hidden = false; }
  finally { save.disabled = false; }
}

async function suggestedDailyPayout(item) {
  if (!settingsData) await loadSettings();
  const network = settingsData.redes.find(rate => item.local === rate.rede || item.local.startsWith(`${rate.rede} ·`));
  if (!network) return null;
  const sectorName = item.setor.trim().toLocaleLowerCase('pt-BR');
  const specific = settingsData.setores.find(rate => rate.rede === network.rede && rate.valor_pago_centavos != null && rate.setor.toLocaleLowerCase('pt-BR') === sectorName);
  const general = settingsData.setores.find(rate => rate.rede == null && rate.valor_pago_centavos != null && rate.setor.toLocaleLowerCase('pt-BR') === sectorName);
  return { cents: specific?.valor_pago_centavos ?? general?.valor_pago_centavos ?? network.valor_padrao_centavos, network: network.rede, specific: Boolean(specific || general) };
}

document.querySelector('#new-sector-rate').addEventListener('click', () => openSectorRate());
document.querySelector('#sector-rate-form').addEventListener('submit', saveSectorRate);
document.querySelector('#sector-rate-close').addEventListener('click', () => document.querySelector('#sector-rate-dialog').close());
document.querySelector('#sector-rate-cancel').addEventListener('click', () => document.querySelector('#sector-rate-dialog').close());
document.querySelector('#sector-rate-dialog').addEventListener('click', event => {
  const dialog = event.currentTarget, rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
if (location.hash === '#configuracoes') loadSettings().catch(() => {});
