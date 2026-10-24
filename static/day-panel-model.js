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
  // Portable PDF export for mobile browsers; standard Courier/WinAnsi, no service or print dialog.
  function pdf(rows,day,filter='Todas as situações'){
    const latin=text=>Array.from(String(text??'').replace(/[\u0000-\u001f]/g,' '),c=>c.charCodeAt(0)<=255?c:'-').join('');
    const literal=text=>latin(text).replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
    const wrap=text=>{const parts=[];let rest=latin(text);while(rest.length>90){let end=rest.lastIndexOf(' ',90);if(end<30)end=90;parts.push(rest.slice(0,end));rest=rest.slice(end).trimStart();}parts.push(rest);return parts;};
    const pages=[];let commands=[],y=0;
    const text=(value,size=9,color='0.08 0.15 0.26')=>{commands.push(`${color} rg BT /F1 ${size} Tf 40 ${y} Td (${literal(value)}) Tj ET`);y-=size+4;};
    const page=()=>{if(commands.length)pages.push(commands);commands=[];y=798;text('DIRECT PROMOÇÕES - ESCALA DO DIA',14,'0.03 0.18 0.4');text(day+' | '+filter,10);text(rows.length+' registro(s) selecionado(s). Horários previstos; presença conforme registro.');y-=12;};
    page();
    for(const row of rows){const lines=[...wrap(row.worker),...wrap(row.network+' | '+row.store+' | '+row.city),...wrap(row.sector+' | '+row.day+' | Previsto: '+row.start+' às '+row.end),...wrap(row.label+' | '+row.confirmation)];if(y-lines.length*13-15<55)page();for(const [index,line]of lines.entries())text(line,index===0?10:9);commands.push(`0.8 0.86 0.93 RG 40 ${y-2} m 555 ${y-2} l S`);y-=17;}
    pages.push(commands);
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'];
    const ids=[];pages.forEach((lines,i)=>{const id=objects.length+1;ids.push(id+' 0 R');const stream=lines.join('\n')+`\n0.3 0.4 0.55 rg BT /F1 8 Tf 40 30 Td (Direct Promocoes | ${day} | Pagina ${i+1} de ${pages.length}) Tj ET\n`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);});
    objects[1]=`<< /Type /Pages /Count ${pages.length} /Kids [${ids.join(' ')}] >>`;
    let output='%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';const offsets=[0];objects.forEach((value,i)=>{offsets.push(output.length);output+=(i+1)+' 0 obj\n'+value+'\nendobj\n';});const xref=output.length;output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Uint8Array.from(output,c=>c.charCodeAt(0));
  }
  return {build,cells,csv,excel,pdf};
});
