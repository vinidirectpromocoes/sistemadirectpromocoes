const STORE_NETWORKS = ['Super do Povo', 'Super Lagoa', 'Fazendinha', 'Hipermarket', 'Pinheiro', 'Variedades'];
let storeRecords = [];
let editingStoreId = null;

function storeFeedback(message, error = false) {
  const box = document.querySelector('#stores-feedback');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
  clearTimeout(storeFeedback.timer);
  storeFeedback.timer = setTimeout(() => { box.hidden = true; }, 6000);
}

function storeElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function storeAddress(item) {
  return [item.endereco, item.bairro, `${item.cidade}/${item.uf}`].filter(Boolean).join(' · ');
}

async function copyStore(item) {
  if (item.situacao === 'revisar' && !window.confirm(`O endereço da loja ${item.nome} precisa de conferência. Deseja copiá-lo mesmo assim?`)) return;
  const content = `*Rede:* ${item.rede}\n*Loja:* ${item.nome}\n*Endereço:* ${[item.endereco, item.bairro, `${item.cidade}/${item.uf}`].filter(Boolean).join(', ')}`;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(content);
    else {
      const input = document.createElement('textarea');
      input.value = content; input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.append(input); input.select();
      const copied = document.execCommand('copy'); input.remove();
      if (!copied) throw new Error('Não foi possível copiar.');
    }
    storeFeedback(`Dados de ${item.nome} copiados. Cole na mensagem para o diarista.`);
  } catch (error) { storeFeedback(`Falha ao copiar: ${error.message}`, true); }
}

function renderStores() {
  document.querySelector('#store-total-count').textContent = storeRecords.length;
  document.querySelector('#store-review-count').textContent = storeRecords.filter(item => item.situacao === 'revisar').length;
  const cityFilter = document.querySelector('#stores-city-filter');
  const previousCity = cityFilter.value;
  cityFilter.replaceChildren(new Option('Todas as cidades', ''));
  [...new Set(storeRecords.map(item => item.cidade))].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(city => cityFilter.add(new Option(city, city)));
  cityFilter.value = previousCity;
  const query = document.querySelector('#stores-search').value.trim().toLocaleLowerCase('pt-BR');
  const network = document.querySelector('#stores-network-filter').value;
  const city = cityFilter.value;
  const rows = storeRecords.filter(item => (!network || item.rede === network) && (!city || item.cidade === city) && (!query || `${item.rede} ${item.nome} ${item.endereco} ${item.bairro} ${item.cidade}`.toLocaleLowerCase('pt-BR').includes(query)));
  document.querySelector('#stores-empty').hidden = rows.length > 0;
  const groups = document.querySelector('#stores-groups'); groups.replaceChildren();
  STORE_NETWORKS.forEach(rede => {
    const entries = rows.filter(item => item.rede === rede);
    if (!entries.length) return;
    const section = storeElement('section', 'store-group');
    const heading = storeElement('div', 'store-group-heading');
    heading.append(storeElement('h3', '', rede), storeElement('span', '', `${entries.length} ${entries.length === 1 ? 'loja' : 'lojas'}`));
    section.append(heading);
    const list = storeElement('div', 'store-list');
    entries.forEach(item => {
      const card = storeElement('article', 'store-item');
      const info = storeElement('div', 'store-info');
      const title = storeElement('div', 'store-title');
      title.append(storeElement('strong', '', item.nome));
      title.append(storeElement('span', item.situacao === 'confirmado' ? 'store-state ready' : 'store-state review', item.situacao === 'confirmado' ? 'Endereço confirmado' : 'Conferir endereço'));
      info.append(title, storeElement('p', 'store-address', storeAddress(item)));
      const guidance=DirectMessagesModel.guidance(item);if(guidance){const d=storeElement('details','profile-more'),s=storeElement('summary','','Orientações para a diária'),t=storeElement('p','automation-guidance',guidance.replace(/\*/g,''));d.append(s,t);info.append(d);}
      if (item.observacao) info.append(storeElement('p', 'store-note', item.observacao));
      const source = storeElement('a', 'store-source', 'Ver fonte ↗');
      if (item.fonte_url) { source.href = item.fonte_url; source.target = '_blank'; source.rel = 'noopener noreferrer'; info.append(source); }
      const actions = storeElement('div', 'store-actions');
      const copy = storeElement('button', 'button button-outline store-copy');
      copy.type = 'button'; copy.setAttribute('aria-label', `Copiar dados da loja ${item.nome}, ${item.rede}`);
      copy.title = 'Copiar dados';
      const copyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      copyIcon.setAttribute('viewBox', '0 0 24 24'); copyIcon.setAttribute('fill', 'none'); copyIcon.setAttribute('stroke', 'currentColor');
      copyIcon.setAttribute('stroke-width', '1.8'); copyIcon.setAttribute('stroke-linecap', 'round'); copyIcon.setAttribute('stroke-linejoin', 'round');
      copyIcon.setAttribute('aria-hidden', 'true');
      const copyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      copyPath.setAttribute('d', 'M8 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-4 4H3v12a2 2 0 0 0 2 2h11');
      copyIcon.append(copyPath);
      copy.append(copyIcon, storeElement('span', 'button-label', 'Copiar dados'));
      copy.addEventListener('click', () => copyStore(item));
      const edit = storeElement('button', 'text-button', 'Editar');
      edit.type = 'button'; edit.setAttribute('aria-label', `Editar loja ${item.nome}, ${item.rede}`);
      edit.addEventListener('click', () => openStoreForm(item));
      if(window.DirectManagementUI){const report=storeElement('button','button button-outline','▧ Relatório');report.type='button';report.title='Relatório mensal desta loja';report.setAttribute('aria-label','Relatório mensal de '+item.nome);report.hidden=window.directRemote?.role==='consulta';report.onclick=()=>DirectManagementUI.storeReport(item);actions.append(report);if(!window.directRemote||['admin','operacao'].includes(window.directRemote.role)){const link=storeElement('button','button button-outline','↗ Link da loja');link.type='button';link.onclick=()=>DirectManagementUI.storeLink(item);actions.append(link);}}
      actions.append(copy, edit); card.append(info, actions); list.append(card);
    });
    section.append(list); groups.append(section);
  });
}

async function loadStores() {
  try { storeRecords = await request('/api/lojas'); renderStores(); }
  catch (error) { storeFeedback(`Não foi possível carregar as lojas: ${error.message}`, true); }
}

function openStoreForm(item = null) {
  editingStoreId = item?.id || null;
  document.querySelector('#store-form').reset();
  document.querySelector('#store-form-error').hidden = true;
  document.querySelector('#store-dialog-title').textContent = item ? 'Editar loja' : 'Nova loja';
  document.querySelector('#store-save-button').textContent = item ? 'Salvar alterações' : 'Salvar loja';
  document.querySelector('#store-network').value = item?.rede || STORE_NETWORKS[0];
  document.querySelector('#store-name').value = item?.nome || '';
  document.querySelector('#store-address').value = item?.endereco || '';
  document.querySelector('#store-district').value = item?.bairro || '';
  document.querySelector('#store-city').value = item?.cidade || 'Fortaleza';
  document.querySelector('#store-source').value = item?.fonte_url || '';
  document.querySelector('#store-status').value = item?.situacao || 'revisar';
  document.querySelector('#store-note').value = item?.observacao || '';
  for(const k of ['responsavel','telefone_contato','entrada','apresentacao','uniforme','orientacoes'])document.getElementById('store-'+k).value=item?.[k]||'';
  document.querySelector('#store-dialog').showModal();
  document.querySelector('#store-name').focus();
}

async function saveStore(event) {
  event.preventDefault();
  const payload = {
    rede: document.querySelector('#store-network').value,
    nome: document.querySelector('#store-name').value,
    endereco: document.querySelector('#store-address').value,
    bairro: document.querySelector('#store-district').value,
    cidade: document.querySelector('#store-city').value,
    fonte_url: document.querySelector('#store-source').value,
    situacao: document.querySelector('#store-status').value,
    observacao: document.querySelector('#store-note').value,
  };
  for(const k of ['responsavel','telefone_contato','entrada','apresentacao','uniforme','orientacoes'])payload[k]=document.getElementById('store-'+k).value.trim();
  const button = document.querySelector('#store-save-button'); button.disabled = true;
  try {
    await request(editingStoreId ? `/api/lojas/${editingStoreId}` : '/api/lojas', {method: editingStoreId ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
    document.querySelector('#store-dialog').close();
    await loadStores();
    storeFeedback(editingStoreId ? 'Loja atualizada.' : 'Loja cadastrada.');
  } catch (error) {
    const box = document.querySelector('#store-form-error'); box.textContent = error.message; box.hidden = false;
  } finally { button.disabled = false; }
}

STORE_NETWORKS.forEach(name => {
  document.querySelector('#stores-network-filter').add(new Option(name, name));
  document.querySelector('#store-network').add(new Option(name, name));
});
document.querySelector('#new-store-button').addEventListener('click', () => openStoreForm());
document.querySelector('#store-close-button').addEventListener('click', () => document.querySelector('#store-dialog').close());
document.querySelector('#store-cancel-button').addEventListener('click', () => document.querySelector('#store-dialog').close());
document.querySelector('#store-form').addEventListener('submit', saveStore);
document.querySelector('#stores-search').addEventListener('input', renderStores);
document.querySelector('#stores-network-filter').addEventListener('change', renderStores);
document.querySelector('#stores-city-filter').addEventListener('change', renderStores);
document.querySelector('#store-dialog').addEventListener('click', event => {
  const dialog = event.currentTarget, rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
