/* Mensagens para copiar: só nomes e dados da escala, nunca CPF ou valores da rede. */
(function(root,factory){if(typeof module==='object')module.exports=factory();else root.DirectMessagesModel=factory();})(typeof window==='undefined'?globalThis:window,()=>{
  const clean=v=>String(v||'').replace(/[\r\n*`_]/g,' ').replace(/\s+/g,' ').trim();
  const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('/'):'Data a confirmar';
  const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100):'Valor a confirmar';
  function storeFor(order,stores=[]){const found=stores.filter(s=>norm(s.rede)===norm(order.supermercado)&&norm(s.nome)===norm(order.unidade));return found.length===1?found[0]:null;}
  function address(order,stores){const s=storeFor(order,stores);return s?[s.endereco,s.bairro,[s.cidade,s.uf||'CE'].filter(Boolean).join('/')].filter(Boolean).map(clean).join(', '):'Confirmar endereço com a Direct';}
  const active=s=>['escalada','presente'].includes(s.status);
  function compose(kind,{order,scales=[],stores=[],personId=null,today='',time=''}){
    if(!order)throw Error('Pedido não encontrado.');
    const shifts=(order.turnos||[]).slice().sort((a,b)=>a.data.localeCompare(b.data));
    const base=`*Rede:* ${clean(order.supermercado)}\n*Loja:* ${clean(order.unidade)}\n*Endereço:* ${address(order,stores)}`;
    if(kind==='address')return base;
    const candidates=scales.filter(s=>s.pedido_id===order.id&&active(s)&&(kind!=='reminder'||personId==null||String(s.diarista_id)===String(personId)));
    let days=shifts;
    if(kind==='vacancy'||kind==='replacement'){
      if(['cancelado','concluido'].includes(order.situacao))throw Error('Este pedido não está disponível.');
      days=shifts.filter(t=>(!today||t.data>today||(t.data===today&&(!time||t.inicio>=time)))&&candidates.filter(s=>s.data===t.data).length<Number(order.quantidade_diaristas));
      if(!days.length)throw Error('Este pedido não tem vagas disponíveis.');
    }else if(kind==='reminder'&&personId!=null){days=shifts.filter(t=>candidates.some(s=>s.data===t.data)&&(!today||t.data>=today));if(!days.length)throw Error('Não há escala ativa para esta pessoa no período.');}
    const title={team:'*ESCALA — DIRECT PROMOÇÕES*',vacancy:'*DIÁRIA DISPONÍVEL — DIRECT PROMOÇÕES*',reminder:'*LEMBRETE DE ESCALA — DIRECT PROMOÇÕES*',replacement:'*SUBSTITUIÇÃO — DIRECT PROMOÇÕES*'}[kind];
    if(!title)throw Error('Escolha um modelo de mensagem.');
    const lines=[title,base,`*Setor:* ${clean(order.setor)}`,`*Quantidade de dias:* ${days.length}`,'','*Dias e horários:*'];
    for(const t of days){const people=candidates.filter(s=>s.data===t.data);let line=`• ${date(t.data)} — ${clean(t.inicio)} às ${clean(t.fim)}`;
      if(kind==='vacancy'||kind==='replacement')line+=` — ${Math.max(0,Number(order.quantidade_diaristas)-people.length)} vaga(s)`;
      else line+=people.length?`\n  *Diaristas:* ${people.map(s=>`${clean(s.diarista_nome)} (${s.status==='presente'?'presença registrada':s.confirmacao==='confirmou'?'confirmou que vai':s.confirmacao==='recusou'?'recusou; precisa de substituição':'aguardando confirmação'})`).join('; ')}`:'\n  *Diaristas:* ninguém escalado';
      lines.push(line);
    }
    if(kind==='vacancy'||kind==='replacement')lines.push('','É necessário ter disponibilidade para todos os dias e horários informados. O aceite depende de cadastro e confirmação da Direct.');
    if(kind==='reminder')lines.push('','Confirme com a Direct se mantém sua disponibilidade. A presença será registrada após o atendimento.');
    return lines.join('\n');
  }
  function payment(items=[]){
    if(!items.length)throw Error('Nenhuma diária selecionada.');
    const id=items[0].diarista_id;if(id==null||items.some(i=>String(i.diarista_id)!==String(id)))throw Error('Selecione diárias da mesma pessoa.');
    const paid=items.filter(i=>i.data_pagamento),pending=items.filter(i=>!i.data_pagamento);
    const sum=rows=>rows.every(i=>Number.isSafeInteger(i.valor_centavos))?money(rows.reduce((n,i)=>n+i.valor_centavos,0)):'Valor a confirmar';
    const lines=['*RESUMO DE DIÁRIAS — DIRECT PROMOÇÕES*',`*Diarista:* ${clean(items[0].contraparte)}`,''];
    for(const i of items.slice().sort((a,b)=>(a.data||a.referencia||'').localeCompare(b.data||b.referencia||'')))lines.push(`• ${date(i.data||i.referencia)} — ${clean(i.local)} — ${clean(i.setor)} — ${money(i.valor_centavos)}\n  ${i.data_pagamento?`Pago em ${date(i.data_pagamento)}`:i.vencimento?`Pagamento previsto: ${date(i.vencimento)}`:'Pagamento: prazo a confirmar'}`);
    if(pending.length)lines.push('',`*Total a pagar:* ${sum(pending)}`);if(paid.length)lines.push(`*Total pago:* ${sum(paid)}`);
    lines.push('','Resumo informativo. A data prevista não significa que o pagamento foi realizado.');return lines.join('\n');
  }
  return {compose,payment,storeFor,address};
});
