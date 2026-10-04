/* Automação local: regras explícitas; nunca confirma presença ou publica um pedido. */
(function(root,factory){if(typeof module==='object')module.exports=factory();else root.DirectAutomation=factory();})(typeof window==='undefined'?globalThis:window,()=>{
 const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!Number.isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 const add=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 function draft(model,start){
  if(!valid(start))throw Error('Escolha uma data de início válida.');
  const d=model.dados||model,shifts=(d.turnos||[]).slice().sort((a,b)=>a.data.localeCompare(b.data));
  if(!shifts.length||shifts.length>90||!shifts.every(s=>valid(s.data)&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s.inicio)&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s.fim)&&s.inicio<s.fim))throw Error('Modelo sem dias e horários válidos.');
  const base=Date.parse(shifts[0].data+'T12:00:00Z');
  return {supermercado:d.supermercado,unidade:d.unidade,contato:d.contato||'',setor:d.setor,quantidade_diaristas:d.quantidade_diaristas,observacoes:d.observacoes||'',situacao:'novo',turnos:shifts.map(s=>({...s,data:add(start,Math.round((Date.parse(s.data+'T12:00:00Z')-base)/86400000))}))};
 }
 function alerts({orders=[],scales=[],workers=[]},now=new Date()){
  const ms=+new Date(now),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
  const out=[];for(const o of orders){if(['cancelado','concluido'].includes(o.situacao))continue;
   for(const t of o.turnos||[]){const hours=(Date.parse(t.data+'T'+t.inicio+':00-03:00')-ms)/3600000,s=scales.filter(x=>x.pedido_id===o.id&&x.data===t.data&&['escalada','presente'].includes(x.status));
    const missing=Math.max(0,o.quantidade_diaristas-s.length);if(missing&&hours<=24&&t.data>=today)out.push({key:'vacancy:'+o.id+':'+t.data,kind:'vacancy',level:hours<=2?'urgent':'soon',action:'order',id:o.id,date:t.data,title:o.supermercado+' · '+o.unidade,detail:t.data+' '+t.inicio+' · '+missing+' vaga(s) sem diarista',label:'Preencher escala'});
    const waiting=s.filter(x=>x.status==='escalada'&&x.confirmacao!=='confirmou').length;if(waiting&&hours<=24&&hours>=0)out.push({key:'response:'+o.id+':'+t.data,kind:'response',level:hours<=2?'urgent':'soon',action:'order',id:o.id,date:t.data,title:o.supermercado+' · '+o.unidade,detail:t.data+' '+t.inicio+' · '+waiting+' confirmação(ões) pendente(s)',label:'Pedir confirmação'});
   }
  }
  for(const w of workers){const updated=Date.parse(w.atualizado_em||w.criado_em||'');if(!w.bloqueada&&w.disponibilidade?.length&&Number.isFinite(updated)&&ms-updated>30*86400000)out.push({key:'availability:'+w.id,kind:'availability',level:'review',action:'worker',id:w.id,title:w.nome,detail:'Disponibilidade sem atualização há mais de 30 dias. Confira antes de escalar.',label:'Conferir cadastro'});}
  return out.sort((a,b)=>({urgent:0,soon:1,review:2}[a.level]-{urgent:0,soon:1,review:2}[b.level])||(a.date||'').localeCompare(b.date||''));
 }
 return {draft,alerts,add,valid};
});
