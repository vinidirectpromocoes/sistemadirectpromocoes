/* Queue organization never changes operational or financial records. */
(function(root,factory){if(typeof module==='object')module.exports=factory();else root.DirectQueue=factory();})(typeof window==='undefined'?globalThis:window,()=>{
 function prepare(entries,controls,now=Date.now()){
  const map=new Map((controls||[]).map(c=>[c.chave,c])),seen=new Set();
  return entries.filter(r=>{const key=r.view+':'+r.key;if(seen.has(key))return false;seen.add(key);return true;}).map(r=>{const control=map.get(r.key)||{};return {...r,control,snoozed:r.view==='pending'&&Date.parse(control.adiada_ate)>now,priority:r.overdue?0:r.today?1:r.waiting?3:2};}).sort((a,b)=>a.priority-b.priority||(a.date||'9999').localeCompare(b.date||'9999')||a.key.localeCompare(b.key));
 }
 function remaining(scale,scales,order){
  const local=scales.filter(s=>s.pedido_id===scale.pedido_id);
  if(!order)return local.filter(s=>s.diarista_id===scale.diarista_id&&s.data>=scale.data&&s.status!=='presente'&&!s.substituida_por_escala_id).map(s=>s.data).sort();
  return order.turnos.filter(t=>{
   if(t.data<scale.data)return false;
   const origin=local.find(s=>s.diarista_id===scale.diarista_id&&s.data===t.data);
   if(origin)return origin.status!=='presente'&&!origin.substituida_por_escala_id;
   return local.filter(s=>s.data===t.data&&!['falta','desistiu'].includes(s.status)).length<order.quantidade_diaristas;
  }).map(t=>t.data).sort();
 }
 return {prepare,remaining};
});
