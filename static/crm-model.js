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
  if(typeof window!=='undefined')window.DirectCRM={build,filter,counts,networkNames};
  if(typeof module!=='undefined')module.exports={build,filter,counts,networkNames};
})();
