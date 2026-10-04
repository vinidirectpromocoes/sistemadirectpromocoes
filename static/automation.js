/* Fluxos compactos: sugestões, modelos e prazos. Escritas dependem do perfil e do backend. */
(()=>{
 const get=id=>document.getElementById(id),create=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
 const operate=()=>!window.directRemote||['admin','operacao'].includes(window.directRemote.role);
 const button=(text,fn)=>{const b=create('button',text,'button button-outline');b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){if(get('order-model-dialog').open){get('order-model-error').textContent=e.message;get('order-model-error').hidden=false;}else if(get('order-detail-dialog').open)orderDetailError(e.message);else if(location.hash==='#crm'){get('crm-feedback').textContent=e.message;get('crm-feedback').hidden=false;}else showOrderFeedback(e.message,true);}finally{b.disabled=false;}};return b;};
 function suggest(order,workers,stores,orders,scales,current){
  const box=get('order-suggestions'),list=get('order-suggestions-list');box.hidden=!operate()||['cancelado','concluido'].includes(order.situacao);list.replaceChildren();if(box.hidden)return;
  const remaining={...order,turnos:order.turnos.filter(t=>t.data>=orderToday())};
  const grouped={...scales,[order.id]:current},store=matchingOrderStore(order.supermercado,order.unidade);
  const candidates=workers.map(w=>({w,r:DirectMatching.rankOrder(w,remaining,store,orders,grouped)})).filter(x=>x.r.eligible).sort((a,b)=>b.r.score-a.r.score||a.w.nome.localeCompare(b.w.nome));
  list.append(create('p','Verifica experiência, dias, horários, deslocamento e conflitos. Disponibilidade declarada deve ser confirmada com a pessoa.','section-help'));
  if(!candidates.length)list.append(create('p','Nenhuma pessoa atende a todos os dias restantes com os dados atuais. Confira os cadastros ou selecione por dia.'));
  for(const {w,r}of candidates.slice(0,5)){
   const row=create('article','','automation-row'),info=create('div');info.append(create('strong',w.nome),create('small',r.reasons.join(' · ')));row.append(info,button('Escalar '+r.dates.length+' dias',async()=>{
    if(!confirm('Escalar '+w.nome+' em todos os '+r.dates.length+' dias disponíveis deste pedido?'))return;
    const [freshOrders,freshScales,freshWorkers,freshStores]=await Promise.all([request('/api/pedidos'),request('/api/escalas'),request('/api/diaristas'),request('/api/lojas')]);
    const live=freshOrders.find(o=>o.id===order.id);if(!live||['cancelado','concluido'].includes(live.situacao))throw Error('Pedido indisponível. Atualize a lista.');
    const all={};for(const s of freshScales)(all[s.pedido_id]||=[]).push(s);
    const fw=freshWorkers.find(x=>x.id===w.id);if(!fw)throw Error('Cadastro não encontrado.');
    const result=DirectMatching.rankOrder(fw,{...live,turnos:live.turnos.filter(t=>t.data>=orderToday())},DirectMessagesModel.storeFor(live,freshStores),freshOrders,all);
    if(!result.eligible||result.dates.join()!==r.dates.join())throw Error('A escala mudou. Atualize o pedido e confira a sugestão novamente.');
    await addOrderWorker(result.dates,w.id);
   }));list.append(row);
  }
 }
 async function loadModels(){
  get('order-model-error').hidden=true;const list=get('order-model-list');list.textContent='Carregando...';
  try{const models=await request('/api/modelos-pedidos');list.replaceChildren();if(!models.length)list.append(create('p','Abra um pedido e use “Salvar modelo” para reutilizar loja, setor, horários e quantidade de dias.'));
   for(const model of models){const row=create('article','','automation-row'),info=create('div');info.append(create('strong',model.nome),create('small',model.dados.supermercado+' · '+model.dados.unidade+' · '+model.dados.setor+' · '+model.dados.turnos.length+' dia(s)'));
    row.append(info,button('Usar modelo',async()=>{const draft=DirectAutomation.draft(model,get('order-model-start').value);get('order-model-dialog').close();openOrderForm();for(const [id,v]of Object.entries({'order-market':draft.supermercado,'order-unit':draft.unidade,'order-contact':draft.contato,'order-sector':draft.setor,'order-quantity':draft.quantidade_diaristas,'order-notes':draft.observacoes}))get(id).value=v;get('order-shifts').replaceChildren();draft.turnos.forEach(addOrderShift);window.directDraftId=crypto.randomUUID();updateOrderStoreOptions();updateOrderPreview();}),button('Excluir',async()=>{if(confirm('Excluir o modelo '+model.nome+'? Os pedidos existentes são preservados.')){await request('/api/modelos-pedidos/'+model.id,{method:'DELETE'});await loadModels();}}));list.append(row);
   }
  }catch(e){list.replaceChildren();get('order-model-error').textContent=e.message;get('order-model-error').hidden=false;}
 }
 get('order-models-button').onclick=async()=>{if(!operate())return;get('order-model-start').value=orderToday();get('order-model-dialog').showModal();await loadModels();};
 get('order-model-close').onclick=()=>get('order-model-dialog').close();get('order-model-dialog').addEventListener('click',orderDialogBackdrop);
 get('order-save-model').onclick=async()=>{
  const b=get('order-save-model');if(!operate())return;const name=prompt('Nome do modelo (ex.: Meireles — Caixa manhã)');if(!name?.trim())return;b.disabled=true;
  try{const d=orderFormData();DirectAutomation.draft(d,d.turnos[0]?.data);if(!d.supermercado||!d.setor||!matchingOrderStore(d.supermercado,d.unidade))throw Error('Informe rede, loja do catálogo e setor antes de salvar o modelo.');
   await request('/api/modelos-pedidos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:name.trim(),dados:{...d,situacao:'novo'}})});get('order-form-error').hidden=true;get('order-model-feedback').textContent='Modelo salvo. Disponível em Pedidos → Modelos.';get('order-model-feedback').hidden=false;
  }catch(e){get('order-form-error').textContent=e.message;get('order-form-error').hidden=false;}finally{b.disabled=false;}
 };
 function alerts(data,open){const box=get('deadline-alerts'),list=get('deadline-alerts-list');const all=operate()?DirectAutomation.alerts(data):[];box.hidden=!all.length;get('deadline-alerts-title').textContent='Alertas por prazo · '+all.length;list.replaceChildren();for(const a of all.slice(0,12)){const row=create('article','','automation-row'),info=create('div');row.dataset.urgency=a.level;info.append(create('strong',a.title),create('small',a.detail));row.append(info,button(a.label,()=>open(a)));list.append(row);}if(all.length>12)list.append(create('small','Mais '+(all.length-12)+' alertas. Resolva os primeiros e atualize a tela.'));}
 function permissions(){get('order-models-button').hidden=get('order-save-model').hidden=!operate();if(!operate()){get('order-suggestions').hidden=true;get('deadline-alerts').hidden=true;if(get('order-model-dialog').open)get('order-model-dialog').close();}}
 window.DirectAutomationUI={suggest,alerts};permissions();window.addEventListener('direct:authorized',permissions);
})();
