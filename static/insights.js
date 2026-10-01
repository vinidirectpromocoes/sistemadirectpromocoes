/* Indicadores puros, sem inferir presença, pontualidade ou recebimento sem registro. */
(() => {
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 function contract(contracts,order,day) {
  return (contracts||[]).filter(c=>norm(c.rede)===norm(order.supermercado)&&(!c.loja||norm(c.loja)===norm(order.unidade))&&(!c.setor||norm(c.setor)===norm(order.setor))&&c.inicio<=day&&(!c.fim||c.fim>=day))
   .sort((a,b)=>(Number(!!b.loja)*2+Number(!!b.setor))-(Number(!!a.loja)*2+Number(!!a.setor))||b.inicio.localeCompare(a.inicio)||b.id-a.id)[0]||null;
 }
 const ratio=(n,d)=>d?Math.round(n/d*100):null;
 function calculate(orders,scales,workers,occurrences,invoices,{today,start='',end='9999-12-31',now=Date.now()}={}) {
  const included=d=>d>=start&&d<=end;
  let demand=0,present=0,assigned=0,early=0,late=0,punctual=0,arrivalUnknown=0,absent=0,validated=0;
  const replacements=[]; const profiles=new Map(); const unresolved=[];
  const byId=new Map(scales.map(s=>[s.id,s]));
  for(const o of orders||[]) for(const shift of o.turnos||[]) {
   if(!included(shift.data))continue;
   const day=scales.filter(s=>s.pedido_id===o.id&&s.data===shift.data);
   const completed=day.filter(s=>s.status==='presente');
   if(shift.data<=today) demand+=o.situacao==='cancelado'?completed.length:o.quantidade_diaristas;
   const shiftStart=Date.parse(`${shift.data}T${shift.inicio}:00-03:00`);
   for(const s of day) {
    if(!['falta','desistiu'].includes(s.status)) {
     if(o.situacao!=='cancelado'||s.status==='presente')assigned++;
     if((o.situacao!=='cancelado'||s.status==='presente')&&s.confirmacao==='confirmou'&&Date.parse(s.confirmacao_em)<shiftStart)early++;
    }
    const profile=profiles.get(s.diarista_id)||{id:s.diarista_id,name:s.diarista_nome,present:0,absent:0,withdrawn:0,withdrawnAfterConfirmed:0,late:0,unknown:0,praise:0,complaints:0}; profiles.set(s.diarista_id,profile);
    if(s.status==='presente') {
     if(shift.data<=today)present++;profile.present++;
     if(s.loja_validacao==='validado')validated++;
     if(!s.chegada_em){arrivalUnknown++;profile.unknown++;}
     else if(Date.parse(s.chegada_em)>shiftStart){late++;profile.late++;}else punctual++;
    }
    if(s.status==='desistiu'){profile.withdrawn++;if(s.confirmacao==='confirmou')profile.withdrawnAfterConfirmed++;}
    if(s.status==='falta') {
     absent++;profile.absent++;
     const replacement=byId.get(s.substituida_por_escala_id);
     if(replacement&&!['falta','desistiu'].includes(replacement.status)&&s.falta_confirmada_em) {
      const minutes=(Date.parse(replacement.criado_em)-Date.parse(s.falta_confirmada_em))/60000;
      if(Number.isFinite(minutes)&&minutes>=0)replacements.push(minutes);
     }
    }
    if(s.status==='escalada'&&(s.confirmacao!=='confirmou'||shiftStart<now)&&o.situacao!=='cancelado'&&o.situacao!=='concluido')unresolved.push({order:o,shift,scale:s,started:shiftStart<=now});
   }
  }
  for(const occurrence of occurrences||[]) {
   const s=byId.get(occurrence.escala_id);if(!s||!included(s.data))continue;
   const profile=profiles.get(s.diarista_id);if(!profile)continue;
   if(occurrence.tipo==='elogio')profile.praise++;
   if(occurrence.tipo==='reclamacao')profile.complaints++;
  }
  const overdue=[];let contested=0;
  for(const i of invoices||[]) {
   if(i.status==='cancelada')continue;
   const balance=Math.max(0,i.valor_centavos-(i.valor_recebido_centavos||0));
   if(i.conferencia==='contestada')contested+=balance;
   if(i.vencimento<today&&balance)overdue.push({id:i.id,network:i.rede,balance,days:Math.floor((Date.parse(today)-Date.parse(i.vencimento))/86400000)});
  }
  const missingContact=(workers||[]).filter(w=>!w.telefone).length;
  const staleAvailability=(workers||[]).filter(w=>!w.disponibilidade_confirmada_em||(now-Date.parse(w.disponibilidade_confirmada_em))>30*86400000).length;
  return {demand,present,assigned,early,absent,validated,coverage:ratio(present,demand),confirmation:ratio(early,assigned),punctuality:ratio(punctual,punctual+late),punctual,late,arrivalUnknown,
   replacementMinutes:replacements.length?Math.round(replacements.reduce((a,b)=>a+b,0)/replacements.length):null,replacementCount:replacements.length,
   missingContact,staleAvailability,profiles:[...profiles.values()],unresolved,overdue,contested,
   openOccurrences:(occurrences||[]).filter(x=>x.estado==='aberta').length};
 }
 if(typeof window!=='undefined')window.DirectInsights={calculate,contract,ratio};
 if(typeof module!=='undefined')module.exports={calculate,contract,ratio};
})();
