/* Read-only daily view. Attendance always comes from recorded statuses. */
(function(root,factory){const model=factory();if(typeof module==='object')module.exports=model;else root.DirectDayModel=model;})(globalThis,()=>{
  const labels={escalada:'Presença a conferir',presente:'Presença registrada',falta:'Falta registrada',desistiu:'Desistência'};
  const normal=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR');
  function build(data,day){
    const orders=new Map((data.orders||[]).filter(o=>o.situacao!=='cancelado'&&o.turnos?.some(t=>t.data===day)).map(o=>[o.id,o]));
    const stores=new Map((data.stores||[]).map(s=>[normal(s.rede)+'|'+normal(s.nome),s]));
    const workers=new Map((data.workers||[]).map(w=>[w.id,w]));
    const rows=(data.scales||[]).filter(s=>s.data===day&&orders.has(s.pedido_id)).map(s=>{
      const o=orders.get(s.pedido_id),shift=o.turnos.find(t=>t.data===day),store=stores.get(normal(o.supermercado)+'|'+normal(o.unidade));
      return {id:s.id,orderId:o.id,day,worker:s.diarista_nome||workers.get(s.diarista_id)?.nome||'Diarista #'+s.diarista_id,network:o.supermercado,store:o.unidade,city:store?.cidade?.trim()||'Cidade não informada',sector:o.setor,start:shift.inicio,end:shift.fim,status:s.status,label:labels[s.status]||'Situação não informada',confirmation:s.confirmacao==='confirmou'?'Confirmou que vai':'Sem confirmação'};
    }).sort((a,b)=>String(a.start).localeCompare(String(b.start))||a.network.localeCompare(b.network,'pt-BR')||a.worker.localeCompare(b.worker,'pt-BR'));
    const active=rows.filter(r=>!['falta','desistiu'].includes(r.status)),cities=new Map();
    for(const row of active)cities.set(row.city,(cities.get(row.city)||0)+1);
    return {day,rows,assigned:active.length,present:rows.filter(r=>r.status==='presente').length,awaiting:rows.filter(r=>r.status==='escalada').length,absent:rows.filter(r=>r.status==='falta').length,cities:[...cities].map(([city,count])=>({city,count})).sort((a,b)=>b.count-a.count||a.city.localeCompare(b.city,'pt-BR'))};
  }
  const headers=['Data','Diarista','Rede','Loja','Cidade','Setor','Início previsto','Fim previsto','Presença','Confirmação'];
  const cells=rows=>[headers,...rows.map(r=>[r.day,r.worker,r.network,r.store,r.city,r.sector,r.start,r.end,r.label,r.confirmation])];
  const safe=value=>{const text=String(value??'');return /^[\s]*[=+@\-\t\r]/.test(text)?"'"+text:text;};
  const csv=rows=>'\uFEFF'+cells(rows).map(row=>row.map(value=>'"'+safe(value).replaceAll('"','""')+'"').join(';')).join('\r\n');
  const xml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
  const excel=rows=>'<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Escala"><Table>'+cells(rows).map(row=>'<Row>'+row.map(value=>'<Cell><Data ss:Type="String">'+xml(value)+'</Data></Cell>').join('')+'</Row>').join('')+'</Table></Worksheet></Workbook>';
  return {build,cells,csv,excel};
});
