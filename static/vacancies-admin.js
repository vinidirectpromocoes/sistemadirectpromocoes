/* Painel interno do mesmo catálogo usado pelos links privados dos diaristas. */
(() => {
  const $ = id => document.getElementById(id);
  const allowed = () => ['admin','operacao'].includes(window.directRemote?.role);
  const active = () => location.hash === '#vagas';
  let session = 0, sequence = 0;
  const node = (tag,text,cls='') => { const e=document.createElement(tag); e.textContent=text; e.className=cls; return e; };
  async function rpc(name,args) {
    if (!allowed()) throw Error('Disponível no sistema publicado para administrador e operação.');
    const {data,error}=await window.directRemote.client.rpc(name,args);
    if(error) throw Error(error.message);
    return data;
  }
  function render(items) {
    $('vacancy-list').replaceChildren(); $('vacancy-count').textContent=items.length;
    $('vacancy-status').hidden=items.length>0;
    $('vacancy-status').textContent='Nenhuma escala completa disponível. Cadastre um pedido na Leitura IA ou na aba Pedidos.';
    for(const o of items) {
      const row=node('div','','portal-registration-row'); const info=node('div','');
      info.append(node('strong',o.rede+' · '+o.loja));
      info.append(node('small',o.setor+' · '+o.turnos.length+' dia(s) · '+Math.min(...o.turnos.map(t=>t.vagas))+' vaga(s) na escala inteira'));
      info.append(node('small',o.turnos.map(t=>t.data.split('-').reverse().join('/')+' · '+t.inicio+'–'+t.fim).join(' / ')));
      const view=node('button','','view-button'); view.type='button'; view.append(eyeIcon()); view.title='Ver pedido'; view.setAttribute('aria-label','Ver pedido '+o.rede+' '+o.loja+' '+o.setor);
      view.addEventListener('click',async()=>{
        const version=session; view.disabled=true;
        try { await loadOrders(); if(version!==session||!allowed())return;
          if(!orderRecords.some(p=>p.id===o.id)){await refresh();return;}
          await openOrderDetail(o.id);
        } catch(e) { $('vacancy-status').hidden=false; $('vacancy-status').textContent=e.message; }
        finally { view.disabled=false; }
      });
      row.append(info,view); $('vacancy-list').append(row);
    }
  }
  async function refresh() {
    const version=++sequence; $('vacancy-refresh').disabled=true;
    try {
      const items=await rpc('direct_portal_vacancies');
      if(version!==sequence||!allowed())return;
      render(items);
    } catch(e) {
      if(version!==sequence)return;
      $('vacancy-list').replaceChildren(); $('vacancy-count').textContent='—';
      $('vacancy-status').hidden=false; $('vacancy-status').textContent='Não foi possível carregar as vagas: '+e.message;
    } finally { if(version===sequence)$('vacancy-refresh').disabled=false; }
  }
  async function workers() {
    const version=session;
    $('vacancy-share-form').querySelector('button').disabled=!allowed();
    if(!allowed())return;
    try {
      const rows=await request('/api/diaristas');
      if(version!==session||!allowed())return;
      const selected=$('vacancy-worker').value;
      $('vacancy-worker').replaceChildren(new Option('Selecione um diarista',''));
      rows.filter(w=>!w.bloqueada).forEach(w=>$('vacancy-worker').append(new Option(w.nome,String(w.id))));
      if([...$('vacancy-worker').options].some(o=>o.value===selected))$('vacancy-worker').value=selected;
    } catch(e) { $('vacancy-share-feedback').textContent='Não foi possível carregar os diaristas: '+e.message; }
  }
  $('vacancy-share-form').addEventListener('submit',async e=>{
    e.preventDefault();const b=e.submitter,version=session;b.disabled=true;
    $('vacancy-share-result').hidden=true; $('vacancy-share-url').value='';
    try {
      const data=await rpc('direct_portal_vacancies_invite',{p_diarista_id:Number($('vacancy-worker').value)});
      if(version!==session||!allowed())return;
      $('vacancy-share-url').value=new URL('/vagas.html#convite='+data.vagas_token,location.origin).href;
      $('vacancy-share-result').hidden=false;
      $('vacancy-share-feedback').textContent='Envie apenas para a pessoa selecionada. Válido até '+new Date(data.expira_em).toLocaleDateString('pt-BR')+'.';
    } catch(e) { if(version===session)$('vacancy-share-feedback').textContent=e.message; }
    finally { b.disabled=false; }
  });
  $('vacancy-copy').addEventListener('click',async()=>{
    if(!allowed()||!$('vacancy-share-url').value)return;
    try { await navigator.clipboard.writeText($('vacancy-share-url').value); $('vacancy-share-feedback').textContent='Link das vagas copiado. Envie no privado do diarista.'; }
    catch { $('vacancy-share-url').focus(); $('vacancy-share-url').select(); $('vacancy-share-feedback').textContent='Selecione e copie o link acima.'; }
  });
  function update() { if(active()){refresh();workers();} }
  function visibleUpdate() { if(active()&&allowed()&&!document.hidden){refresh();} }
  $('vacancy-refresh').addEventListener('click',update);
  $('vacancy-share-form').closest('details').addEventListener('toggle',e=>{if(e.target.open)workers();});
  window.addEventListener('hashchange',update); window.addEventListener('direct:authorized',update);
  window.addEventListener('focus',visibleUpdate); window.addEventListener('online',visibleUpdate);
  window.addEventListener('direct:data-changed',visibleUpdate);
  document.addEventListener('visibilitychange',visibleUpdate); setInterval(visibleUpdate,15000);
  window.addEventListener('direct:signed-out',()=>{
    session++;sequence++;$('vacancy-list').replaceChildren();$('vacancy-count').textContent='0';$('vacancy-status').textContent='';
    $('vacancy-share-result').hidden=true;$('vacancy-share-url').value='';$('vacancy-share-feedback').textContent='';
    $('vacancy-worker').replaceChildren(new Option('Selecione um diarista',''));
  });
  update();
})();
