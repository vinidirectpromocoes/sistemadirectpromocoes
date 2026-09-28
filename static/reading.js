(() => {
  const pick = selector => document.querySelector(selector);
  const maxBytes = 3 * 1024 * 1024;
  let reading = null;

  function feedback(message, error = false) {
    const box = pick('#reading-feedback');
    box.textContent = message;
    box.classList.toggle('error', error);
    box.hidden = !message;
  }

  function displayFile() {
    const file = pick('#reading-file').files[0];
    pick('#reading-file-name').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Nenhum arquivo selecionado · PDF até 3 MB; fotos ajustadas automaticamente';
    pick('#reading-remove-file').hidden = !file;
  }

  function dataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Não foi possível abrir o arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function imageData(file) {
    if (file.size <= maxBytes && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return dataUrl(file);
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error('Não foi possível converter esta foto. Envie em JPG, PNG ou WebP.'); }
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.85, 0.72, 0.6]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) return dataUrl(blob);
    }
    throw new Error('A foto continua acima de 3 MB. Tente uma imagem menor.');
  }

  async function prepareFile(file) {
    if (!file) return null;
    if (file.type === 'application/pdf' && file.size > maxBytes) throw new Error('O PDF deve ter até 3 MB.');
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) throw new Error('Envie uma foto ou PDF.');
    const data = file.type === 'application/pdf' ? await dataUrl(file) : await imageData(file);
    const match = /^data:([^;]+);base64,(.+)$/.exec(data);
    if (!match) throw new Error('Não foi possível preparar o arquivo.');
    return { mime: match[1], base64: match[2] };
  }

  function line(label, value) {
    const row = document.createElement('div');
    row.className = 'reading-field';
    const name = document.createElement('span'); name.textContent = label;
    const detail = document.createElement('strong'); detail.textContent = value || 'Não informado';
    if (!value) detail.className = 'reading-missing';
    row.append(name, detail);
    pick('#reading-result-fields').append(row);
  }

  function shortDate(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : value;
  }

  function readyToRegister(result) {
    if (result.tipo === 'diarista') {
      const d = result.diarista;
      const supportedTransport = [...pick('#transporte').options].some(option => option.value && option.value.toLowerCase() === d.transporte.toLowerCase());
      return Boolean(d.nome && validCpf(d.cpf) && d.setores.length && /^\d{8}$/.test(d.cep.replace(/\D/g, '')) && d.logradouro && d.numero && d.bairro &&
        d.trabalhando !== 'desconhecido' && (d.trabalhando !== 'sim' || d.local_trabalho) &&
        d.pode_se_deslocar !== 'desconhecido' && (d.pode_se_deslocar !== 'sim' || supportedTransport) &&
        d.disponibilidade.length && d.disponibilidade.every(s => s.inicio && s.fim && s.inicio < s.fim));
    }
    if (result.tipo === 'pedido') {
      const p = result.pedido;
      return Boolean(p.supermercado && p.setor && Number.isInteger(p.quantidade_diaristas) && p.quantidade_diaristas >= 1 && p.quantidade_diaristas <= 100 &&
        p.turnos.length && p.turnos.every(s => s.data && s.inicio && s.fim && s.inicio < s.fim) &&
        new Set(p.turnos.map(s => s.data)).size === p.turnos.length);
    }
    return false;
  }

  function renderResult(result) {
    const fields = pick('#reading-result-fields'); fields.replaceChildren();
    const warnings = Array.isArray(result.avisos) ? [...result.avisos] : [];
    const kind = result.tipo;
    pick('#reading-result-type').textContent = kind === 'pedido' ? 'Pedido' : kind === 'diarista' ? 'Diarista' : 'Não identificado';
    pick('#reading-review').hidden = kind === 'indefinido';
    pick('#reading-register').hidden = !readyToRegister(result);
    if (kind === 'diarista') {
      const d = result.diarista;
      line('Nome completo', d.nome);
      line('CPF', d.cpf);
      line('Setores de experiência', d.setores.join(', '));
      line('Endereço', [d.logradouro, d.numero, d.bairro, d.cep].filter(Boolean).join(' · '));
      line('Trabalho atual', d.trabalhando === 'desconhecido' ? '' : d.trabalhando === 'sim' ? `Sim · ${d.local_trabalho || 'local não informado'}` : 'Não');
      line('Disponibilidade', d.disponibilidade.map(s => `${s.dia}: ${s.inicio} às ${s.fim}`).join('; '));
      line('Locomoção', d.pode_se_deslocar === 'desconhecido' ? '' : `${d.pode_se_deslocar === 'sim' ? 'Pode se deslocar' : 'Não pode se deslocar'}${d.transporte ? ` · ${d.transporte}` : ''}`);
      if (d.observacoes_locomocao) line('Restrições de locomoção', d.observacoes_locomocao);
      if (!d.nome || !d.cpf || !d.setores.length || !d.cep || !d.logradouro || !d.numero || !d.bairro || !d.disponibilidade.length) warnings.push('Complete os campos obrigatórios no formulário de cadastro.');
      if (d.trabalhando === 'desconhecido' || d.pode_se_deslocar === 'desconhecido') warnings.push('Confirme trabalho atual e locomoção antes de salvar.');
      pick('#reading-result-summary').textContent = 'Confira o cadastro encontrado. Campos ausentes precisam ser completados.';
    } else if (kind === 'pedido') {
      const p = result.pedido;
      line('Rede e loja', [p.supermercado, p.unidade].filter(Boolean).join(' · '));
      line('Função / setor', p.setor);
      line('Diaristas por dia', p.quantidade_diaristas > 0 ? String(p.quantidade_diaristas) : '');
      line('Datas e horários', p.turnos.map(s => `${shortDate(s.data)} · ${s.inicio} às ${s.fim}`).join('; '));
      line('Quantidade de dias', p.turnos.length ? String(p.turnos.length) : '');
      if (p.contato) line('Contato', p.contato);
      if (!p.supermercado || !p.setor || p.quantidade_diaristas < 1 || !p.turnos.length) warnings.push('Complete os campos obrigatórios no formulário do pedido.');
      pick('#reading-result-summary').textContent = 'Confira rede, quantidade de pessoas, datas e horário antes de registrar.';
    } else {
      warnings.push('Escolha Diarista ou Pedido e tente novamente com mais informações.');
      pick('#reading-result-summary').textContent = 'Não foi possível determinar o tipo de registro.';
    }
    const warningBox = pick('#reading-result-warnings');
    warningBox.replaceChildren();
    [...new Set(warnings)].forEach(warning => {
      const p = document.createElement('p'); p.textContent = warning; warningBox.append(p);
    });
    warningBox.hidden = !warningBox.children.length;
    pick('#reading-result').hidden = false;
    pick('#reading-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submit(event) {
    event.preventDefault();
    const texto = pick('#reading-text').value.trim();
    const file = pick('#reading-file').files[0];
    if (!texto && !file) return feedback('Cole uma mensagem ou anexe uma foto ou PDF.', true);
    const button = pick('#reading-submit'); button.disabled = true; button.textContent = 'Lendo dados...';
    feedback(''); pick('#reading-result').hidden = true;
    try {
      const arquivo = await prepareFile(file);
      const tipo = pick('input[name="reading-kind"]:checked').value;
      if (window.directRemote) reading = await window.directRemote.readAI({ tipo, texto, arquivo });
      else {
        const response = await fetch('/api/ler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, texto, arquivo }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.erro || 'Não foi possível ler os dados.');
        reading = data;
      }
      renderResult(reading);
    } catch (error) { feedback(error.message, true); }
    finally { button.disabled = false; button.textContent = '✦ Ler dados'; }
  }

  function fillDiarista(d) {
    window.location.hash = '#diaristas';
    openForm();
    for (const key of ['nome', 'cpf', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'local_trabalho', 'observacoes_locomocao']) {
      pick(`#${key}`).value = d[key] || '';
    }
    pick('#setores').value = d.setores.join(', ');
    const working = d.trabalhando === 'sim' ? 'true' : d.trabalhando === 'nao' ? 'false' : null;
    const mobility = d.pode_se_deslocar === 'sim' ? 'true' : d.pode_se_deslocar === 'nao' ? 'false' : null;
    document.querySelectorAll('input[name="trabalhando"]').forEach(input => { input.checked = input.value === working; });
    document.querySelectorAll('input[name="pode_se_deslocar"]').forEach(input => { input.checked = input.value === mobility; });
    toggleConditional();
    const transport = [...pick('#transporte').options].find(option => option.value.toLowerCase() === (d.transporte || '').toLowerCase());
    pick('#transporte').value = transport?.value || '';
    if (d.transporte && !transport) pick('#observacoes_locomocao').value = [d.transporte, d.observacoes_locomocao].filter(Boolean).join(' · ');
    const cleanDay = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/-feira$/, '');
    for (const slot of d.disponibilidade) {
      const row = [...document.querySelectorAll('.day-row')].find(item => item.dataset.day === cleanDay(slot.dia));
      if (!row || !/^\d{2}:\d{2}$/.test(slot.inicio) || !/^\d{2}:\d{2}$/.test(slot.fim)) continue;
      const checkbox = row.querySelector('.day-enabled'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
      row.querySelector('.day-start').value = slot.inicio;
      row.querySelector('.day-end').value = slot.fim;
    }
    if (typeof formatCpf === 'function') pick('#cpf').value = formatCpf(pick('#cpf').value);
    if (typeof formatCep === 'function') pick('#cep').value = formatCep(pick('#cep').value);
  }

  function fillPedido(p) {
    window.location.hash = '#pedidos';
    openOrderForm();
    pick('#order-market').value = p.supermercado || '';
    pick('#order-unit').value = p.unidade || '';
    pick('#order-contact').value = p.contato || '';
    pick('#order-sector').value = p.setor || '';
    pick('#order-quantity').value = p.quantidade_diaristas > 0 ? p.quantidade_diaristas : '';
    pick('#order-notes').value = p.observacoes || '';
    pick('#order-shifts').replaceChildren();
    if (p.turnos.length) p.turnos.forEach(addOrderShift);
    else {
      addOrderShift();
      const row = pick('#order-shifts').firstElementChild;
      row.querySelector('.order-shift-date').value = '';
      row.querySelector('.order-shift-start').value = '';
      row.querySelector('.order-shift-end').value = '';
    }
    updateOrderPreview();
  }

  pick('#reading-form').addEventListener('submit', submit);
  pick('#reading-file').addEventListener('change', displayFile);
  pick('#reading-remove-file').addEventListener('click', () => { pick('#reading-file').value = ''; displayFile(); });
  pick('#reading-review').addEventListener('click', () => {
    if (reading?.tipo === 'diarista') fillDiarista(reading.diarista);
    if (reading?.tipo === 'pedido') fillPedido(reading.pedido);
  });
  pick('#reading-register').addEventListener('click', () => {
    if (!reading || !readyToRegister(reading)) return;
    if (reading.tipo === 'diarista') {
      fillDiarista(reading.diarista);
      pick('#diarista-form').requestSubmit();
    } else if (reading.tipo === 'pedido') {
      fillPedido(reading.pedido);
      pick('#order-form').requestSubmit();
    }
  });
})();
