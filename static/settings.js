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

function renderSectorRates() {
  const list = document.querySelector('#settings-sector-list');
  list.replaceChildren();
  document.querySelector('#settings-sector-empty').hidden = settingsData.setores.length > 0;
  settingsData.setores.forEach(item => {
    const row = settingsNode('article', 'settings-sector-row');
    const identity = settingsNode('div', 'settings-sector-identity');
    identity.append(settingsNode('strong', '', item.setor), settingsNode('span', '', item.rede));
    const amounts = settingsNode('div', 'settings-sector-amounts');
    amounts.append(settingsNode('strong', '', settingsMoney(item.valor_pago_centavos)), settingsNode('small', '', 'por diária'));
    const actions = settingsNode('div', 'settings-sector-actions');
    const edit = settingsNode('button', 'text-button', 'Editar'); edit.type = 'button';
    edit.setAttribute('aria-label', `Editar valor do setor ${item.setor} em ${item.rede}`);
    edit.addEventListener('click', () => openSectorRate(item));
    const remove = settingsNode('button', 'text-button settings-remove', 'Excluir'); remove.type = 'button';
    remove.setAttribute('aria-label', `Excluir valor do setor ${item.setor} em ${item.rede}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Excluir o valor específico de ${item.setor} em ${item.rede}? A diária padrão da rede voltará a ser usada.`)) return;
      remove.disabled = true;
      try {
        await request(`/api/tarifas/setores/${item.id}`, { method: 'DELETE' });
        await loadSettings(); settingsMessage('Valor específico removido. A diária padrão da rede será usada.');
      } catch (error) { settingsMessage(`Não foi possível excluir: ${error.message}`, true); remove.disabled = false; }
    });
    actions.append(edit, remove); row.append(identity, amounts, actions); list.append(row);
  });
}

async function loadSettings() {
  if (settingsLoading) return settingsLoading;
  settingsLoading = (async () => {
    try {
      settingsData = await request('/api/tarifas');
      renderNetworkRates(); renderSectorRates();
      const select = document.querySelector('#sector-rate-network');
      select.replaceChildren(new Option('Selecione uma rede', ''));
      settingsData.redes.forEach(item => select.add(new Option(item.rede, item.rede)));
      return settingsData;
    } catch (error) {
      settingsMessage(`Não foi possível carregar os valores: ${error.message}`, true);
      throw error;
    } finally { settingsLoading = null; }
  })();
  return settingsLoading;
}

function openSectorRate(item = null) {
  editingSectorRateId = item?.id ?? null;
  const form = document.querySelector('#sector-rate-form'); form.reset();
  document.querySelector('#sector-rate-error').hidden = true;
  document.querySelector('#sector-rate-title').textContent = item ? 'Editar setor' : 'Adicionar setor';
  document.querySelector('#sector-rate-save').textContent = item ? 'Salvar alterações' : 'Salvar setor';
  if (item) {
    document.querySelector('#sector-rate-network').value = item.rede;
    document.querySelector('#sector-rate-name').value = item.setor;
    document.querySelector('#sector-rate-value').value = settingsInput(item.valor_pago_centavos);
  }
  document.querySelector('#sector-rate-dialog').showModal();
  (item ? document.querySelector('#sector-rate-value') : document.querySelector('#sector-rate-network')).focus();
}

async function saveSectorRate(event) {
  event.preventDefault();
  const rede = document.querySelector('#sector-rate-network').value;
  const setor = document.querySelector('#sector-rate-name').value.trim().replace(/\s+/g, ' ');
  const amount = settingsAmount(document.querySelector('#sector-rate-value').value);
  const error = document.querySelector('#sector-rate-error');
  if (!settingsData?.redes.some(item => item.rede === rede) || !setor || setor.length > 80 || !amount) {
    error.textContent = 'Selecione a rede e informe setor e valor válido maior que zero.'; error.hidden = false; return;
  }
  if (settingsData.setores.some(item => item.id !== editingSectorRateId && item.rede === rede && item.setor.toLocaleLowerCase('pt-BR') === setor.toLocaleLowerCase('pt-BR'))) {
    error.textContent = 'Esse setor já está cadastrado nessa rede. Use Editar para alterar o valor.'; error.hidden = false; return;
  }
  const save = document.querySelector('#sector-rate-save'); save.disabled = true;
  try {
    await request(editingSectorRateId ? `/api/tarifas/setores/${editingSectorRateId}` : '/api/tarifas/setores', {
      method: editingSectorRateId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rede, setor, valor_pago: settingsInput(amount) })
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
  const sector = settingsData.setores.find(rate => rate.rede === network.rede && rate.setor.toLocaleLowerCase('pt-BR') === item.setor.trim().toLocaleLowerCase('pt-BR'));
  return { cents: sector?.valor_pago_centavos ?? network.valor_padrao_centavos, network: network.rede, specific: Boolean(sector) };
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
