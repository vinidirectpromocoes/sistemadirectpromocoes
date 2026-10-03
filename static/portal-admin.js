(() => {
 const $=id=>document.getElementById(id);
 function msg(text){$('portal-admin-feedback').textContent=text;}
 for(const b of document.querySelectorAll('[data-copy-portal]'))b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('portal-'+b.dataset.copyPortal+'-url').value);msg('Link copiado. Pode enviar pelo WhatsApp.');}catch{msg($('portal-'+b.dataset.copyPortal+'-url').value);}});
 $('portal-invite-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const cpf=$('portal-invite-cpf').value.replace(/\D/g,'');const {data,error}=await window.directRemote.client.rpc('direct_portal_create_invite',{p_cpf:cpf||null,p_dias:Number($('portal-invite-days').value)});if(error)throw error;for(const kind of ['cadastro','vagas'])$('portal-'+kind+'-url').value=new URL('/'+kind+'.html#convite='+data[kind+'_token'],location.origin).href;$('portal-invite-expiry').textContent='Links separados, exclusivos para uma pessoa. Válidos até '+new Date(data.expira_em).toLocaleDateString('pt-BR')+'.';$('portal-invite-links').hidden=false;msg('Envie cada link no privado. Gere outro par para o próximo diarista.');}catch(error){msg(error.message);}finally{b.disabled=false;}});
 async function load(){
  const remote=window.directRemote,allowed=['admin','operacao'].includes(remote?.role);$('portal-settings').hidden=!allowed;if(!allowed)return;
  const {data,error}=await remote.client.from('portal_cadastros').select('user_id,nome,cpf,email,criado_em').eq('status','pendente').order('criado_em');
  if(error){msg('Não foi possível carregar os acessos: '+error.message);return;}
  $('portal-pending-count').textContent=data.length?`(${data.length})`:'';const list=$('portal-pending-list');list.replaceChildren();
  if(!data.length){list.textContent='Nenhum acesso para conferir.';return;}
  for(const c of data){const row=document.createElement('div');row.className='staff-row';const text=document.createElement('p');text.textContent=`${c.nome} · CPF ${c.cpf} · ${c.email}`;row.append(text);
   for(const [label,approve] of [['Liberar acesso',true],['Recusar',false]]){const b=document.createElement('button');b.type='button';b.className='button button-outline';b.textContent=label;b.addEventListener('click',async()=>{if(!confirm(`${label} para ${c.nome} (${c.email})? Confira se o acesso pertence a essa pessoa.`))return;b.disabled=true;const result=await remote.client.rpc('direct_portal_approve',{p_user_id:c.user_id,p_aprovar:approve});if(result.error){msg(result.error.message);b.disabled=false;return;}msg('Acesso conferido.');await load();});row.append(b);}list.append(row);}
 }
 window.addEventListener('direct:authorized',load);window.addEventListener('hashchange',()=>{if(location.hash==='#configuracoes')load();});
 if(window.directRemote?.role)load();
 window.addEventListener('direct:signed-out',()=>{$('portal-settings').hidden=true;$('portal-pending-list').replaceChildren();});
})();
