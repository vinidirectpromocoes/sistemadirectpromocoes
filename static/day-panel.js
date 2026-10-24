/* Reference: Direct Gestão de Diárias. Uses the existing authorized Hub load. */
(()=>{
  const get=id=>document.getElementById(id),el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  let snapshot=null,visible=6,updatedAt=null;
  const permitted=()=>['admin','operacao','financeiro'].includes(window.directRemote?.role||'admin');
  const filtered=()=>snapshot?.rows.filter(r=>!get('home-day-status').value||r.status===get('home-day-status').value)||[];
  const feedback=text=>{get('home-day-feedback').textContent=text;get('home-day-feedback').hidden=false;};
  function render(){
    const panel=get('home-day-panel');panel.hidden=!permitted()||!snapshot;if(panel.hidden)return;
    for(const [id,value] of [['assigned',snapshot.assigned],['present',snapshot.present],['awaiting',snapshot.awaiting],['absent',snapshot.absent]])get('home-day-'+id).textContent=String(value);
    get('home-day-updated').textContent='Atualizado às '+updatedAt.toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'});
    const rows=filtered(),list=get('home-day-list');list.replaceChildren();get('home-day-count').textContent=rows.length+' registro(s) na data e situação selecionadas.';
    for(const row of rows.slice(0,visible)){
      const card=el('article','','day-row'),info=el('div');info.append(el('strong',row.worker),el('small',row.network+' · '+row.store+' · '+row.city),el('small',row.sector+' · '+row.start+' às '+row.end));
      const state=el('span',row.label,'day-status');state.dataset.status=row.status;const button=el('button','Ver pedido','button button-outline');button.type='button';button.setAttribute('aria-label','Ver pedido #'+row.orderId+' de '+row.worker);button.onclick=async()=>{button.disabled=true;try{await window.DirectHub.openRecord({action:'order',id:row.orderId});}catch(e){feedback(e.message);}finally{button.disabled=false;}};card.append(info,state,button);list.append(card);
    }
    if(!rows.length)list.append(el('p','Nenhuma escala registrada para esta data e situação.','day-empty'));
    get('home-day-more').hidden=rows.length<=visible;
    const cities=get('home-day-cities');cities.replaceChildren();const max=Math.max(1,...snapshot.cities.map(c=>c.count));for(const item of snapshot.cities){const line=el('div','','day-city'),bar=el('span','','day-city-bar'),fill=el('i');fill.style.width=(item.count/max*100)+'%';bar.append(fill);line.append(el('span',item.city),bar,el('strong',String(item.count)));cities.append(line);}if(!snapshot.cities.length)cities.append(el('p','Sem pessoas escaladas nesta data.','day-empty'));
    for(const id of ['home-day-csv','home-day-excel','home-day-print'])get(id).disabled=!rows.length;
  }
  function update(data,loadedAt){get('home-day-panel').hidden=true;if(!permitted())return;const day=get('home-day-date').value||homeToday();get('home-day-date').value=day;snapshot=DirectDayModel.build(data,day);updatedAt=loadedAt||new Date();get('home-day-feedback').hidden=true;render();}
  function download(kind){if(!permitted()||!snapshot)return;const rows=filtered(),excel=kind==='excel',blob=new Blob([excel?DirectDayModel.excel(rows):DirectDayModel.csv(rows)],{type:excel?'application/vnd.ms-excel;charset=utf-8':'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='direct-escala-'+snapshot.day+(excel?'.xls':'.csv');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback(rows.length+' registro(s) exportado(s). O arquivo segue a data e a situação selecionadas.');}
  function print(){if(!permitted()||!snapshot)return;const box=el('section','','print-demonstrative');box.id='day-print';box.append(el('h1','Direct Promoções — Escala do dia'),el('p',dateLabel(snapshot.day)+' · '+(get('home-day-status').selectedOptions[0].textContent)),el('p','Presenças e faltas registradas; horários previstos não comprovam entrada ou saída.'));const table=el('table');for(const [index,cells]of DirectDayModel.cells(filtered()).entries()){const tr=el('tr');for(const value of cells)tr.append(el(index?'td':'th',String(value??'')));table.append(tr);}box.append(table);document.body.append(box);document.body.classList.add('printing-demonstrative');const clean=()=>{box.remove();document.body.classList.remove('printing-demonstrative');};window.addEventListener('afterprint',clean,{once:true});try{window.print();}catch(e){clean();feedback('Não foi possível abrir a impressão: '+e.message);}}
  get('home-day-date').value=homeToday();get('home-day-date').onchange=()=>{visible=6;window.DirectHub?.renderDay();};get('home-day-status').onchange=()=>{visible=6;render();};get('home-day-more').onclick=()=>{visible+=6;render();};get('home-day-csv').onclick=()=>download('csv');get('home-day-excel').onclick=()=>download('excel');get('home-day-print').onclick=print;
  window.DirectDayPanel={update,clear(){snapshot=null;get('home-day-list').replaceChildren();get('home-day-cities').replaceChildren();get('home-day-panel').hidden=true;}};
  window.addEventListener('direct:signed-out',()=>window.DirectDayPanel.clear());
})();
