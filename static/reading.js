(() => {
  const pick = selector => document.querySelector(selector);
  const parser = window.DirectReadingParser;
  const maxFileBytes = 10 * 1024 * 1024;
  const tesseractUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  const workerUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  const coreUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0';
  const pdfUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
  const pdfWorkerUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  let ocrWorker, pdfLibrary, pending = [];
  let loadingPending = false;
  let lastOcrConfidence = 100;

  function feedback(message, error = false) {
    const box = pick('#reading-feedback');
    box.textContent = message;
    box.classList.toggle('error', error);
    box.hidden = !message;
  }
  function showFiles() {
    const files = [...pick('#reading-file').files];
    pick('#reading-file-name').textContent = files.length ? files.map(file => file.name).join(' · ') : 'Nenhum arquivo selecionado · até 10 MB por arquivo e 20 páginas por PDF';
    pick('#reading-remove-file').hidden = !files.length;
  }
  function script(url) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const element = document.createElement('script');
      element.src = url;
      element.onload = resolve;
      element.onerror = () => reject(new Error('Não foi possível carregar a leitura de imagens. Confira a internet e tente novamente.'));
      document.head.append(element);
    });
  }
  async function ocr(source) {
    if (!ocrWorker) {
      feedback('Carregando o reconhecimento de texto em português no aparelho. A primeira leitura pode demorar...');
      await script(tesseractUrl);
      ocrWorker = await Tesseract.createWorker('por', 1, {
        workerPath: workerUrl, corePath: coreUrl,
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      });
    }
    const result = await ocrWorker.recognize(source);
    lastOcrConfidence = Math.min(lastOcrConfidence, Number(result.data.confidence ?? 100));
    return result.data.text || '';
  }
  async function pdfText(file) {
    if (!pdfLibrary) {
      pdfLibrary = await import(pdfUrl);
      pdfLibrary.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    }
    const documentTask = pdfLibrary.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await documentTask.promise;
    if (pdf.numPages > 20) throw new Error(`${file.name}: o PDF ultrapassa 20 páginas.`);
    const pages = [];
    try {
      for (let index = 1; index <= pdf.numPages; index++) {
        feedback(`Lendo ${file.name} · página ${index} de ${pdf.numPages}...`);
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        let text = '';
        let y = null;
        for (const item of content.items) {
          if (!item.str) continue;
          const nextY = item.transform?.[5];
          if (y !== null && nextY !== undefined && Math.abs(y - nextY) > 3) text += '\n';
          else if (text && !text.endsWith('\n')) text += ' ';
          text += item.str;
          if (item.hasEOL) text += '\n';
          y = nextY;
        }
        if (text.trim().length < 40) {
          const viewport = page.getViewport({ scale: 1.8 });
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 2500 / Math.max(viewport.width, viewport.height));
          canvas.width = Math.round(viewport.width * scale);
          canvas.height = Math.round(viewport.height * scale);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: 1.8 * scale }) }).promise;
          text = await ocr(canvas);
          canvas.width = canvas.height = 0;
        }
        pages.push(text.trim());
        page.cleanup();
      }
    } finally { await pdf.destroy(); }
    return pages.join('\n\n');
  }
  async function fileText(file) {
    if (file.size > maxFileBytes) throw new Error(`${file.name}: tamanho acima de 10 MB.`);
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfText(file);
    if (!file.type.startsWith('image/')) throw new Error(`${file.name}: use uma foto ou PDF.`);
    feedback(`Reconhecendo texto de ${file.name}...`);
    return ocr(file);
  }
  const body = value => JSON.stringify(value);
  async function getData() {
    const [workers, orders, stores, drafts, tariffs] = await Promise.all([
      request('/api/diaristas'), request('/api/pedidos'), request('/api/lojas'),
      request('/api/leituras-pendentes'), request('/api/tarifas').catch(() => ({ setores: [] })),
    ]);
    return { workers, orders, stores, drafts, sectors: (tariffs.setores || []).map(item => item.setor) };
  }
  function tag(label, className) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = label;
    return element;
  }
  function resultCard(item, state, description, onUndo = null) {
    const card = document.createElement('article'); card.className = `reading-item ${state}`;
    const head = document.createElement('div'); head.className = 'reading-item-head';
    const title = document.createElement('strong');
    title.textContent = item.tipo === 'diarista' ? (item.dados.nome || 'Diarista sem nome') : item.tipo === 'pedido' ? [item.dados.supermercado, item.dados.unidade].filter(Boolean).join(' · ') || 'Pedido sem loja' : 'Tipo não identificado';
    head.append(title, tag(state === 'saved' ? 'Registrado' : state === 'duplicate' ? 'Já existente' : state === 'pending' ? 'Pendente' : 'Erro', 'reading-state'));
    const detail = document.createElement('p'); detail.textContent = description;
    card.append(head, detail);
    if (item.avisos?.length) {
      const note = document.createElement('small'); note.textContent = item.avisos.join(' '); card.append(note);
    }
    if (item.tipo !== 'indefinido') {
      const detail = document.createElement('details'); detail.className = 'reading-identified';
      const summary = document.createElement('summary'); summary.textContent = 'Dados identificados';
      const values = document.createElement('pre'); values.textContent = JSON.stringify(item.dados, null, 2);
      detail.append(summary, values); card.append(detail);
    }
    if (onUndo) {
      const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'text-button'; undo.textContent = 'Desfazer este registro';
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        try { await onUndo(); card.querySelector('.reading-state').textContent = 'Desfeito'; undo.remove(); }
        catch (error) { const note = document.createElement('small'); note.textContent = `Não foi possível desfazer: ${error.message}`; card.append(note); undo.disabled = false; }
      });
      card.append(undo);
    }
    return card;
  }
  function orderKey(order) { return parser.fingerprint({ tipo: 'pedido', dados: order }); }
  async function processItem(item, existing) {
    const cpf = item.dados.cpf;
    const draftKey = `rascunho:${parser.textKey(item.texto)}`;
    const duplicate = item.tipo === 'diarista' ? cpf && existing.workers.has(cpf) : item.tipo === 'pedido' ? existing.orders.has(item.chave) : false;
    if (duplicate) return { state: 'duplicate', description: 'Registro já existe; nenhum dado foi sobrescrito.' };
    if (item.faltando.length) {
      if (existing.drafts.has(draftKey)) return { state: 'duplicate', description: 'Esta pendência já está salva.' };
      try {
        await request('/api/leituras-pendentes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ ...item, chave: draftKey }) });
        existing.drafts.add(draftKey);
        return { state: 'pending', description: `Falta confirmar: ${item.faltando.join(', ')}.` };
      } catch (error) { return { state: 'error', description: `Não foi possível salvar a pendência: ${error.message}` }; }
    }
    try {
      let saved;
      if (item.tipo === 'diarista') {
        saved = await request('/api/diaristas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(item.dados) });
        existing.workers.add(cpf);
      } else if (item.tipo === 'pedido') {
        saved = await request('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(item.dados) });
        existing.orders.add(item.chave);
      }
      const previous = existing.draftRecords.filter(record => record.status === 'pendente' &&
        (item.tipo === 'diarista' ? record.tipo === 'diarista' && record.dados.cpf === cpf : record.chave === item.chave));
      for (const old of previous) {
        try { await request(`/api/leituras-pendentes/${old.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body({ status: 'resolvido' }) }); }
        catch { /* O registro principal foi salvo; a pendência pode ser resolvida pela lista. */ }
      }
      return { state: 'saved', id: saved.id, entity: item.tipo === 'pedido' ? 'pedidos' : 'diaristas', description: item.tipo === 'pedido' ? `${item.dados.turnos.length} dia(s) · ${item.dados.setor} · ${item.dados.quantidade_diaristas} diarista(s) por dia.` : `CPF ${cpf} · ${item.dados.setores.join(', ')}.` };
    } catch (error) {
      if (!existing.drafts.has(draftKey)) {
        try {
          await request('/api/leituras-pendentes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: body({ ...item, chave: draftKey, faltando: [`Corrigir falha ao registrar: ${error.message}`] }) });
          existing.drafts.add(draftKey);
          return { state: 'pending', description: `Não foi possível registrar; informações preservadas para revisão: ${error.message}` };
        } catch { /* O erro original aparece no resultado. */ }
      }
      return { state: 'error', description: `Falha ao registrar: ${error.message}` };
    }
  }
  async function submit(event) {
    event.preventDefault();
    const typed = pick('#reading-text').value.trim();
    const files = [...pick('#reading-file').files];
    if (!typed && !files.length) return feedback('Cole uma mensagem ou anexe fotos e PDFs.', true);
    const button = pick('#reading-submit'); button.disabled = true; button.textContent = 'Lendo e registrando...';
    feedback('Buscando cadastros, pedidos e lojas...');
    const resultArea = pick('#reading-result'); resultArea.hidden = false;
    const list = pick('#reading-result-items'); list.replaceChildren();
    const counts = { saved: 0, pending: 0, duplicate: 0, error: 0 };
    try {
      const data = await getData();
      const existing = {
        workers: new Set(data.workers.map(row => row.cpf)),
        orders: new Set(data.orders.map(orderKey)),
        drafts: new Set(data.drafts.filter(row => row.status === 'pendente').map(row => row.chave)),
        draftRecords: data.drafts,
      };
      const sources = [];
      if (typed) sources.push({ name: 'Texto colado', text: typed });
      for (const file of files) {
        try { lastOcrConfidence = 100; sources.push({ name: file.name, text: await fileText(file), confidence: lastOcrConfidence }); }
        catch (error) { counts.error++; list.append(resultCard({ tipo: 'indefinido', dados: {} }, 'error', error.message)); }
      }
      for (const source of sources) {
        const parts = parser.parse(source.text, { stores: data.stores, sectors: data.sectors, today: orderToday() });
        if (!parts.length) { counts.error++; list.append(resultCard({ tipo: 'indefinido', dados: {} }, 'error', `${source.name}: nenhum texto reconhecido.`)); continue; }
        for (const item of parts) {
          if (source.confidence < 60) {
            item.faltando.push('Conferir texto da imagem pouco legível');
            item.avisos = [...(item.avisos || []), `Confiança do OCR: ${Math.round(source.confidence)}%.`];
          }
          feedback(`Registrando ${source.name} · ${counts.saved + counts.pending + counts.duplicate + counts.error + 1} registro(s) processado(s)...`);
          const outcome = await processItem(item, existing);
          counts[outcome.state]++;
          const undo = outcome.state === 'saved' && (outcome.entity === 'pedidos' || !window.directRemote || window.directRemote.role === 'admin') ? async () => {
            await request(`/api/${outcome.entity}/${outcome.id}`, { method: 'DELETE' });
            await Promise.all([load(), loadOrders(), loadPending()]);
          } : null;
          list.append(resultCard(item, outcome.state, outcome.description, undo));
        }
      }
      pick('#reading-result-summary').textContent = `${counts.saved} registrado(s) · ${counts.pending} pendente(s) · ${counts.duplicate} já existente(s) · ${counts.error} erro(s).`;
      feedback(counts.error ? 'Processamento concluído com erros. Confira o resultado abaixo.' : 'Processamento concluído. Confira o resultado abaixo.', !!counts.error);
      await Promise.all([load(), loadOrders(), loadPending()]);
      resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { feedback(`Não foi possível concluir a importação: ${error.message}`, true); }
    finally { button.disabled = false; button.textContent = '✦ Ler e registrar tudo'; }
  }
  function fillDiarista(d, pendingId) {
    window.location.hash = '#diaristas'; openForm();
    window.directPendingForm = { id: pendingId, tipo: 'diarista' };
    for (const key of ['nome', 'cpf', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'local_trabalho', 'observacoes_locomocao']) pick(`#${key}`).value = d[key] || '';
    pick('#setores').value = (d.setores || []).join(', ');
    document.querySelectorAll('input[name="trabalhando"]').forEach(input => { input.checked = d.trabalhando !== null && input.value === String(d.trabalhando); });
    document.querySelectorAll('input[name="pode_se_deslocar"]').forEach(input => { input.checked = d.pode_se_deslocar !== null && input.value === String(d.pode_se_deslocar); });
    toggleConditional();
    const transport = (d.transporte || '').toLowerCase();
    const mapped = transport.includes('ônibus') || transport.includes('transporte público') ? 'Transporte público'
      : ['moto', 'carro', 'bicicleta'].some(name => transport.includes(name)) ? 'Veículo próprio'
      : transport.includes('aplicativo') || transport.includes('táxi') ? 'Aplicativo / táxi'
      : transport ? 'Outros meios' : '';
    pick('#transporte').value = mapped;
    if (d.disponibilidade?.length) {
      const anyHours = d.disponibilidade.every(slot => slot.inicio === '00:00' && slot.fim === '23:59');
      setRadio('horario_tipo', anyHours ? 'qualquer' : 'especifico');
      updateScheduleMode();
    }
    for (const slot of d.disponibilidade || []) {
      const row = [...document.querySelectorAll('.day-row')].find(node => node.dataset.day === slot.dia);
      if (!row) continue;
      row.querySelector('.day-enabled').checked = true;
      row.querySelector('.day-enabled').dispatchEvent(new Event('change'));
      row.querySelector('.day-start').value = slot.inicio;
      row.querySelector('.day-end').value = slot.fim;
    }
    if (typeof formatCpf === 'function') pick('#cpf').value = formatCpf(pick('#cpf').value);
    if (typeof formatCep === 'function') pick('#cep').value = formatCep(pick('#cep').value);
  }
  function fillPedido(p, pendingId) {
    window.location.hash = '#pedidos'; openOrderForm();
    window.directPendingForm = { id: pendingId, tipo: 'pedido' };
    pick('#order-market').value = p.supermercado || '';
    pick('#order-unit').value = p.unidade || '';
    pick('#order-contact').value = p.contato || '';
    pick('#order-sector').value = p.setor || '';
    pick('#order-quantity').value = p.quantidade_diaristas || 1;
    pick('#order-notes').value = p.observacoes || '';
    pick('#order-shifts').replaceChildren();
    if (p.turnos?.length) p.turnos.forEach(addOrderShift); else addOrderShift();
    updateOrderStoreOptions();
    updateOrderPreview();
  }
  function pendingCard(item) {
    const card = resultCard({ ...item, dados: item.dados }, 'pending', `Falta confirmar: ${(item.faltando || []).join(', ')}.`);
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Ver texto reconhecido';
    const original = document.createElement('pre'); original.textContent = item.texto;
    details.append(summary, original); card.append(details);
    const actions = document.createElement('div'); actions.className = 'reading-item-actions';
    if (item.tipo !== 'indefinido') {
      const edit = document.createElement('button'); edit.className = 'button button-outline'; edit.type = 'button'; edit.textContent = 'Abrir e completar';
      edit.addEventListener('click', () => item.tipo === 'diarista' ? fillDiarista(item.dados, item.id) : fillPedido(item.dados, item.id)); actions.append(edit);
    }
    const resolve = document.createElement('button'); resolve.className = 'button button-quiet'; resolve.type = 'button'; resolve.textContent = 'Marcar resolvido';
    resolve.addEventListener('click', async () => { try { await request(`/api/leituras-pendentes/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body({ status: 'resolvido' }) }); await loadPending(); } catch (error) { feedback(error.message, true); } });
    actions.append(resolve); card.append(actions);
    return card;
  }
  async function loadPending() {
    if (loadingPending) return;
    loadingPending = true;
    try {
      pending = (await request('/api/leituras-pendentes')).filter(item => item.status === 'pendente');
      const area = pick('#reading-pending-items'); area.replaceChildren();
      if (!pending.length) { const empty = document.createElement('p'); empty.className = 'reading-empty'; empty.textContent = 'Nenhuma informação pendente.'; area.append(empty); }
      else pending.forEach(item => area.append(pendingCard(item)));
    } catch (error) { const area = pick('#reading-pending-items'); area.textContent = `Não foi possível carregar as pendências: ${error.message}`; }
    finally { loadingPending = false; }
  }
  window.directResolvePendingForm = async tipo => {
    const current = window.directPendingForm;
    if (!current || current.tipo !== tipo) return null;
    window.directPendingForm = null;
    try {
      await request(`/api/leituras-pendentes/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body({ status: 'resolvido' }) });
      await loadPending();
      return null;
    } catch (error) {
      return `Registro salvo, mas não foi possível marcar a pendência como resolvida: ${error.message}`;
    }
  };
  for (const id of ['#form-dialog', '#order-dialog']) {
    pick(id).addEventListener('close', () => { window.directPendingForm = null; });
  }
  pick('#reading-form').addEventListener('submit', submit);
  pick('#reading-file').addEventListener('change', showFiles);
  pick('#reading-remove-file').addEventListener('click', () => { pick('#reading-file').value = ''; showFiles(); });
  window.addEventListener('hashchange', () => { if (location.hash === '#leitura') loadPending(); });
  if (location.hash === '#leitura') loadPending();
})();
