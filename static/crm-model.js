/* Etapas derivadas dos registros existentes. Não grava presença, pagamentos ou status paralelos. */
(() => {
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const date = v => String(v || '').slice(0, 10);
  function build(input, today) {
    const {orders=[],scales=[],workers=[],finance=[],readings=[],occurrences=[],invoices=[],contracts=[]}=input;
    const rows=new Map(), orderById=new Map(orders.map(o=>[o.id,o]));
    const groups=new Map();for(const s of scales){const key=`${s.pedido_id}:${s.data}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
    const add=r=>rows.set(r.key,{network:'',date:'',overdue:false,...r});
    const context=o=>({orderId:o?.id,network:o?.supermercado||'',unit:o?.unidade||'',sector:o?.setor||''});
    for(const o of orders){
      const stage={novo:'aberto',em_selecao:'aberto',confirmado:'confirmado',concluido:'concluido',cancelado:'cancelado'}[o.situacao]||'aberto';
      const shifts=o.turnos||[], requested=shifts.length*Number(o.quantidade_diaristas||0);
      add({...context(o),key:`pedido:${o.id}`,kind:'pedido',stage,date:shifts[0]?.data||'',title:`Pedido #${o.id} · ${o.supermercado}`,detail:`${o.unidade||'Loja não informada'} · ${o.setor} · ${requested} diárias solicitadas`,action:'order',id:o.id});
      if(['cancelado','concluido'].includes(o.situacao))continue;
      for(const t of shifts){const active=(groups.get(`${o.id}:${t.data}`)||[]).filter(s=>s.status!=='falta');const vacancies=Math.max(0,Number(o.quantidade_diaristas)-active.length);
        if(vacancies)add({...context(o),key:`vaga:${o.id}:${t.data}`,kind:'escala',stage:'aberto',date:t.data,overdue:t.data<today,title:`${vacancies} vaga(s) · ${o.unidade||o.supermercado}`,detail:`${o.setor} · ${t.inicio}–${t.fim} · Pedido #${o.id}`,action:'order',id:o.id});
      }
    }
    const scaleById=new Map(scales.map(s=>[s.id,s]));
    for(const s of scales){const o=orderById.get(s.pedido_id);if(!o)continue;
      let stage='aberto', detail='Aguardando resposta do diarista';
      if(s.status==='presente'){stage=s.loja_validacao==='validado'?'concluido':s.loja_validacao==='divergencia'?'aberto':'confirmado';detail=s.loja_validacao==='validado'?'Presença e atendimento validados':s.loja_validacao==='divergencia'?'Presença registrada · divergência da loja':'Presença registrada · conferir validação da loja';}
      else if(o.situacao==='cancelado'){stage='cancelado';detail='Pedido cancelado';}
      else if(s.status==='falta'){const replacement=scaleById.get(s.substituida_por_escala_id);stage=replacement&&replacement.status!=='falta'?'concluido':'aberto';detail=stage==='concluido'?'Falta com substituição registrada':'Falta · substituição pendente';}
      else if(s.confirmacao==='recusou')detail='Recusou · retirar da escala e substituir';
      else if(s.data<=today)detail=s.confirmacao==='confirmou'?'Disponibilidade confirmada · registrar presença ou falta':'Resposta e presença ainda por conferir';
      else if(s.confirmacao==='confirmou'){stage='confirmado';detail='Disponibilidade confirmada · presença ainda não registrada';}
      add({...context(o),key:`escala:${s.id}`,kind:'escala',stage,date:s.data,overdue:stage==='aberto'&&s.data<today,title:s.diarista_nome||`Diarista #${s.diarista_id}`,detail:`${detail} · ${o.unidade||o.supermercado} · ${o.setor}`,action:'order',id:o.id,workerId:s.diarista_id});
    }
    const billed=new Set(invoices.filter(i=>i.status!=='cancelada').flatMap(i=>(i.itens||[]).map(x=>x.diaria_id)));
    for(const f of finance.filter(f=>f.origem!=='cobranca')){
      const s=scaleById.get(f.pedido_escala_id), o=s?orderById.get(s.pedido_id):null;
      add({...context(o),key:`finance:${f.origem}:${f.id}`,kind:'pagamento',stage:f.data_pagamento?'concluido':'aberto',date:f.vencimento||f.referencia||f.data_referencia||'',overdue:!f.data_pagamento&&!!f.vencimento&&f.vencimento<today,title:f.contraparte||f.descricao,detail:`${f.tipo==='receita'?'Entrada':'Pagamento'} · ${f.descricao}${f.valor_centavos==null?' · valor não informado':''}`,amount:f.valor_centavos,action:'finance',id:f.id,origin:f.origem});
      if(f.origem==='diaria'&&s?.status==='presente'&&!billed.has(f.id))add({...context(o),key:`faturar:${f.id}`,kind:'cobranca',stage:'aberto',date:s.data,title:`Cobrar presença · ${f.contraparte}`,detail:`Pedido #${o?.id} · ${o?.unidade||''} · ${o?.setor||''} · ainda sem cobrança`,amount:f.valor_recebido_centavos,action:'bill',id:f.id});
    }
    for(const i of invoices){const balance=Math.max(0,i.valor_centavos-(i.valor_recebido_centavos||0));const stage=i.status==='cancelada'?'cancelado':balance===0?'concluido':i.conferencia==='conferida'?'confirmado':'aberto';
      add({key:`cobranca:${i.id}`,kind:'cobranca',stage,network:i.rede,date:i.vencimento,overdue:stage!=='cancelado'&&balance>0&&i.vencimento<today,title:`Cobrança #${i.id} · ${i.rede}`,detail:i.status==='cancelada'?'Cancelada':`${i.conferencia==='contestada'?'Contestada':balance===0?'Recebida':i.valor_recebido_centavos?'Recebimento parcial':'A receber'} · ${i.itens?.length||0} diárias`,amount:balance,action:'invoice',id:i.id});
    }
    for(const r of readings)add({key:`leitura:${r.id}`,kind:'leitura',stage:r.status==='pendente'?'aberto':'concluido',date:date(r.atualizado_em||r.criado_em),title:`Leitura #${r.id} · ${r.tipo||'Dados'}`,detail:r.status==='pendente'?`Revisar: ${(r.faltando||[]).join(', ')||'informações incompletas'}`:'Revisão encerrada',network:r.dados?.supermercado||'',action:'reading',id:r.id});
    for(const r of occurrences){const o=orderById.get(r.pedido_id);add({...context(o),key:`ocorrencia:${r.id}`,kind:'ocorrencia',stage:r.estado==='aberta'?'aberto':'concluido',date:date(r.criado_em),title:`Ocorrência #${r.id} · ${r.tipo.replaceAll('_',' ')}`,detail:r.descricao,action:'occurrence',id:r.id,orderId:r.pedido_id});}
    for(const w of workers.filter(w=>!w.bloqueada)){const confirmed=date(w.disponibilidade_confirmada_em);const stale=!confirmed||(Date.parse(today)-Date.parse(confirmed))>30*86400000;const missing=!w.telefone;
      const incomplete=[!w.setores?.length?'setores':'',!w.cep||!w.logradouro||!w.numero||!w.bairro?'endereço':'',!w.disponibilidade?.length?'dias e horários':'',w.trabalhando==null?'trabalho atual':'',w.pode_se_deslocar==null?'locomoção':''].filter(Boolean);
      if(stale||missing||incomplete.length)add({key:`cadastro:${w.id}`,kind:'cadastro',stage:'aberto',date:confirmed,title:w.nome,detail:[incomplete.length?`Completar ${incomplete.join(', ')}`:'',missing?'Completar telefone':'',stale?'Reconfirmar disponibilidade':''].filter(Boolean).join(' · '),action:'worker',id:w.id});
    }
    for(const c of contracts){if(c.fim&&c.fim>=today&&(Date.parse(c.fim)-Date.parse(today))<=30*86400000)add({key:`contrato:${c.id}`,kind:'contrato',stage:'aberto',network:c.rede,date:c.fim,title:`Contrato #${c.id} · ${c.rede}`,detail:`Vigência termina em ${c.fim} · revisar condições`,action:'contract',id:c.id});}
    return [...rows.values()].sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(a.date||'9999').localeCompare(b.date||'9999')||a.key.localeCompare(b.key));
  }
  function filter(rows,{search='',stage='all',kind='all',network='all',start='',end='',overdue=false}={}){
    return rows.filter(r=>(stage==='all'||r.stage===stage)&&(kind==='all'||r.kind===kind)&&(network==='all'||norm(r.network)===norm(network))&&(!overdue||r.overdue)&&(!start||(r.date&&r.date>=start))&&(!end||(r.date&&r.date<=end))&&(!search||norm(`${r.title} ${r.detail} ${r.network} ${r.unit} ${r.sector}`).includes(norm(search))));
  }
  function networkNames(rows,stores=[]){const preferred=new Map(stores.map(s=>[norm(s.rede),s.rede]));const names=new Map();for(const r of rows)if(r.network)names.set(norm(r.network),preferred.get(norm(r.network))||r.network);return [...names.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));}
  const counts=rows=>Object.fromEntries(['aberto','confirmado','concluido','cancelado'].map(stage=>[stage,rows.filter(r=>r.stage===stage).length]));
  // A tela mostra itens agrupados; os registros originais continuam sendo a fonte de verdade.
  function simplify(input,today){
    const tasks=build(input,today), orders=new Map((input.orders||[]).map(o=>[o.id,o])), scales=new Map((input.scales||[]).map(s=>[s.id,s]));
    const entries=new Map();
    const add=(key,area,meta,issue)=>{if(!entries.has(key))entries.set(key,{key,area,...meta,issues:[]});if(issue)entries.get(key).issues.push(issue);};
    for(const o of orders.values())add(`pedido:${o.id}`,'operacao',{title:`${o.supermercado} · ${o.unidade||'Loja não informada'}`,subtitle:`${o.setor} · Pedido #${o.id}`,action:'order',id:o.id,network:o.supermercado,cancelled:o.situacao==='cancelado',emptyDate:o.turnos?.[0]?.data||'',emptyDetail:o.situacao==='cancelado'?'Pedido cancelado':'Sem pendências de operação'},null);
    for(const r of tasks){
      if(r.kind==='pedido')continue;
      let issue={...r,waiting:false,label:{worker:'Completar cadastro',reading:'Revisar leitura',invoice:'Conferir cobrança',finance:'Conferir lançamento',bill:'Criar cobrança',occurrence:'Resolver ocorrência',contract:'Revisar contrato'}[r.action]||'Abrir pedido'};
      if(r.kind==='escala'){
        const o=orders.get(r.orderId);if(o?.situacao==='cancelado')continue;
        const s=r.key.startsWith('escala:')?scales.get(Number(r.key.split(':')[1])):null;
        if(!s){issue.label='Escalar diarista';issue.detail=r.title+' · '+r.detail;}
        else if(s.status==='falta'){issue.label=r.stage==='concluido'?'Ver substituição':'Substituir diarista';}
        else if(s.status==='presente'){issue.label=r.stage==='concluido'?'Ver atendimento':'Conferir atendimento';}
        else if(s.confirmacao==='recusou')issue.label='Substituir diarista';
        else if(s.data<=today)issue.label='Conferir presença';
        else {if(s.confirmacao==='confirmou')continue;issue.waiting=true;issue.label='Conferir resposta';}
        const shift=o?.turnos?.find(t=>t.data===r.date);
        const message=!s?`${r.title.split(' ')[0]} vaga(s) sem diarista`:s.status==='falta'?r.stage==='concluido'?'Falta com substituição registrada':'Falta; precisa de substituição':s.status==='presente'?r.stage==='concluido'?'Presença validada':s.loja_validacao==='divergencia'?'Conferir divergência da loja':'Presença registrada; falta validar com a loja':s.confirmacao==='recusou'?'Recusou; precisa de substituição':s.data<=today?'Registrar presença ou falta':'Aguardando resposta do diarista';
        issue.detail=[s?r.title:'',message,shift?`${shift.inicio}–${shift.fim}`:''].filter(Boolean).join(' · ');
        issue.overdue=['aberto','confirmado'].includes(r.stage)&&!!r.date&&r.date<today;
        add(`pedido:${r.orderId}`,'operacao',{},issue);continue;
      }
      if(r.kind==='ocorrencia'&&orders.has(r.orderId)&&orders.get(r.orderId).situacao!=='cancelado'){
        add(`pedido:${r.orderId}`,'operacao',{},issue);continue;
      }
      const area=['pagamento','cobranca','contrato'].includes(r.kind)?'financeiro':['cadastro','leitura'].includes(r.kind)?'cadastros':'operacao';
      let key=r.key,meta={title:r.title,subtitle:kindsLabel(r.kind),action:r.action,id:r.id,origin:r.origin,network:r.network};
      if(r.kind==='pagamento'&&r.origin==='diaria'){
        const f=(input.finance||[]).find(f=>f.id===r.id&&f.origem===r.origin),s=scales.get(f?.pedido_escala_id);
        key=`pagamentos:${s?.diarista_id??f?.diarista_id??norm(r.title)}`;meta={...meta,title:r.title,subtitle:'Diárias do diarista',action:'payments',workerName:r.title,workerId:s?.diarista_id??f?.diarista_id};issue.label=r.stage==='concluido'?'Ver pagamento':'Conferir pagamento';
      }else if(r.key.startsWith('faturar:')){
        key=`faturar-pedido:${r.orderId}`;meta={...meta,title:`${r.network} · ${r.unit}`,subtitle:`Diárias sem cobrança · Pedido #${r.orderId}`,action:'bill'};
      }else if(r.kind==='cobranca'){
        const invoice=(input.invoices||[]).find(i=>i.id===r.id);issue.waiting=!!invoice&&invoice.conferencia==='conferida'&&['aberto','confirmado'].includes(r.stage);issue.label=invoice?.conferencia==='contestada'?'Revisar contestação':issue.waiting?'Conferir recebimento':'Conferir cobrança';
      }
      add(key,area,meta,issue);
    }
    const result=[];
    for(const entry of entries.values()){
      const pending=entry.issues.filter(r=>['aberto','confirmado'].includes(r.stage));
      if(entry.key.startsWith('pedido:')){
        const o=orders.get(entry.id);
        if(!pending.length&&!entry.cancelled&&['novo','em_selecao'].includes(o.situacao))pending.push({key:`confirmar:${o.id}`,stage:'aberto',date:o.turnos?.[0]?.data||'',title:entry.title,detail:'Conferir o pedido e atualizar sua situação.',action:'order',id:o.id,label:'Conferir pedido',network:o.supermercado,waiting:false,overdue:!!o.turnos?.[0]?.data&&o.turnos[0].data<today});
        if(pending.length||entry.cancelled||o.situacao==='concluido'||!(o.turnos||[]).some(t=>t.data>today))result.push(summarize(entry,pending.length?pending:entry.issues,today,pending.length?'pending':'history'));
      }else{
        if(pending.length)result.push(summarize(entry,pending,today,'pending'));
        const history=entry.issues.filter(r=>!['aberto','confirmado'].includes(r.stage));
        if(history.length)result.push(summarize(entry,history,today,'history'));
      }
    }
    return result.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||Number(b.today)-Number(a.today)||(a.date||'9999').localeCompare(b.date||'9999')||a.key.localeCompare(b.key));
  }
  function kindsLabel(kind){return {leitura:'Leitura para revisar',cadastro:'Dados do diarista',pagamento:'Lançamento financeiro',cobranca:'Cobrança da rede',contrato:'Vigência do contrato',ocorrencia:'Ocorrência'}[kind]||'Pedido';}
  function summarize(entry,issues,today,view){
    issues=issues.slice().sort((a,b)=>Number(b.overdue)-Number(a.overdue)||Number(b.date===today)-Number(a.date===today)||(a.date||'9999').localeCompare(b.date||'9999')||a.key.localeCompare(b.key));
    const amounts=issues.filter(i=>i.amount!=null),missingAmounts=issues.filter(i=>i.kind==='pagamento'&&i.amount==null).length;
    const dates=issues.map(i=>i.date).filter(Boolean).sort();
    return {...entry,issues,view,date:dates[0]||entry.emptyDate||'',today:issues.some(i=>i.date===today),overdue:view==='pending'&&issues.some(i=>i.overdue),waiting:view==='pending'&&!!issues.length&&issues.every(i=>i.waiting),amount:amounts.length?amounts.reduce((n,i)=>n+Number(i.amount),0):null,missingAmounts,detail:entry.action==='payments'?`${issues.length} diária(s) ${view==='pending'?'a pagar':'pagas'}`:entry.key.startsWith('faturar-pedido:')?`${issues.length} presença(s) ainda sem cobrança`:issues[0]?.detail||entry.emptyDetail||'',label:entry.action==='payments'?'Conferir diárias':issues[0]?.label||(view==='history'?'Ver pedido':'Abrir pedido')};
  }
  function pendingFilter(entries,{area='operacao',view='pending',scope='all',search='',network='all',start='',end=''}={},today){
    return entries.filter(e=>e.area===area&&e.view===view).flatMap(e=>{
      let issues=e.issues.filter(i=>(network==='all'||norm(i.network||e.network)===norm(network))&&(!start||(i.date&&i.date>=start))&&(!end||(i.date&&i.date<=end)));
      if(!e.issues.length){if((network!=='all'&&norm(e.network)!==norm(network))||(start&&(!e.date||e.date<start))||(end&&(!e.date||e.date>end)))return [];}
      else if(!issues.length)return [];
      const item=summarize(e,issues,today,view);
      if(search&&!norm(`${item.title} ${item.subtitle} ${issues.map(i=>`${i.title} ${i.detail}`).join(' ')}`).includes(norm(search)))return [];
      if(scope==='today'&&!item.today||scope==='overdue'&&!item.overdue||scope==='waiting'&&!item.waiting)return [];
      return [item];
    });
  }
  if(typeof window!=='undefined')window.DirectCRM={build,filter,counts,networkNames,simplify,pendingFilter};
  if(typeof module!=='undefined')module.exports={build,filter,counts,networkNames,simplify,pendingFilter};
})();
