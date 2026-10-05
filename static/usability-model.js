/* Queue organization never changes operational or financial records. */
(function(root,factory){if(typeof module==='object')module.exports=factory();else root.DirectQueue=factory();})(typeof window==='undefined'?globalThis:window,()=>{
 function prepare(entries,controls,now=Date.now()){
  const map=new Map((controls||[]).map(c=>[c.chave,c])),seen=new Set();
  return entries.filter(r=>{const key=r.view+':'+r.key;if(seen.has(key))return false;seen.add(key);return true;}).map(r=>{const control=map.get(r.key)||{};return {...r,control,snoozed:r.view==='pending'&&Date.parse(control.adiada_ate)>now,priority:r.overdue?0:r.today?1:r.waiting?3:2};}).sort((a,b)=>a.priority-b.priority||(a.date||'9999').localeCompare(b.date||'9999')||a.key.localeCompare(b.key));
 }
 function remaining(scale,scales){return scales.filter(s=>s.diarista_id===scale.diarista_id&&s.data>=scale.data&&s.status!=='presente'&&!s.substituida_por_escala_id).map(s=>s.data).sort();}
 return {prepare,remaining};
});
