/* Controles internos de plantão, contratos, qualidade e demonstrativos. */
(() => {
 const $=id=>document.getElementById(id);
 const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
 const canOperate=()=>!window.directRemote||['admin','operacao'].includes(window.directRemote.role);
 const canFinance=()=>!window.directRemote||['admin','financeiro'].includes(window.directRemote.role);
 const send=(url,p,method='PATCH')=>request(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
 let data={orders:[],scales:[],workers:[],stores:[],occurrences:[],invoices:[],contracts:[]};let loading=null;
 function notice(message,error=false){if(location.hash==='#pedidos')showOrderFeedback(message,error);if(location.hash==='#financeiro')showFinanceFeedback(message,error);if(location.hash==='#configuracoes')settingsMessage(message,error);const out=$('extended-feedback');out.textContent=message;out.hidden=false;out.classList.toggle('error',error);}
 function button(label,fn,cls='button button-outline'){
  const b=node('button',label,cls);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{b.disabled=false;}});return b;
 }
 function section(target,title,subtitle,id){const s=node('section','','list-card extended-section');s.id=id;s.append(node('h2',title),node('p',subtitle,'section-help'));$(target).append(s);return s;}
 const feedback=node('div','','feedback');feedback.id='extended-feedback';feedback.role='status';feedback.hidden=true;$('crm-tools').prepend(feedback);
 const metrics=section('inicio-page','Indicadores da operação','Cobertura considera dias até hoje. Confirmação considera as escalas do período escolhido.','insights-section');
 const filters=node('div','','extended-filters');filters.innerHTML='<label>De<input id="insights-start" type="date"></label><label>Até<input id="insights-end" type="date"></label><button id="insights-refresh" type="button" class="button button-outline" aria-label="Atualizar indicadores">↻ Atualizar</button>';
 const metricsGrid=node('div','','extended-metrics');metricsGrid.id='insights-grid';metrics.append(filters,metricsGrid);
 const today=homeToday();$('insights-start').value=today.slice(0,7)+'-01';$('insights-end').value=today;
 const shift=section('crm-tools','Central de plantão','Vagas, respostas e chegadas pendentes de hoje e dos próximos sete dias. Recusas precisam ser retiradas da escala para liberar a vaga.','oncall-section');
 shift.append(button('↻ Atualizar plantão',()=>refresh()));const queue=node('div','','extended-list');queue.id='oncall-list';shift.append(queue);
 const reserves=section('crm-tools','Reservas por setor e região','Selecione uma vaga no plantão para abrir o pedido e conferir pessoas compatíveis. Confirme disponibilidade antes de escalar.','reserves-section');
 reserves.insertAdjacentHTML('beforeend','<div class="extended-filters"><label>Setor ou bairro<input id="reserve-search" type="search" placeholder="Ex.: caixa, Meireles"></label></div><div id="reserve-list" class="extended-list"></div>');
 const quality=section('crm-tools','Qualidade dos cadastros e atendimentos','Disponibilidade sem confirmação ou confirmada há mais de 30 dias exige nova conferência. Indicadores individuais usam registros do período selecionado.','quality-section');quality.insertAdjacentHTML('beforeend','<p id="quality-summary"></p><div id="quality-list" class="extended-list"></div>');
 for(const panel of [shift,reserves,quality]){const details=node('details','','list-card crm-tool');const heading=panel.querySelector('h2');details.append(node('summary',heading.textContent));heading.remove();panel.classList.remove('list-card');panel.before(details);details.append(panel);}
 const occurrenceSection=section('pedidos-page','Ocorrências e acompanhamento','Registre fatos, elogios e resolução vinculados ao pedido e, quando aplicável, à pessoa escalada.','occurrence-section');
 occurrenceSection.append(button('+ Ocorrência',()=>openOccurrence()));occurrenceSection.insertAdjacentHTML('beforeend','<div id="occurrence-list" class="extended-list"></div>');
 const contracts=section('configuracoes-page','Contratos e versões','Condições por rede, loja e setor. A nova versão preserva as tarifas de diárias já confirmadas. Campos de valor em branco seguem as tarifas gerais.','contract-section');
 contracts.append(button('+ Contrato',()=>openContract()));contracts.insertAdjacentHTML('beforeend','<div id="contract-list" class="extended-list"></div>');
 const results=section('financeiro-page','Resultado por loja e setor','Previsão operacional do período escolhido acima, incluindo estimativas de custos extras.','store-results-section');results.insertAdjacentHTML('beforeend','<div id="store-results" class="extended-list"></div>');
 const diagnostic=section('configuracoes-page','Conferência neste aparelho','Execute no celular real. O teste registra navegador, tela, campos, conexão e largura; a conferência visual complementa o diagnóstico.','device-section');
 diagnostic.append(button('▶ Executar diagnóstico',()=>diagnose()));diagnostic.insertAdjacentHTML('beforeend','<pre id="device-result" class="device-result"></pre><button id="device-download" type="button" class="button button-outline" hidden>↓ Baixar diagnóstico</button>');
 const dialog=node('dialog','','extended-dialog');dialog.id='extended-dialog';dialog.innerHTML='<form id="extended-form"><header class="extended-dialog-head"><h2 id="extended-title"></h2><button type="button" id="extended-close" class="icon-button" aria-label="Fechar">×</button></header><div id="extended-fields" class="extended-fields"></div><p id="extended-error" class="form-error" role="alert" hidden></p><footer class="dialog-footer"><button type="button" id="extended-cancel" class="button button-quiet">Cancelar</button><button type="submit" class="button button-primary" id="extended-save">Salvar</button></footer></form>';document.body.append(dialog);
 let submit=null,formGeneration=0,busyGeneration=null;
 function field(name,label,value='',type='text',options=null,required=false){
  const wrap=node('label',label);const input=document.createElement(options?'select':type==='textarea'?'textarea':'input');input.name=name;input.id='ext-'+name;
  if(!options&&type!=='textarea')input.type=type;if(options)for(const [val,text]of options)input.append(new Option(text,val));
  if(type==='textarea'){input.rows=3;input.maxLength=1000;}else if(type==='text'||type==='tel'){input.maxLength=120;}
  if(type==='number'){input.min='0';input.max='365';input.step='1';}input.value=value??'';input.required=required;wrap.append(input);$('extended-fields').append(wrap);return input;
 }
 function open(title,build,save){++formGeneration;$('extended-save').disabled=false;$('extended-save').setAttribute('aria-busy','false');$('extended-form').reset();$('extended-fields').replaceChildren();$('extended-error').hidden=true;$('extended-title').textContent=title;submit=save;build();dialog.showModal();}
 $('extended-form').addEventListener('submit',async e=>{e.preventDefault();const generation=formGeneration,save=submit;if(busyGeneration===generation)return;busyGeneration=generation;$('extended-save').disabled=true;$('extended-save').setAttribute('aria-busy','true');try{const values=Object.fromEntries(new FormData(e.currentTarget));await save(values);if(generation!==formGeneration)return;dialog.close();await refresh(true);if(orderDetailId)await refreshOrderScales();await loadFinanceIfVisible();}catch(err){if(generation===formGeneration){$('extended-error').textContent=err.message;$('extended-error').hidden=false;}else window.DirectUI?.notify(err.message,true);}finally{if(generation===formGeneration){$('extended-save').disabled=false;$('extended-save').setAttribute('aria-busy','false');}if(busyGeneration===generation)busyGeneration=null;}});
 $('extended-close').onclick=$('extended-cancel').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();});
 async function loadFinanceIfVisible(){if(location.hash==='#financeiro')await loadFinance();}
 function orderButton(id){return button('↗ Abrir pedido',async()=>{location.hash='#pedidos';await loadOrders();await openOrderDetail(id);});}
 const entry=(title,detail)=>{const r=node('article','','extended-entry');r.append(node('strong',title),node('small',detail));return r;};
 function renderMetrics(){
  const d=DirectInsights.calculate(data.orders,data.scales,data.workers,data.occurrences,data.invoices,{today:homeToday(),start:$('insights-start').value,end:$('insights-end').value});
  const value=v=>v==null?'—':`${v}%`;
  metricsGrid.replaceChildren();
  for(const [label,v,description]of [
   ['Cobertura efetiva',value(d.coverage),`${d.present}/${d.demand} diárias atendidas até hoje`],
   ['Confirmação antecipada',value(d.confirmation),`${d.early}/${d.assigned} escalas confirmadas antes do início`],
   ['Pontualidade registrada',value(d.punctuality),`${d.punctual} no horário · ${d.late} atrasos · ${d.arrivalUnknown} sem chegada registrada`],
   ['Tempo médio de substituição',d.replacementMinutes==null?'—':`${d.replacementMinutes} min`,`${d.replacementCount} substituições com tempos conhecidos`],
   ['Validadas pela loja',String(d.validated),'Presenças com validação registrada'],
   ['Ocorrências abertas',String(d.openOccurrences),'Todas as ocorrências ainda sem resolução'],
  ]) {const c=node('article','','finance-stat');c.append(node('span',label),node('strong',v),node('small',description));metricsGrid.append(c);}
  if(canFinance())for(const [label,v,detail]of [['Cobranças atrasadas',moneyLabel(d.overdue.reduce((n,x)=>n+x.balance,0)),`${d.overdue.length} cobranças com saldo vencido`],['Saldo contestado',moneyLabel(d.contested),'Saldo de cobranças contestadas, sem desconto automático']]){const c=node('article','','finance-stat');c.append(node('span',label),node('strong',v),node('small',detail));metricsGrid.append(c);}
  $('quality-summary').textContent=`${d.missingContact} sem telefone · ${d.staleAvailability} disponibilidades para reconfirmar. A falta de horário não é contada como pontualidade.`;
  const list=$('quality-list');list.replaceChildren();
  for(const p of d.profiles){const r=entry(p.name,`${p.present} presenças · ${p.absent} faltas · ${p.withdrawn||0} desistências (${p.withdrawnAfterConfirmed||0} após confirmar) · ${p.late} atrasos registrados · ${p.unknown} sem horário · ${p.praise} elogios · ${p.complaints} reclamações`);list.append(r);}
  if(!d.profiles.length)list.textContent='Sem atendimentos registrados no período.';
 }
 function renderOnCall(){
  queue.replaceChildren();const today=homeToday(),end=new Date(`${today}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+7);const last=end.toISOString().slice(0,10);const now=Date.now();
  const rows=[];
  for(const o of data.orders.filter(o=>!['cancelado','concluido'].includes(o.situacao)))for(const t of o.turnos.filter(t=>t.data>=today&&t.data<=last)){
   const s=data.scales.filter(s=>s.pedido_id===o.id&&s.data===t.data&&!['falta','desistiu'].includes(s.status));
   const pending=s.filter(s=>s.status==='escalada');const vacancies=Math.max(0,o.quantidade_diaristas-s.length);
   const text=`${dateLabel(t.data)} ${t.inicio}–${t.fim} · ${o.setor} · ${vacancies} vaga(s) · ${pending.filter(s=>s.confirmacao!=='confirmou').length} respostas pendentes`;
   const r=entry(`${o.supermercado} / ${o.unidade}`,text);r.append(orderButton(o.id));
   if(Date.parse(`${t.data}T${t.inicio}:00-03:00`)<now&&pending.length)r.append(node('span',`${pending.length} chegada(s) para conferir`,'reconciliation-issue'));
   for(const person of pending.filter(s=>s.confirmacao==='recusou'))r.append(node('small',`${person.diarista_nome} recusou: abra o pedido e retire da escala.`));
   rows.push({r,key:t.data+t.inicio});
  }
  for(const x of rows.sort((a,b)=>a.key.localeCompare(b.key)))queue.append(x.r);
  if(!rows.length)queue.textContent='Nenhum pedido em plantão nos próximos sete dias.';
  shift.parentElement.hidden=!canOperate();reserves.parentElement.hidden=!canOperate();quality.parentElement.hidden=window.directRemote?.role==='consulta';
 }
 function renderReserves(){
  const query=$('reserve-search').value.trim().toLocaleLowerCase('pt-BR');const list=$('reserve-list');list.replaceChildren();
  for(const w of data.workers.filter(w=>w.reserva&&!w.bloqueada&&(!query||`${w.nome} ${w.bairro} ${w.setores.join(' ')}`.toLocaleLowerCase('pt-BR').includes(query)))){
   const r=entry(w.nome,`${w.setores.join(', ')} · ${w.bairro} · ${w.telefone||'Sem telefone'} · disponibilidade ${w.disponibilidade_confirmada_em?'confirmada em '+new Date(w.disponibilidade_confirmada_em).toLocaleDateString('pt-BR'):'não reconfirmada'}`);
   r.append(button('☷ Contato e reserva',()=>openWorker(w)));list.append(r);
  }
  if(!list.children.length)list.textContent='Nenhuma reserva neste filtro. Na ficha da diarista, use Contato e reserva.';
 }
 function openWorker(w){if(!canOperate())throw Error('Sem permissão para alterar reservas.');open('Contato e reserva — '+w.nome,()=>{field('telefone','Telefone com DDD',w.telefone,'tel');field('reserva','Disponível para reserva',w.reserva?'sim':'nao','text',[['nao','Não'],['sim','Sim']]);const p=node('p','Salvar também registra que a disponibilidade foi conferida agora. Revise os dias e horários na ficha antes de confirmar.','section-help');$('extended-fields').append(p);},p=>send(`/api/operacao/diaristas/${w.id}`,{telefone:p.telefone.replace(/\D/g,''),reserva:p.reserva==='sim'}));}
 function confirmation(s,value){return send(`/api/operacao/escalas/${s.id}`,{acao:'confirmacao',confirmacao:value});}
 function openValidation(s){open('Validação da loja — '+s.diarista_nome,()=>{
  field('loja_responsavel','Responsável da loja',s.loja_responsavel,'text',null,true);
  field('loja_validacao','Resultado',s.loja_validacao==='pendente'?'validado':s.loja_validacao,'text',[['validado','Atendimento validado'],['divergencia','Há divergência']]);
  const time=v=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)):'';
  field('chegada','Chegada efetiva (opcional)',time(s.chegada_em),'time');field('saida','Saída efetiva (opcional)',time(s.saida_em),'time');field('loja_observacao','Observações / motivo da divergência',s.loja_observacao,'textarea');
 },p=>send(`/api/operacao/escalas/${s.id}`,{acao:'validacao',loja_responsavel:p.loja_responsavel,loja_validacao:p.loja_validacao,loja_observacao:p.loja_observacao,
  chegada_em:p.chegada?new Date(`${s.data}T${p.chegada}:00-03:00`).toISOString():null,saida_em:p.saida?new Date(`${s.data}T${p.saida}:00-03:00`).toISOString():null}));}
 function openOccurrence(orderId=orderDetailId,scaleId=null){if(!canOperate())throw Error('Sem permissão para registrar ocorrência.');open('Registrar ocorrência',()=>{
  const o=field('pedido_id','Pedido',orderId||data.orders[0]?.id||'','text',data.orders.map(o=>[String(o.id),`#${o.id} ${o.supermercado} / ${o.unidade} · ${o.setor}`]),true);
  const s=field('escala_id','Pessoa / dia (opcional)',scaleId||'','text',[]);const update=()=>{s.replaceChildren(new Option('Pedido em geral',''),...data.scales.filter(x=>x.pedido_id===Number(o.value)).map(x=>new Option(`${x.diarista_nome} · ${dateLabel(x.data)}`,String(x.id))));s.value=String(scaleId||'');};o.onchange=update;update();
  field('tipo','Tipo','outro','text',[['atraso','Atraso'],['troca_setor','Troca de setor'],['saida_antecipada','Saída antecipada'],['reclamacao','Reclamação'],['elogio','Elogio'],['outro','Outro']]);field('descricao','Descrição','','textarea',null,true);
 },p=>send('/api/ocorrencias',{pedido_id:Number(p.pedido_id),escala_id:Number(p.escala_id)||null,tipo:p.tipo,descricao:p.descricao},'POST'));}
 function renderOccurrences(){const list=$('occurrence-list');list.replaceChildren();occurrenceSection.hidden=!canOperate()&&!canFinance();occurrenceSection.querySelector('button').hidden=!canOperate();
  for(const o of data.occurrences){const r=entry(`#${o.id} · Pedido #${o.pedido_id} · ${o.tipo.replaceAll('_',' ')} · ${o.estado}`,o.descricao);r.append(node('small',`${o.autor} · ${new Date(o.criado_em).toLocaleString('pt-BR')}`),orderButton(o.pedido_id));if(o.estado==='aberta'&&canOperate())r.append(button('✓ Resolver',()=>open('Resolver ocorrência',()=>field('resolucao','Resolução','','textarea',null,true),p=>send(`/api/ocorrencias/${o.id}`,p))));if(o.resolucao)r.append(node('small',o.resolucao));list.append(r);}if(!list.children.length)list.textContent='Nenhuma ocorrência registrada.';
 }
 const amount=v=>v==null?'':(v/100).toFixed(2);
 function cents(v){if(!v.trim())return null;if(!/^\d+(?:[.,]\d{1,2})?$/.test(v))throw Error('Informe valores positivos com até duas casas decimais.');const n=Math.round(Number(v.replace(',','.'))*100);if(n<1||n>100000000)throw Error('Valor fora do limite permitido.');return n;}
 async function openContract(c=null){
  if(!canFinance())throw Error('Sem permissão para contratos.');
  if(!settingsData)await loadSettings();
  if(!settingsData)throw Error('Não foi possível carregar os setores. Atualize as configurações e tente novamente.');
  if(location.hash!=='#configuracoes')return;
  open(c?'Nova versão do contrato #'+c.id:'Cadastrar contrato',()=>{
  const network=field('rede','Rede',c?.rede||data.stores[0]?.rede||'','text',[...new Set(data.stores.map(x=>x.rede))].sort().map(v=>[v,v]),true);
  const store=field('loja','Loja (opcional)',c?.loja||'','text',[]);const fill=()=>{store.replaceChildren(new Option('Toda a rede',''),...data.stores.filter(x=>x.rede===network.value).map(x=>new Option(x.nome,x.nome)));store.value=c?.loja||'';};network.onchange=fill;fill();
  const sectors=[...new Set([...settingsData.setores.map(x=>x.setor),...data.orders.map(x=>x.setor),c?.setor].filter(Boolean))].sort();field('setor','Setor',c?.setor||'','text',[['','Todos os setores'],...sectors.map(x=>[x,x])]);field('inicio','Início da vigência',homeToday(),'date',null,true);field('fim','Fim da vigência (opcional)','','date');
  for(const [key,label]of [['valor_recebido','Recebido por diária (R$)'],['valor_pago','Pago por diária (R$)']]){const input=field(key,label,amount(c?.[key+'_centavos']));input.inputMode='decimal';}
  field('prazo_dias','Prazo de cobrança em dias',c?.prazo_dias??30,'number',null,true);field('responsavel','Responsável',c?.responsavel||'');field('contato','Contato',c?.contato||'');field('regras','Condições, cancelamentos e orientações',c?.regras||'','textarea');
  if(c){network.disabled=true;store.disabled=true;$('ext-setor').disabled=true;$('extended-fields').append(node('p','A nova versão encerra a anterior na véspera do novo início, quando as vigências se cruzarem.','section-help'));}
 },p=>send('/api/contratos',{...p,rede:c?.rede||p.rede,loja:c?.loja||p.loja,setor:c?.setor??p.setor,prazo_dias:Number(p.prazo_dias),valor_recebido:amount(cents(p.valor_recebido)),valor_pago:amount(cents(p.valor_pago)),versao_anterior_id:c?.id||null},'POST'));}
 function renderContracts(){const list=$('contract-list');list.replaceChildren();for(const c of data.contracts){const expired=c.fim&&c.fim<homeToday();const r=entry(`#${c.id} ${c.rede}${c.loja?' / '+c.loja:''} · ${c.setor||'Todos os setores'}${expired?' · encerrado':''}`,`${dateLabel(c.inicio)} até ${c.fim?dateLabel(c.fim):'sem fim definido'} · recebido ${c.valor_recebido_centavos==null?'tarifa geral':moneyLabel(c.valor_recebido_centavos)} · pago ${c.valor_pago_centavos==null?'tarifa geral':moneyLabel(c.valor_pago_centavos)} · prazo ${c.prazo_dias} dias`);if(c.fim&&c.fim>=homeToday()&&Date.parse(c.fim)-Date.parse(homeToday())<=30*86400000)r.append(node('small','Vigência termina nos próximos 30 dias.','reconciliation-issue'));r.append(node('small',`${c.responsavel} ${c.contato} ${c.regras}`));if(c.versao_anterior_id)r.append(node('small',`Versão anterior: #${c.versao_anterior_id}`));r.append(button('↗ Nova versão',()=>openContract(c)));list.append(r);}if(!list.children.length)list.textContent='Nenhum contrato registrado. As tarifas gerais continuam aplicadas.';}
 function reviewInvoice(invoice){open('Conferência da cobrança #'+invoice.id,()=>{field('conferencia','Resultado',invoice.conferencia==='contestada'?'contestada':'conferida','text',[['conferida','Conferida'],['contestada','Contestada']]);field('responsavel','Responsável pela conferência',invoice.conferencia_responsavel,'text',null,true);field('motivo','Motivo / observações',invoice.conferencia_motivo,'textarea');},p=>send(`/api/operacao/cobrancas/${invoice.id}`,p));}
 function printInvoice(i){
  const content=$('print-demonstrative');content.replaceChildren();content.append(node('h1','Direct Promoções — Demonstrativo de serviços'),node('h2',`${i.rede} · Cobrança #${i.id}`),node('p',`${dateLabel(i.periodo_inicio)} a ${dateLabel(i.periodo_fim)} · vencimento ${dateLabel(i.vencimento)} · ${i.numero_nota?'Nota: '+i.numero_nota:'Sem número de nota'}`));
  const table=document.createElement('table');const head=document.createElement('thead');const tr=document.createElement('tr');for(const v of ['Dia','Pedido / loja','Setor','Diarista','Serviço','Valor'])tr.append(node('th',v));head.append(tr);table.append(head);const body=document.createElement('tbody');
  for(const item of i.itens||[]){const o=data.orders.find(x=>x.id===item.pedido_id);const s=data.scales.find(x=>x.pedido_id===item.pedido_id&&x.data===item.data&&x.diarista_id===item.diarista_id);const replaced=s&&data.scales.some(x=>x.substituida_por_escala_id===s.id);const t=o?.turnos.find(t=>t.data===item.data);const row=document.createElement('tr');for(const v of [dateLabel(item.data),`#${item.pedido_id} ${item.unidade||o?.unidade||''}`,item.setor||o?.setor||'',item.diarista_nome||'',`${replaced?'Substituição · ':''}${t?`${t.inicio}–${t.fim}`:''} · ${s?.loja_validacao==='validado'?'validado pela loja':'validação pendente'}`,moneyLabel(item.valor_centavos)])row.append(node('td',v));body.append(row);}
  table.append(body);content.append(table,node('p',`Total: ${moneyLabel(i.valor_centavos)} · Recebido: ${moneyLabel(i.valor_recebido_centavos)} · Saldo: ${moneyLabel(Math.max(0,i.valor_centavos-i.valor_recebido_centavos))}`),node('p',`Conferência: ${i.conferencia||'pendente'} · ${i.conferencia_responsavel||''} ${i.conferencia_motivo||''}`),node('small',`Emitido em ${new Date().toLocaleString('pt-BR')}. Demonstrativo operacional; não substitui documento fiscal.`));content.hidden=false;document.body.classList.add('printing-demonstrative');window.print();setTimeout(()=>{document.body.classList.remove('printing-demonstrative');content.hidden=true;},0);
 }
 const deadline=button('Usar prazo do contrato',()=>{
  const network=$('invoice-network').value,start=$('invoice-start').value,end=$('invoice-end').value;const terms=[];
  for(const o of data.orders.filter(x=>x.supermercado===network))for(const s of data.scales.filter(x=>x.pedido_id===o.id&&x.status==='presente'&&x.data>=start&&x.data<=end)){
   const c=s.diaria?.contrato_id?data.contracts.find(c=>c.id===s.diaria.contrato_id):DirectInsights.contract(data.contracts,o,s.data);if(c)terms.push(c.prazo_dias);
  }
  if(!terms.length)throw Error('Não há prazo de contrato para as presenças desse período. Informe o vencimento combinado.');
  const days=Math.max(...terms);const date=new Date(end+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);$('invoice-due').value=date.toISOString().slice(0,10);$('invoice-preview').textContent+=` · vencimento sugerido: fim do período + ${days} dias. Confira antes de gerar.`;
 });deadline.id='invoice-contract-deadline';$('invoice-due').parentElement.append(deadline);
 const print=node('section','','print-demonstrative');print.id='print-demonstrative';print.hidden=true;document.body.append(print);
 function renderReviews(){const list=$('invoice-review-list');if(!list)return;list.replaceChildren();for(const i of data.invoices.filter(i=>i.status!=='cancelada')){const r=entry(`#${i.id} · ${i.rede} · ${moneyLabel(i.valor_centavos)}`,`${i.conferencia||'pendente'} · ${i.conferencia_responsavel||''}${i.conferencia_motivo?' · '+i.conferencia_motivo:''}`);r.append(button('▤ PDF / imprimir',()=>printInvoice(i)),button('✓ Conferir',()=>reviewInvoice(i)));list.append(r);}if(!list.children.length)list.textContent='Gere uma cobrança para emitir seu demonstrativo.';}
 function renderStoreResults(input){if(!input)return;const period=financeForecastPeriod();const forecast=DirectForecast.calculate(input.orders,input.scales,input.tariffs,period);const map=new Map();for(const o of forecast.byOrder){const key=`${o.network} / ${o.unit} · ${o.sector}`;const v=map.get(key)||{days:0,revenue:0,cost:0,extras:0,net:0};for(const f of Object.keys(v))v[f]+=o[f]||0;map.set(key,v);}const list=$('store-results');list.replaceChildren();for(const [name,v]of map)list.append(entry(name,`${v.days} diárias previstas · faturamento ${moneyLabel(v.revenue)} · diárias ${moneyLabel(v.cost)} · extras ${moneyLabel(v.extras)} · líquido estimado ${moneyLabel(v.net)}`));if(!map.size)list.textContent='Sem pedidos no período.';}
 async function refresh(force=false){if(window.directRemote&&!window.directRemote.role)return;if(loading){if(!force)return loading;await loading;}loading=(async()=>{try{
  const role=window.directRemote?.role;const [orders,scales,workers,stores,occurrences,invoices,contracts]=await Promise.all([request('/api/pedidos'),request('/api/escalas'),role==='consulta'?[]:request('/api/diaristas'),request('/api/lojas'),role==='consulta'?[]:request('/api/ocorrencias'),canFinance()?request('/api/cobrancas'):[],canFinance()?request('/api/contratos'):[]]);data={orders,scales,workers,stores,occurrences,invoices,contracts};if($('extended-feedback').textContent.startsWith('Não foi possível atualizar os controles:'))$('extended-feedback').hidden=true;renderMetrics();renderOnCall();renderReserves();renderOccurrences();renderContracts();renderReviews();renderStoreResults(typeof financeForecastInput!=='undefined'?financeForecastInput:null);window.DirectOffline?.remember(orders,scales);
 }catch(e){if(!navigator.onLine){$('offline-status').textContent='Sem conexão. Agenda da última carga; revise os rascunhos após reconectar.';}else notice(`Não foi possível atualizar os controles: ${e.message}`,true);}finally{loading=null;}})();return loading;}
 function diagnose(){const visible=[...document.querySelectorAll('input,select,textarea')].filter(e=>e.getClientRects().length&&!['checkbox','radio','hidden','button','submit','file'].includes(e.type));const result={data:new Date().toISOString(),navegador:navigator.userAgent,tela:{largura:innerWidth,altura:innerHeight,dpr:devicePixelRatio,visualViewport:window.visualViewport?{largura:visualViewport.width,altura:visualViewport.height,escala:visualViewport.scale}:null},toque:navigator.maxTouchPoints,online:navigator.onLine,transbordamento:document.documentElement.scrollWidth-innerWidth,camposPequenos:visible.filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).map(e=>e.id),movimentoReduzido:matchMedia('(prefers-reduced-motion: reduce)').matches,serviceWorker:!!navigator.serviceWorker?.controller};$('device-result').textContent=JSON.stringify(result,null,2);$('device-download').hidden=false;$('device-download').onclick=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));link.download='direct-diagnostico-aparelho.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};}
 $('reserve-search').oninput=renderReserves;$('insights-refresh').onclick=()=>{loadHome();};$('insights-start').onchange=$('insights-end').onchange=renderMetrics;
 const recurring=button('↗ Repetir pedido',()=>{const source=orderRecords.find(o=>o.id===orderDetailId);if(!source)return;
  open('Repetir pedido #'+source.id,()=>{const d=new Date(source.turnos[0].data+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+7);field('inicio','Primeiro dia do novo pedido',d.toISOString().slice(0,10),'date',null,true);$('extended-fields').append(node('p','O próximo formulário permite conferir todas as datas, horários e quantidades. Nenhuma pessoa ou presença será copiada.','section-help'));},async p=>{const delta=Date.parse(p.inicio+'T12:00:00Z')-Date.parse(source.turnos[0].data+'T12:00:00Z');const clone={...source,id:null,situacao:'novo',turnos:source.turnos.map(t=>({...t,data:new Date(Date.parse(t.data+'T12:00:00Z')+delta).toISOString().slice(0,10)}))};dialog.close();openOrderForm(clone);getFormTitle();});
 });
 function getFormTitle(){document.getElementById('order-form-title').textContent='Conferir pedido repetido';}
 recurring.id='order-repeat-button';document.getElementById('order-detail-dialog').querySelector('.dialog-footer').append(recurring);
 const originalOrderDetail=openOrderDetail;openOrderDetail=async id=>{await originalOrderDetail(id);recurring.hidden=!canOperate();};
 const oldHome=loadHome;loadHome=async()=>{await oldHome();await refresh();};const oldSettings=loadSettings;loadSettings=async()=>{await oldSettings();if(canFinance())await refresh();};
 const profileButton=button('☷ Contato e reserva',()=>{const w=data.workers.find(x=>x.id===detailId)||records.find(x=>x.id===detailId);if(w)openWorker(w);});profileButton.id='worker-reserve-button';$('detail-dialog').querySelector('.dialog-footer').append(profileButton);
 const oldDetail=openDetail;openDetail=async id=>{await oldDetail(id);profileButton.hidden=!canOperate();};
 window.DirectOperations={refresh,printInvoice,renderStoreResults,openOccurrence,
  appendScale(row,s){if(!canOperate())return;const wrap=node('div','','extended-scale-controls');
   if(s.status==='escalada'){wrap.append(node('small',`Resposta: ${{aguardando:'aguardando',confirmou:'confirmada',recusou:'recusou'}[s.confirmacao||'aguardando']}`));for(const [value,label]of [['confirmou','✓ Confirmou que vai'],['aguardando','↺ Aguardando']]){const b=button(label,async()=>{await confirmation(s,value);await refreshOrderScales();await refresh(true);});b.disabled=s.confirmacao===value;wrap.append(b);}
    wrap.append(button('♧ Copiar convite',()=>window.DirectMessages.order(s.pedido_id,'reminder',s.diarista_id)));
   }else if(s.status==='presente'){wrap.append(node('small',`Loja: ${s.loja_validacao||'pendente'}${s.loja_responsavel?' · '+s.loja_responsavel:''}`),button('✓ Validar atendimento',()=>openValidation(s)));}
   wrap.append(button('⚑ Ocorrência',()=>openOccurrence(s.pedido_id,s.id)));row.append(wrap);
  }};
 for(const id of ['forecast-period','finance-month'])$(id).addEventListener('change',()=>renderStoreResults(financeForecastInput));
 window.addEventListener('direct:authorized',()=>refresh());
 window.addEventListener('hashchange',()=>{if(['#inicio','#crm','#pedidos','#configuracoes','#financeiro'].includes(location.hash))refresh();});
 refresh();
})();
