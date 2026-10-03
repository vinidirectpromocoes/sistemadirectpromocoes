(() => {
 const $=id=>document.getElementById(id);
 function msg(text){$('portal-admin-feedback').textContent=text;}
 for(const b of document.querySelectorAll('[data-copy-portal]'))b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('portal-'+b.dataset.copyPortal+'-url').value);msg('Link copiado. Pode enviar pelo WhatsApp.');}catch{msg($('portal-'+b.dataset.copyPortal+'-url').value);}});
 $('portal-invite-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const cpf=$('portal-invite-cpf').value.replace(/\D/g,'');const {data,error}=await window.directRemote.client.rpc('direct_portal_create_invite',{p_cpf:cpf||null,p_dias:Number($('portal-invite-days').value)});if(error)throw error;for(const kind of ['cadastro','vagas'])$('portal-'+kind+'-url').value=new URL('/'+kind+'.html#convite='+data[kind+'_token'],location.origin).href;$('portal-invite-expiry').textContent='Links separados, exclusivos para uma pessoa. Válidos até '+new Date(data.expira_em).toLocaleDateString('pt-BR')+'.';$('portal-invite-links').hidden=false;msg('Envie cada link no privado. Gere outro par para o próximo diarista.');}catch(error){msg(error.message);}finally{b.disabled=false;}});
 $('portal-contact-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{let phone=$('portal-whatsapp').value.replace(/\D/g,'');if(phone.length===10||phone.length===11)phone='55'+phone;const {error}=await window.directRemote.client.rpc('direct_portal_settings',{p_whatsapp:phone,p_grupo_url:$('portal-group').value.trim()});if(error)throw error;msg('Contatos salvos. Eles aparecerão após o cadastro.');}catch(error){msg(error.message);}finally{b.disabled=false;}});
 async function load(){
  const remote=window.directRemote,allowed=['admin','operacao'].includes(remote?.role);$('portal-settings').hidden=!allowed;if(!allowed)return;
  const {data,error}=await remote.client.rpc('direct_portal_settings');if(error){msg(error.message);return;}
  $('portal-whatsapp').value=data.whatsapp;$('portal-group').value=data.grupo_url;
  $('portal-contact-form').hidden=remote.role!=='admin';

 }
 window.addEventListener('direct:authorized',load);window.addEventListener('hashchange',()=>{if(location.hash==='#configuracoes')load();});
 if(window.directRemote?.role)load();
 window.addEventListener('direct:signed-out',()=>{$('portal-settings').hidden=true;$('portal-contact-form').reset();});
})();
