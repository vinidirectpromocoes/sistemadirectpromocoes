/* Relatórios e caixa derivados dos registros; valores em centavos. */
(function(root,factory){if(typeof module==='object')module.exports=factory(require('./forecast.js'),require('./payment-calendar.js'));else root.DirectManagement=factory(root.DirectForecast,root.DirectPaymentCalendar);})(typeof window==='undefined'?globalThis:window,(forecast,calendar)=>{
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),active=s=>['escalada','presente'].includes(s.status),clean=v=>String(v||'').replace(/[\r\n*`_]/g,' ').trim();
 const grouped=scales=>{const out={};for(const s of scales||[])(out[s.pedido_id]||=[]).push(s);return out;};
 const date=d=>d?.split('-').reverse().join('/')||'A confirmar';
 function monthly(data,store,month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Escolha o mês.');
  const orders=(data.orders||[]).filter(o=>norm(o.supermercado)===norm(store.rede)&&norm(o.unidade)===norm(store.nome)),ids=new Set(orders.map(o=>o.id)),scales=(data.scales||[]).filter(s=>ids.has(s.pedido_id)&&s.data.startsWith(month));
  let requested=0;for(const o of orders)for(const t of o.turnos||[])if(t.data.startsWith(month))requested+=o.situacao==='cancelado'?scales.filter(s=>s.pedido_id===o.id&&s.data===t.data&&s.status==='presente').length:Number(o.quantidade_diaristas);
  const attended=scales.filter(s=>s.status==='presente').length,occ=(data.occurrences||[]).filter(x=>ids.has(x.pedido_id)&&String(x.criado_em||'').startsWith(month));
  const result={requested,attended,unattended:Math.max(0,requested-attended),absences:scales.filter(s=>s.status==='falta').length,withdrawals:scales.filter(s=>s.status==='desistiu').length,replacements:scales.filter(s=>s.substituida_por_escala_id!=null).length,occurrences:occ.length,resolved:occ.filter(x=>x.estado==='resolvida').length,rate:requested?Math.round(attended/requested*100):0,orders:orders.filter(o=>o.turnos.some(t=>t.data.startsWith(month))).length};
  result.text=['*RELATÓRIO DE ATENDIMENTO — DIRECT PROMOÇÕES*','*Rede:* '+clean(store.rede),'*Loja:* '+clean(store.nome),'*Mês:* '+month.split('-').reverse().join('/'),'','Pedidos: '+result.orders,'Diárias solicitadas: '+requested,'Presenças: '+attended,'Atendimento: '+result.rate+'%','Diárias ainda sem presença registrada: '+result.unattended,'Faltas registradas: '+result.absences,'Desistências: '+result.withdrawals,'Substituições: '+result.replacements,'Ocorrências resolvidas: '+result.resolved+' de '+result.occurrences,'','Dados conforme registros da operação. Dias futuros do mês ainda não são atendimentos realizados. Faltas/substituições são eventos; a substituição pode recompor a diária.'].join('\n');return result;
 }
 function daily(data,today){const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const next=tomorrow.toISOString().slice(0,10),by=grouped(data.scales),lines=['*RESUMO DA OPERAÇÃO — DIRECT PROMOÇÕES*','*Data:* '+date(today)],stats={requested:0,present:0,absent:0,replacements:0,tomorrowOpen:0,awaiting:0};
  for(const o of data.orders||[]){if(o.situacao==='cancelado')continue;const scales=by[o.id]||[];
   for(const t of o.turnos||[]){const rows=scales.filter(s=>s.data===t.data);if(t.data===today){stats.requested+=o.quantidade_diaristas;stats.present+=rows.filter(s=>s.status==='presente').length;stats.absent+=rows.filter(s=>s.status==='falta').length;stats.replacements+=rows.filter(s=>s.substituida_por_escala_id!=null).length;stats.awaiting+=rows.filter(s=>s.status==='escalada').length;lines.push('',clean(o.supermercado)+' · '+clean(o.unidade)+' · '+clean(o.setor)+' · '+t.inicio+'–'+t.fim,...rows.filter(active).map(s=>'• '+clean(s.diarista_nome||data.workers?.find(w=>w.id===s.diarista_id)?.nome||'Diarista')+' — '+(s.status==='presente'?'presença registrada':s.confirmacao==='confirmou'?'confirmou que vai':'aguardando confirmação/presença')));if(!rows.some(active))lines.push('• Sem diarista ativo');}
    if(t.data===next&&!['concluido','cancelado'].includes(o.situacao))stats.tomorrowOpen+=Math.max(0,o.quantidade_diaristas-rows.filter(active).length);
   }
  }
  const pending=(data.occurrences||[]).filter(x=>x.estado!=='resolvida').length;
  lines.splice(2,0,'Solicitadas: '+stats.requested+' · Presenças: '+stats.present+' · Faltas: '+stats.absent,'Substituições: '+stats.replacements+' · Presença ainda a registrar: '+stats.awaiting,'Vagas de amanhã: '+stats.tomorrowOpen+' · Ocorrências em aberto: '+pending);return {...stats,text:lines.join('\n')};
 }
 function agenda({orders=[],scales=[],tariffs={},finance=[]}){
  const by=grouped(Array.isArray(scales)?scales:Object.values(scales).flat()),days=new Map();let missing=0;
  const add=(d,key,value)=>{if(!value)return;const k=d||'sem-prazo',row=days.get(k)||{date:d||'',expectedIncome:0,expectedOut:0,actualIncome:0,actualOut:0};row[key]+=value;days.set(k,row);};
  const invoices=finance.filter(f=>f.origem==='cobranca'&&f.status!=='cancelada'),billed=new Set(invoices.flatMap(f=>(f.itens||[]).map(i=>i.diaria_id))),linked=new Set();
  for(const o of orders)for(const t of o.turnos||[]){const ds=(by[o.id]||[]).filter(s=>s.data===t.data),f=forecast.calculate([{...o,turnos:[t]}],by,tariffs),due=calendar.forNetwork(t.data,o.supermercado,tariffs.redes||[]);let income=f.expected.revenue,out=f.expected.cost;
   for(const s of ds){if(!s.diaria)continue;linked.add(s.diaria.id);if(s.status==='presente'){if(billed.has(s.diaria.id))income-=s.diaria.valor_recebido_centavos||0;if(s.diaria.data_pagamento)out-=s.diaria.valor_centavos||0;}}
   missing+=f.missingRevenue+f.missingCost+f.confirmedMissingRevenue+f.confirmedMissingCost;
   // Presenças podem ter vencimentos congelados diferentes do calendário atual.
   for(const s of ds.filter(s=>s.status==='presente'&&s.diaria)){
    const d=s.diaria;if(!billed.has(d.id)&&d.vencimento_recebimento&&d.vencimento_recebimento!==due){income-=d.valor_recebido_centavos||0;add(d.vencimento_recebimento,'expectedIncome',d.valor_recebido_centavos||0);}
    if(!d.data_pagamento&&d.vencimento_pagamento&&d.vencimento_pagamento!==due){out-=d.valor_centavos||0;add(d.vencimento_pagamento,'expectedOut',d.valor_centavos||0);}
   }
   add(due,'expectedIncome',Math.max(0,income));add(due,'expectedOut',Math.max(0,out));
  }
  for(const f of finance){if(f.origem==='cobranca'){
    if(f.status==='cancelada')continue;add(f.vencimento,'expectedIncome',Math.max(0,f.valor_centavos-(f.valor_recebido_centavos||0)));for(const r of f.recebimentos||[])if(!r.estornado)add(r.data_recebimento,'actualIncome',r.valor_centavos);continue;
   }
   if(f.data_pagamento){if(f.valor_centavos==null){missing++;continue;}add(f.data_pagamento,f.tipo==='receita'?'actualIncome':'actualOut',f.valor_centavos);}
   else if(f.origem!=='diaria'||!linked.has(f.id)){if(f.valor_centavos==null){missing++;continue;}add(f.vencimento,f.tipo==='receita'?'expectedIncome':'expectedOut',f.valor_centavos);}
  }
  return {days:[...days.values()].sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')),missing};
 }
 return {monthly,daily,agenda,grouped};
});
