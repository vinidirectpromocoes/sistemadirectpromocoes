(() => {
  const pick = selector => document.querySelector(selector);
  const parser = window.DirectReadingParser;
  const assistant = window.DirectReadingDialogue;
  let review = null, applying = false;
  let sessionEpoch=0;
  const maxFileBytes = 10 * 1024 * 1024;
  const tesseractUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  const workerUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  const coreUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0';
  const pdfUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
  const pdfWorkerUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  let ocrWorker, pdfLibrary, pending = [];
  let loadingPending = false;
  let lastOcrConfidence = 100;
  let reviewPendingId = null;

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
    const pages = [];
    try {
      if (pdf.numPages > 20) throw new Error(`${file.name}: o PDF ultrapassa 20 páginas.`);
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
  async function getData(withFinance=false) {
    const [workers, orders, stores, drafts, tariffs, scales] = await Promise.all([
      request('/api/diaristas'), request('/api/pedidos'), request('/api/lojas'),
      request('/api/leituras-pendentes'), request('/api/tarifas').catch(() => ({ setores: [] })), request('/api/escalas'),
    ]);
    const role=window.directRemote?.role||null;
    const finance=withFinance&&(!role||['admin','financeiro'].includes(role))?await request('/api/financeiro'):[];
    return { workers, orders, stores, drafts, tariffs, scales, finance, role, today:orderToday(), sectors: (tariffs.setores || []).map(item => item.setor) };
  }
  function tag(label, className) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = label;
    return element;
  }
  function resultCard(item, state, description, onUndo = null, linkedOutcome = null) {
    const card = document.createElement('article'); card.className = `reading-item ${state}`;
    card.dataset.resultState = state;
    if(item.dados?.diarista_escalado) card.dataset.assignmentKey=item.dados.leitura_chave_operacao || parser.textKey(item.texto);
    const head = document.createElement('div'); head.className = 'reading-item-head';
    const title = document.createElement('strong');
    title.textContent = item.tipo === 'diarista' ? (item.dados.nome || 'Diarista sem nome') : item.tipo === 'pedido' ? [item.dados.supermercado, item.dados.unidade].filter(Boolean).join(' · ') || 'Pedido sem loja' : ['comando','atualizacao','acao'].includes(item.tipo)?assistant.describe(item)[0][1]:'Tipo não identificado';
    head.append(title, tag(state === 'saved' ? 'Registrado' : state === 'duplicate' ? 'Já existente' : state === 'pending' ? 'Pendente' : 'Erro', 'reading-state'));
    const detail = document.createElement('p'); detail.textContent = description;
    card.append(head, detail);
    if (item.fonte) {
      const source = document.createElement('small');
      source.textContent = `Origem: ${item.fonte}${item.confianca == null ? ' · texto recebido' : ` · leitura de imagem ${Math.round(item.confianca)}%${item.confianca < 75 ? ' · revisão obrigatória' : ''}`}`;
      card.append(source);
    }
    if (item.avisos?.length) {
      const note = document.createElement('small'); note.textContent = item.avisos.join(' '); card.append(note);
    }
    if (item.tipo !== 'indefinido') {
      const detail = document.createElement('details'); detail.className = 'reading-identified';
      const summary = document.createElement('summary'); summary.textContent = 'Dados identificados';
      const values = fields(item);
      detail.append(summary, values); card.append(detail);
    }
    if (item.tipo === 'diarista' && ['saved','duplicate'].includes(state)) {
      const complete = document.createElement('button'); complete.type='button'; complete.className='text-button'; complete.textContent='Completar no formulário';
      complete.addEventListener('click',()=>fillDiarista(item.dados)); card.append(complete);
    }
    if (item.dados?.diarista_escalado) {
      if (state === 'pending' && linkedOutcome?.canConfirm) {
        const save = document.createElement('button'); save.type='button'; save.className='button button-primary reading-link-save';
        save.textContent=linkedOutcome.needsRegistration ? 'Cadastrar diarista e salvar pedido' : 'Salvar pedido com escala';
        save.addEventListener('click', async () => {
          save.disabled=true;
          try {
            const data=await getData();
            const response=await saveLinked(item,data,true,linkedOutcome.pendingId);
            if(response.requires_registration) throw new Error('Confirme o cadastro do diarista.');
            const outcome=linkedResult(response);
            const savedCard=resultCard(item,outcome.state,outcome.description,null,outcome);
            const resultList=pick('#reading-result-items');
            const original=[...resultList.children].find(node=>node.dataset.assignmentKey===card.dataset.assignmentKey);
            if(original) original.replaceWith(savedCard); else resultList.append(savedCard);
            pick('#reading-result').hidden=false;
            updateResultSummary();
            await Promise.all([load(),loadOrders(),loadPending()]);
            feedback(outcome.description);
          } catch(error) { detail.textContent=`Não foi possível salvar: ${error.message}. As informações continuam nesta pendência.`; save.disabled=false; }
        });
        card.append(save);
      }
      if(linkedOutcome?.orderId) {
        const view=document.createElement('button'); view.type='button';view.className='text-button';view.textContent='Ver pedido e escala';
        view.addEventListener('click',async()=>{window.location.hash='#pedidos';await loadOrders();await openOrderDetail(linkedOutcome.orderId);});card.append(view);
      }
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
  function updateResultSummary() {
    const counts={saved:0,pending:0,duplicate:0,error:0};
    for(const card of pick('#reading-result-items').querySelectorAll('[data-result-state]')) counts[card.dataset.resultState]++;
    pick('#reading-result-summary').textContent=`${counts.saved} registrado(s) · ${counts.pending} pendente(s) · ${counts.duplicate} já existente(s) · ${counts.error} erro(s).`;
  }
  function linkedResult(saved) {
    const duplicate=!saved.cadastro_criado&&!saved.pedido_criado&&!saved.escalas_criadas.length;
    return {state:duplicate?'duplicate':'saved',entity:'pedido_escalado',orderId:saved.pedido_id,description:`${saved.cadastro_criado?'Cadastro básico criado':'Cadastro existente preservado'} · ${saved.nome} · ${saved.dias} dia(s) escalado(s). ${saved.situacao==='confirmado'?'Pedido confirmado.':saved.situacao==='em_selecao'?'Pedido em seleção: ainda há vagas.':''} ${duplicate?'Esta escala já estava registrada.':''}`};
  }
  async function saveLinked(item, data, confirm, pendingId) {
    const rows=data.orderRows || (Array.isArray(data.orders)?data.orders:[]);
    const matches=rows.filter(order=>orderKey(order)===item.chave);
    if(matches.length>1) throw new Error('Há mais de um pedido igual. Abra Pedidos para escolher o pedido correto antes de escalar.');
    item.dados.leitura_chave_operacao ||= crypto.randomUUID();
    const matched=matches[0];
    const pedido=matched?{...item.dados,supermercado:matched.supermercado,unidade:matched.unidade,setor:matched.setor,quantidade_diaristas:matched.quantidade_diaristas,turnos:matched.turnos}:item.dados;
    return request('/api/leitura/pedido-escalado',{method:'POST',headers:{'Content-Type':'application/json'},body:body({pedido,diarista:item.dados.diarista_escalado,confirmar_cadastro:confirm,chave_operacao:item.dados.leitura_chave_operacao,pedido_id:matched?.id || null,pendencia_id:pendingId || null})});
  }
  async function processLinked(item, existing) {
    const draftKey=`rascunho:${parser.textKey(item.texto)}`;
    let previous=existing.draftRecords.find(record=>record.status==='pendente'&&record.chave===draftKey);
    item.dados.leitura_chave_operacao ||= previous?.dados.leitura_chave_operacao || crypto.randomUUID();
    const preserve=async(reason,needsRegistration=false,canConfirm=false)=>{
      const draft={...item,chave:draftKey,faltando:item.faltando.length?[...item.faltando]:[reason]};
      const record=await request('/api/leituras-pendentes',{method:'POST',headers:{'Content-Type':'application/json'},body:body(draft)});
      if(previous) Object.assign(previous,record); else {previous=record;existing.draftRecords.push(record);}
      existing.drafts.add(draftKey);
      return {state:'pending',description:reason,canConfirm,needsRegistration,pendingId:record.id};
    };
    if(item.faltando.length) return preserve(`Falta confirmar: ${item.faltando.join(', ')}.`);
    try {
      const saved=await saveLinked(item,existing,true,previous?.id || existing.reviewPendingId);
      if(saved.requires_registration) return preserve(`${saved.nome} ainda não tem cadastro. Confira o nome e CPF em Dados identificados e clique abaixo para cadastrar e salvar o pedido com a escala.`,true,true);
      if(!existing.workers.has(item.dados.diarista_escalado.cpf)) existing.workers.add(item.dados.diarista_escalado.cpf);
      if(saved.pedido_criado) existing.orderRows.push({...item.dados,id:saved.pedido_id});
      existing.orders.add(item.chave);
      return linkedResult(saved);
    } catch(error) {return preserve(`Não foi possível salvar pedido e escala: ${error.message}`,false,true);}
  }
  async function processItem(item, existing) {
    if (item.tipo === 'pedido' && item.dados.diarista_escalado) return processLinked(item,existing);
    const cpf = item.dados.cpf;
    const draftKey = `rascunho:${parser.textKey(item.texto)}`;
    const duplicate = item.tipo === 'diarista' ? cpf && existing.workers.has(cpf) : item.tipo === 'pedido' ? existing.orders.has(item.chave) : false;
    if (duplicate) return { state: 'duplicate', description: item.tipo === 'diarista' ? 'Diarista já cadastrado. Cadastro preservado, sem duplicação.' : 'Registro já existe; nenhum dado foi sobrescrito.' };
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
      if (item.tipo === 'diarista') {
        try {
          const workers=await request('/api/diaristas');
          if(workers.some(w=>String(w.cpf).replace(/\D/g,'')===cpf)){
            existing.workers.add(cpf);assistant.identifyRegistration(item,workers);
            return {state:'duplicate',description:'Diarista já cadastrado. Cadastro preservado, sem duplicação.'};
          }
        } catch { /* Se a consulta falhar, preserve a leitura para revisão. */ }
      }
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

  function fields(item) {
    const grid=document.createElement('dl');grid.className='reading-review-fields';
    for(const [label,value] of assistant.describe(item)) {if(value==null||value==='')continue;const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);cell.append(dt,dd);grid.append(cell);}
    return grid;
  }
  function chat(who,text){
    const row=document.createElement('div');row.className=`reading-bubble ${who==='Você'?'user':'assistant'}`;
    const label=document.createElement('strong'),content=document.createElement('p');label.textContent=who;content.textContent=text;row.append(label,content);
    const log=pick('#reading-chat');log.append(row);while(log.children.length>12)log.firstElementChild.remove();log.scrollTop=log.scrollHeight;
  }
  function reviewCard(item,index){
    const card=resultCard(item,'pending',item.faltando.length?`Preciso que você confirme: ${item.faltando.join(' ')}`:'Entendi estas informações. Confira e confirme abaixo.');
    card.classList.add('reading-preview');card.dataset.reviewIndex=index;
    card.querySelector('.reading-state').textContent=item.faltando.length?'Completar':'Aguardando confirmação';
    if(item.tipo==='diarista'&&item.cadastro?.status==='existente'){
      card.querySelector('.reading-state').textContent='Diarista já cadastrado';
      card.querySelector('p').textContent='Cadastro encontrado pelo CPF. Ao confirmar, o cadastro será preservado, sem criar outro nem alterar os dados.';
    }
    card.querySelector('details')?.remove();card.insertBefore(fields(item),card.querySelector('p'));
    if(item.tipo==='pedido'&&item.cadastro?.status==='novo'){
      const note=document.createElement('p');note.textContent='Essa pessoa ainda não tem cadastro. Ao confirmar, será criada apenas com nome e CPF e escalada nos dias deste pedido.';card.append(note);
    }
    const actions=document.createElement('div');actions.className='reading-item-actions';
    if(item.perguntas?.length){
      const questions=document.createElement('div');questions.className='reading-questions';
      for(const q of item.perguntas){const title=document.createElement('p');title.textContent=q.label;questions.append(title);
        for(const [choiceIndex,choice]of (q.choices||[]).entries()){const button=document.createElement('button');button.type='button';button.className='button button-outline reading-choice';button.textContent=`${choiceIndex+1}. ${choice.label}`;button.addEventListener('click',()=>{if(applying)return;review.editIndex=index;pick('#reading-text').value=assistant.merge(item.texto,q.field,choice.value);pick('#reading-form').requestSubmit();});questions.append(button);}
      }card.append(questions);
    }
    const edit=document.createElement('button');edit.type='button';edit.className='button button-outline';edit.textContent='✎ Corrigir';edit.addEventListener('click',()=>{
      if(applying)return;pick('#reading-text').value=item.texto;review.editIndex=index;pick('#reading-file').value='';showFiles();
      feedback('Edite os dados da mensagem e envie novamente. A revisão será atualizada sem salvar.');pick('#reading-text').focus();pick('#reading-form').scrollIntoView({block:'center',behavior:'smooth'});
    });actions.append(edit);
    if(item.faltando.length&&!item.commandOnly){const save=document.createElement('button');save.type='button';save.className='button button-quiet';save.textContent='Guardar pendência';save.addEventListener('click',async()=>{
      save.disabled=true;try{await request('/api/leituras-pendentes',{method:'POST',headers:{'Content-Type':'application/json'},body:body({...item,chave:`rascunho:${parser.textKey(item.texto)}`})});item.guarded=true;save.textContent='Pendência guardada';await loadPending();}catch(error){feedback(error.message,true);save.disabled=false;}
    });actions.append(save);}
    if(item.tipo==='comando'&&item.dados.acao==='substituir'||item.availabilityRequired){
      const label=document.createElement('label'),input=document.createElement('input');label.className='reading-availability';input.type='checkbox';input.checked=!!item.availability;
      input.addEventListener('change',()=>{item.availability=input.checked;updateReview();});label.append(input,item.availabilityRequired?' Confirmei a disponibilidade da pessoa para as datas e horários':' Confirmei a disponibilidade do substituto');card.append(label);
    }
    if(item.acknowledge&&!item.faltando.length){const label=document.createElement('label'),input=document.createElement('input');label.className='reading-availability';input.type='checkbox';input.checked=!!item.acknowledged;input.addEventListener('change',()=>{item.acknowledged=input.checked;updateReview();});label.append(input,' Conferi os dados e autorizo esta ação');card.append(label);}
    card.append(actions);return card;
  }
  function updateReview(){
    const actionable=review?.items.filter(i=>!i.applied&&!i.faltando.length&&i.tipo!=='indefinido'&&i.tipo!=='consulta')||[];
    const missing=review?.items.filter(i=>!i.applied&&i.faltando.length).length||0;
    pick('#reading-result-summary').textContent=`${actionable.length} ação(ões) pronta(s) · ${missing} informação(ões) para completar. Nada é salvo antes da confirmação.`;
    pick('#reading-review-actions').hidden=!review;
    pick('#reading-confirm').disabled=applying||!actionable.length||actionable.some(i=>(i.tipo==='comando'&&i.dados.acao==='substituir'||i.availabilityRequired)&&!i.availability||i.acknowledge&&!i.acknowledged||!assistant.permission(i,review.data.role));
    pick('#reading-confirm').textContent=missing?'Confirmar ações completas':'Confirmar e aplicar';
  }
  async function executeCommand(item,data){
    if(window.directRemote&&!['admin','operacao'].includes(window.directRemote.role))throw Error('Seu perfil não pode alterar escalas.');
    const d=item.dados,current=data.scales.find(s=>s.id===d.escala_id);
    if(!current||assistant.stamp(current)!==d.snapshot)throw Error('A escala mudou depois da leitura. Envie a mensagem novamente para conferir a versão atual.');
    let route=`/api/pedidos/${d.pedido_id}/escalas/${d.escala_id}`,method='PATCH',payload={status:d.acao,motivo:d.motivo,expected_updated_at:current.atualizado_em};
    if(d.acao==='confirmou'){route=`/api/operacao/escalas/${d.escala_id}`;payload={acao:'confirmacao',confirmacao:'confirmou',expected_updated_at:current.atualizado_em};}
    if(d.acao==='substituir'){if(!item.availability)throw Error('Confirme a disponibilidade do substituto.');route+='/substituir';method='POST';payload={diarista_id:d.substituto_id,motivo:d.motivo,disponibilidade_confirmada:item.availability===true,expected_updated_at:current.atualizado_em};}
    await request(route,{method,headers:{'Content-Type':'application/json'},body:body(payload)});
    return {state:'saved',description:`${assistant.describe(item)[0][1]} · ${d.pessoa} · ${d.data.split('-').reverse().join('/')} · pedido #${d.pedido_id}.`,orderId:d.pedido_id};
  }
  async function confirmReview(){
    if(applying||!review||pick('#reading-confirm').disabled)return;
    applying=true;pick('#reading-submit').disabled=true;pick('#reading-cancel').disabled=true;pick('#reading-text').disabled=true;updateReview();
    const current=review;let saved=0,failed=0;
    const epoch=sessionEpoch;
    try{
      const data=await getData(current.items.some(i=>['payment','payment-reopen'].includes(i.dados.kind)));const existing={workers:new Set(data.workers.map(w=>String(w.cpf).replace(/\D/g,''))),orders:new Set(data.orders.map(orderKey)),drafts:new Set(data.drafts.filter(r=>r.status==='pendente').map(r=>r.chave)),draftRecords:data.drafts,orderRows:data.orders,reviewPendingId:current.pendingId};
      for(let index=0;index<current.items.length;index++){
        if(epoch!==sessionEpoch)throw Error('Sessão encerrada. Entre novamente para revisar.');
        const item=current.items[index];if(item.applied||item.faltando.length||['indefinido','consulta'].includes(item.tipo))continue;
        assistant.identifyRegistration(item,data.workers);
        let outcome;
        try{if(!assistant.permission(item,window.directRemote?.role||null))throw Error('Seu perfil não tem permissão para esta ação.');
          if(item.acknowledge&&!item.acknowledged)throw Error('Confira os dados e autorize a ação na revisão.');
          if(item.tipo==='acao')outcome=await executeTask(item,data);
          else if(item.tipo==='atualizacao'){
            const currentWorker=data.workers.find(w=>w.id===item.dados.diarista_id);
            if(!currentWorker||JSON.stringify(currentWorker)!==item.dados.snapshot)throw Error('O cadastro mudou depois da leitura. Envie a mensagem novamente para revisar.');
            await request(`/api/diaristas/${currentWorker.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:body({...currentWorker,...item.dados.changes,expected_updated_at:currentWorker.atualizado_em})});
            outcome={state:'saved',description:`Cadastro de ${currentWorker.nome} atualizado. Demais informações preservadas.`};
          }else outcome=item.tipo==='comando'?await executeCommand(item,data):await processItem(item,existing);}catch(error){outcome={state:'error',description:error.message};}
        if(['saved','duplicate'].includes(outcome.state)){item.applied=true;saved++;}else failed++;
        const undo=outcome.state==='saved'&&['pedidos','diaristas'].includes(outcome.entity)&&(!window.directRemote||outcome.entity==='pedidos'||window.directRemote.role==='admin')?async()=>{await request(`/api/${outcome.entity}/${outcome.id}`,{method:'DELETE'});await Promise.all([load(),loadOrders(),loadPending()]);}:null;
        const card=resultCard(item,outcome.state,outcome.description,undo,outcome);
        if(outcome.orderId&&item.tipo==='comando'){const view=document.createElement('button');view.type='button';view.className='button button-outline';view.textContent='Ver pedido';view.addEventListener('click',async()=>{location.hash='#pedidos';await loadOrders();const order=orders.find(o=>o.id===outcome.orderId);if(order)await openOrderDetail(order);});card.append(view);}
        const old=pick(`#reading-result-items [data-review-index="${index}"]`);card.dataset.reviewIndex=index;if(old)old.replaceWith(card);
      }
      const refreshed=await Promise.allSettled([load(),loadOrders(),loadPending(),...(!window.directRemote||['admin','financeiro'].includes(window.directRemote.role)?[loadFinance()]:[])]);
      const refreshError=refreshed.some(r=>r.status==='rejected');
      chat('Direct',`${saved} ação(ões) concluída(s).${failed?' '+failed+' ação(ões) não concluída(s); confira os erros. As ações concluídas não serão repetidas.':''}${refreshError?' Alguns painéis não atualizaram. Recarregue para conferir.':''}`);
      feedback(failed?'Confira as ações que falharam. Corrija a mensagem antes de tentar novamente.':'Confirmado. Cadastros, pedidos, escalas e financeiro atualizados.',!!failed);
      if(current.items.every(i=>i.applied||i.guarded)){review=null;pick('#reading-review-actions').hidden=true;}
    }catch(error){feedback(`Não foi possível aplicar: ${error.message}`,true);}
    finally{applying=false;pick('#reading-submit').disabled=false;pick('#reading-cancel').disabled=false;pick('#reading-text').disabled=false;if(review)updateReview();else updateResultSummary();}
  }
  async function executeTask(item,data){
    const d=item.dados,c=d.changes,kind=d.kind;
    const collection=kind.startsWith('worker-')?data.workers:kind.startsWith('store-')?data.stores:['payment','payment-reopen'].includes(kind)?data.finance:data.orders;
    const current=collection.find(row=>row.id===d.id);
    if(kind!=='store-create'&&(!current||assistant.snapshot(current)!==d.snapshot))throw Error('O registro mudou depois da leitura. Envie a mensagem novamente para conferir a versão atual.');
    const send=(route,method,payload)=>request(route,{method,headers:{'Content-Type':'application/json'},body:body(payload)});
    if(kind==='worker-update')await send(`/api/diaristas/${d.id}`,'PUT',{...current,...c,expected_updated_at:current.atualizado_em});
    else if(['worker-block','worker-unblock'].includes(kind))await send(`/api/diaristas/${d.id}/bloqueio`,'PATCH',{bloqueada:kind==='worker-block',expected_updated_at:current.atualizado_em});
    else if(kind==='worker-delete')await send(`/api/diaristas/${d.id}`,'DELETE',{expected_updated_at:current.atualizado_em});
    else if(kind==='order-update')await send(`/api/pedidos/${d.id}`,'PUT',{...current,...c,expected_updated_at:current.atualizado_em});
    else if(kind==='order-delete')await send(`/api/pedidos/${d.id}`,'DELETE',{expected_updated_at:current.atualizado_em});
    else if(kind==='store-update')await send(`/api/lojas/${d.id}`,'PUT',{...current,...c,expected_updated_at:current.atualizado_em});
    else if(kind==='store-create'){
      if(data.stores.some(s=>assistant.norm(s.rede)===assistant.norm(c.rede)&&assistant.norm(s.nome)===assistant.norm(c.nome)))return {state:'duplicate',description:'Essa loja já está cadastrada. Os dados existentes foram preservados.'};
      await send('/api/lojas','POST',c);
    }else if(['payment','payment-reopen'].includes(kind)){
      if(current.pagamento_lote_id)throw Error('Reabra o fechamento no Financeiro antes de corrigir a diária.');
      const keys=['data_pagamento','valor_centavos','vencimento_pagamento','forma_pagamento','pagamento_lote_id'];
      await send(`/api/diaristas/${current.diarista_id}/diarias/${current.id}/pagamento`,'PATCH',{...c,expected_payment:Object.fromEntries(keys.map(key=>[key,current[key]??null]))});
    }else if(kind==='scale-add'){
      if(!item.availability)throw Error('Confirme a disponibilidade da pessoa antes de escalar.');
      const worker=data.workers.find(w=>w.id===c.diarista_id);if(!worker||worker.bloqueada)throw Error('Escolha uma pessoa cadastrada e sem bloqueio.');
      const missing=c.dates.filter(day=>!data.scales.some(s=>s.pedido_id===d.id&&s.diarista_id===c.diarista_id&&s.data===day&&s.status!=='desistiu'));
      if(!missing.length)return {state:'duplicate',description:'Essa pessoa já está escalada nos dias informados.'};
      await send(`/api/pedidos/${d.id}/escalas`,'POST',{diarista_id:c.diarista_id,datas:missing,disponibilidade_confirmada:true});
    }else if(kind==='scale-delete'){
      if(c.scales.length!==1)throw Error('Remova uma escala por revisão.');
      const selected=c.scales.map(old=>data.scales.find(s=>s.id===old.id));
      if(selected.some((row,i)=>!row||assistant.stamp(row)!==assistant.stamp(c.scales[i])))throw Error('Uma escala mudou depois da leitura. Confira novamente antes de remover.');
      for(const scale of selected)await send(`/api/pedidos/${d.id}/escalas/${scale.id}`,'DELETE',{expected_updated_at:scale.atualizado_em});
    }else throw Error('Ação não reconhecida. Nenhuma alteração foi enviada.');
    const summary=assistant.describe(item).filter(([label])=>['Registro','Diária','Pessoa','Datas','Valor','Data do pagamento'].includes(label)).map(([,value])=>value).filter(Boolean).join(' · ');
    return {state:'saved',description:`${assistant.describe(item)[0][1]} concluído. ${summary}`,orderId:kind.startsWith('order-')||kind.startsWith('scale-')?d.id:null};
  }
  async function answerQuery(item,data){
    if(!assistant.permission(item,data.role)){chat('Direct','Seu perfil não tem permissão para consultar estas informações.');return;}
    const response=assistant.answer(item,data);if(response){chat('Direct',response.message);const card=document.createElement('article');card.className='reading-item';const p=document.createElement('p');p.textContent=response.message;card.append(p);if(response.target){const a=document.createElement('a');a.href=response.target;a.className='button button-outline';a.textContent='Abrir aba';card.append(a);}pick('#reading-result-items').append(card);return;}
    const kind=item.dados.consulta;let message='',target='#inicio';
    if(kind==='pedidos'){message=`${data.orders.filter(o=>o.situacao!=='cancelado').length} pedido(s) ativo(s). ${data.scales.filter(s=>s.status==='presente').length} presença(s) e ${data.scales.filter(s=>s.status==='falta').length} falta(s) registradas.`;target='#pedidos';}
    if(kind==='diaristas'){message=`${data.workers.length} pessoa(s) cadastrada(s), ${data.workers.filter(w=>w.bloqueada).length} bloqueada(s).`;target='#diaristas';}
    if(kind==='lojas'){const matching=data.stores.filter(s=>assistant.norm(item.texto).includes(assistant.norm(s.nome))||assistant.norm(item.texto).includes(assistant.norm(s.rede)));message=(matching.length?matching.slice(0,8).map(s=>`${s.rede} · ${s.nome}: ${s.endereco||[s.logradouro,s.numero,s.bairro,s.cidade].filter(Boolean).join(', ')}`).join('\n'):`${data.stores.length} loja(s) em ${new Set(data.stores.map(s=>s.rede)).size} rede(s).`);target='#redes';}
    if(kind==='pendencias'){message=`${data.drafts.filter(r=>r.status==='pendente').length} leitura(s) para completar. ${data.scales.filter(s=>s.status==='escalada'&&s.confirmacao!=='confirmou').length} escala(s) aguardando confirmação da pessoa. Veja todas as pendências na aba própria.`;target='#crm';}
    if(kind==='financeiro'){
      if(window.directRemote&&!['admin','financeiro'].includes(window.directRemote.role)){message='Seu perfil não tem acesso ao financeiro.';target=null;}
      else{const [extras,contracts]=await Promise.all([request('/api/custos-extras'),request('/api/contratos')]);const grouped=data.scales.reduce((g,s)=>((g[s.pedido_id]||=[]).push(s),g),{});const period=assistant.norm(item.texto).includes('hoje')?window.DirectForecast.periodRange('day',data.today):assistant.norm(item.texto).includes('semana')?window.DirectForecast.periodRange('week',data.today):'';const totals=window.DirectForecast.calculate(data.orders,grouped,{...data.tariffs,extras,contratos:contracts},period);const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);message=`${period?'Período solicitado':'Todos os períodos'}: faturamento previsto ${money(totals.expected.revenue)}, custo de diárias previsto ${money(totals.expected.cost)}, lucro bruto previsto ${money(totals.expected.margin)}. Presenças confirmadas: ${totals.present}; faturamento ${money(totals.confirmed.revenue)}, custo ${money(totals.confirmed.cost)}, lucro bruto ${money(totals.confirmed.margin)}.${totals.missingCost||totals.missingRevenue?' Atenção: há tarifas não configuradas; os valores estão incompletos.':''}`;target='#financeiro';}
    }
    chat('Direct',message);const card=document.createElement('article');card.className='reading-item';const p=document.createElement('p');p.textContent=message;card.append(p);if(target){const a=document.createElement('a');a.href=target;a.className='button button-outline';a.textContent='Abrir aba';card.append(a);}pick('#reading-result-items').append(card);
  }
  async function submit(event){
    event.preventDefault();if(applying)return;
    let typed=pick('#reading-text').value.trim();const files=[...pick('#reading-file').files];
    if(!typed&&!files.length)return feedback('Escreva uma mensagem ou anexe fotos e PDFs.',true);
    if(!files.length&&/^(cancelar|cancela|nao|deixa pra la|nao aplicar|nova conversa)$/.test(assistant.norm(typed))){cancelReview();return;}
    if(!files.length&&/^(ok|sim|esta certo|tudo certo|confirmar|pode salvar|pode aplicar)$/.test(assistant.norm(typed))){chat('Você',typed);if(review)return confirmReview();return feedback('Não há uma revisão pronta para confirmar. Envie as informações primeiro.',true);}
    const userMessage=typed;
    const focused=review?.items[review.editIndex??(review.items.length===1?0:-1)];
    const correcting=focused?assistant.reply(typed,focused):null;
    if(correcting)typed=correcting;
    const button=pick('#reading-submit');button.disabled=true;button.textContent='Interpretando...';chat('Você',userMessage||`Anexos: ${files.map(f=>f.name).join(', ')}`);
    feedback('Conferindo cadastros, pedidos, lojas e escalas...');const area=pick('#reading-result');area.hidden=false;pick('#reading-result-filter').value='todos';
    const previous=review;review=null;pick('#reading-review-actions').hidden=true;
    const epoch=sessionEpoch;
    try{
      const data=await getData(/pagamento|paguei|a pagar|a receber|receber/i.test(typed)||files.length>0),sources=[],items=[];if(typed)sources.push({name:'Sua mensagem',text:typed});
      for(const file of files){try{lastOcrConfidence=100;sources.push({name:file.name,text:await fileText(file),confidence:lastOcrConfidence});}catch(error){items.push({tipo:'indefinido',dados:{},texto:'',fonte:file.name,faltando:[error.message],avisos:[]});}}
      for(const source of sources){
        let vocabulary=[];try{const approved=await request('/api/empresa/lista?tipo=frase&status=aprovada&tamanho=50');vocabulary=approved.items||[];}catch(error){if(!/not found|não encontrad|unknown|rota inválida|rota nao|consulta nao/i.test(error.message))feedback('Vocabulário adicional indisponível; conferindo com as regras existentes.');}
        const interpreted=window.DirectEnterpriseLanguage?.apply(source.text,vocabulary)||source.text;
        const parts=assistant.plan(interpreted,data);if(interpreted!==source.text)for(const item of parts)item.avisos=[...(item.avisos||[]),'Vocabulário aprovado aplicado. Mensagem original: '+source.text.slice(0,500)];if(!parts.length)parts.push({tipo:'indefinido',dados:{},texto:source.text,faltando:['Nenhum texto reconhecido. Envie uma foto mais nítida.'],avisos:[]});
        for(const item of parts){item.fonte=source.name;item.confianca=source.confidence??null;
          if(source.confidence<75){item.avisos=[...(item.avisos||[]),`Leitura de ${source.name}: confiança ${Math.round(source.confidence)}%. ${source.confidence<45?'Fotografe novamente com boa luz e sem reflexos.':'Confira nomes, CPF, datas e horários.'}`];item.faltando.push('Confira a leitura pouco legível e corrija o texto antes de confirmar.');}
          if(!['pedido','diarista','indefinido'].includes(item.tipo))item.commandOnly=true;
          if(item.tipo==='pedido'){item.dados.leitura_chave_operacao=crypto.randomUUID();item.dados.chave_operacao=crypto.randomUUID();}
          items.push(item);
        }
      }
      if(epoch!==sessionEpoch)throw Error('Sessão encerrada. Entre novamente para revisar.');
      if(previous?.editIndex!=null&&items.length===1){const index=previous.editIndex;previous.items[index]=items[0];delete previous.editIndex;review={...previous,data};}
      else review={items,data,pendingId:reviewPendingId};
      pick('#reading-result-items').replaceChildren();
      for(let index=0;index<review.items.length;index++){const item=review.items[index];if(item.tipo==='consulta'){await answerQuery(item,data);item.applied=true;}else if(!item.applied)pick('#reading-result-items').append(reviewCard(item,index));}
      pick('#reading-result-sources').textContent=sources.map(s=>s.name).join(' · ');
      if(review.items.every(i=>i.applied)){review=null;pick('#reading-result-summary').textContent='Consulta concluída. Nenhuma informação foi alterada.';feedback('Consulta concluída.');}
      else{updateReview();const missing=review.items.filter(i=>i.faltando.length);chat('Direct',missing.length?`${missing.map(i=>i.perguntas?.find(q=>q.field)?.label||i.faltando.join(' ')).join('\n')} Você pode responder aqui ou escolher uma opção na revisão. As ações completas podem ser confirmadas separadamente.`:'Confira os dados abaixo. Se estiverem corretos, clique em Confirmar e aplicar ou envie “está certo”.');feedback('Revise antes de confirmar. Nenhuma alteração foi feita.');}
      reviewPendingId=null;pick('#reading-text').value='';pick('#reading-file').value='';showFiles();
      area.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){review=null;pick('#reading-review-actions').hidden=true;feedback(`Não consegui interpretar: ${error.message}. Nenhuma ação foi aplicada.`,true);if(review)updateReview();}
    finally{button.disabled=false;button.textContent='✦ Enviar mensagem';}
  }
  async function fillDiarista(d, pendingId) {
    try {
    const existing = (await request('/api/diaristas')).find(r => r.cpf === String(d.cpf || '').replace(/\D/g, ''));
    window.location.hash = '#diaristas'; openForm(existing || null);
    window.directPendingForm = pendingId ? { id: pendingId, tipo: 'diarista' } : null;
    for (const key of ['nome', 'cpf', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'local_trabalho', 'observacoes_locomocao']) if (d[key] || !existing) pick(`#${key}`).value = d[key] || '';
    if (d.setores?.length || !existing) pick('#setores').value = (d.setores || []).join(', ');
    document.querySelectorAll('input[name="trabalhando"]').forEach(input => { if (d.trabalhando != null || !existing) input.checked = input.value === (d.trabalhando == null ? 'unknown' : String(d.trabalhando)); });
    document.querySelectorAll('input[name="pode_se_deslocar"]').forEach(input => { if (d.pode_se_deslocar != null || !existing) input.checked = input.value === (d.pode_se_deslocar == null ? 'unknown' : String(d.pode_se_deslocar)); });
    toggleConditional();
    const transport = (d.transporte || '').toLowerCase();
    const mapped = transport.includes('ônibus') || transport.includes('transporte público') ? 'Transporte público'
      : ['moto', 'carro', 'bicicleta'].some(name => transport.includes(name)) ? 'Veículo próprio'
      : transport.includes('aplicativo') || transport.includes('táxi') ? 'Aplicativo / táxi'
      : transport ? 'Outros meios' : '';
    if (mapped || !existing) pick('#transporte').value = mapped;
    if (d.disponibilidade?.length) {
      document.querySelectorAll('.day-enabled').forEach(input => { input.checked = false; input.dispatchEvent(new Event('change')); });
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
    } catch(error) { feedback(`Não foi possível abrir o cadastro: ${error.message}`,true); }
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
    const linked=!!item.dados?.diarista_escalado;
    const canConfirm=linked && (item.faltando || []).every(text=>/^(?:Confirmar cadastro|.*ainda não tem cadastro|Não foi possível salvar pedido)/.test(text));
    const card = resultCard({ ...item, dados: item.dados }, 'pending', `Falta confirmar: ${(item.faltando || []).join(', ')}.`,null,null);
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Ver texto reconhecido';
    const original = document.createElement('pre'); original.textContent = item.texto;
    details.append(summary, original); card.append(details);
    const actions = document.createElement('div'); actions.className = 'reading-item-actions';
    if (item.tipo !== 'indefinido') {
      const edit = document.createElement('button'); edit.className = 'button button-outline'; edit.type = 'button'; edit.textContent = 'Abrir e completar';
      edit.textContent='Revisar no assistente';edit.addEventListener('click', () => reviewLinked(item)); actions.append(edit);
    }
    const resolve = document.createElement('button'); resolve.className = 'button button-quiet'; resolve.type = 'button'; resolve.textContent = 'Marcar resolvido';
    resolve.addEventListener('click', async () => { try { await request(`/api/leituras-pendentes/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body({ status: 'resolvido' }) }); await loadPending(); } catch (error) { feedback(error.message, true); } });
    actions.append(resolve); card.append(actions);
    return card;
  }
  async function loadPending() {
    const role=window.directRemote?.role;
    const panel=pick('#reading-pending-items').closest('section');
    panel.hidden=!!role&&!['admin','operacao'].includes(role);
    if(panel.hidden||loadingPending)return;
    loadingPending = true;
    try {
      pending = (await request('/api/leituras-pendentes')).filter(item => item.status === 'pendente');
      const area = pick('#reading-pending-items'); area.replaceChildren();
      if (!pending.length) { const empty = document.createElement('p'); empty.className = 'reading-empty'; empty.textContent = 'Nenhuma informação pendente.'; area.append(empty); }
      else pending.forEach(item => area.append(pendingCard(item)));
    } catch (error) { const area = pick('#reading-pending-items'); area.textContent = `Não foi possível carregar as pendências: ${error.message}`; }
    finally { loadingPending = false; }
  }
  function reviewLinked(item) {
    window.location.hash='#leitura'; pick('#reading-text').value=item.texto; reviewPendingId=item.id;
    feedback('Revise a mensagem completa, incluindo pedido, nome e CPF, e envie novamente para conferir antes de salvar.');pick('#reading-text').focus();
  }
  window.DirectReading={complete:item=>item.dados?.diarista_escalado?reviewLinked(item):item.tipo==='diarista'?fillDiarista(item.dados,item.id):fillPedido(item.dados,item.id)};
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
  pick('#reading-confirm').addEventListener('click',confirmReview);
  function cancelReview(){if(applying)return;review=null;reviewPendingId=null;pick('#reading-review-actions').hidden=true;pick('#reading-result').hidden=true;pick('#reading-text').value='';feedback('Revisão cancelada. Nenhuma ação pendente foi aplicada.');chat('Direct','Revisão cancelada. Envie uma nova mensagem quando quiser.');}
  pick('#reading-cancel').addEventListener('click',cancelReview);
  const examples={pedido:`Rede: Hipermarket
Loja: Vila União
Função: Repositor de mercearia
Horário: 06:00 às 14:20
Data de início: ${orderToday().split('-').reverse().join('/')}
Quantidade de dias: 2
Nome:
CPF: `,presenca:'Marcar presença\nNome: \nData: hoje\nPedido: ',falta:'Marcar falta\nNome: \nData: hoje\nPedido: \nMotivo: ',substituicao:'Substituir diarista\nNome: \nSubstituto: \nData: hoje\nPedido: \nMotivo: ',pagamento:'Registrar pagamento\nNome: \nDiária: \nData do pagamento: hoje\nValor: \nForma: Pix',alteracao:'Alterar cadastro\nNome: \nTelefone: ',loja:'Cadastrar loja\nRede: \nLoja: \nEndereço: \nCidade: ',consulta:'Consultar pendências'};
  document.querySelectorAll('[data-reading-example]').forEach(b=>b.addEventListener('click',()=>{pick('#reading-text').value=examples[b.dataset.readingExample];pick('#reading-text').focus();}));
  window.addEventListener('direct:signed-out',()=>{sessionEpoch++;review=null;reviewPendingId=null;pending=[];pick('#reading-chat').replaceChildren();pick('#reading-result-items').replaceChildren();pick('#reading-review-actions').hidden=true;pick('#reading-result').hidden=true;pick('#reading-text').value='';pick('#reading-file').value='';pick('#reading-pending-items').replaceChildren();showFiles();});
  pick('#reading-result-filter').addEventListener('change', () => {
    const filter = pick('#reading-result-filter').value;
    pick('#reading-result-items').querySelectorAll('[data-result-state]').forEach(card => {
      card.hidden = filter !== 'todos' && (filter === 'revisar' ? !['pending','error'].includes(card.dataset.resultState) : card.dataset.resultState !== filter);
    });
  });
  pick('#reading-file').addEventListener('change', showFiles);
  pick('#reading-remove-file').addEventListener('click', () => { pick('#reading-file').value = ''; showFiles(); });
  window.addEventListener('direct:authorized',()=>{if(location.hash==='#leitura')loadPending();});
  window.addEventListener('hashchange', () => { if (location.hash === '#leitura') loadPending(); });
  if (location.hash === '#leitura') loadPending();
})();
