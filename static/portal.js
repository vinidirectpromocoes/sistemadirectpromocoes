/* Portal usa sessão separada da equipe. Nenhum acesso às tabelas internas. */
(() => {
  const $ = id => document.getElementById(id);
  const sb = supabase.createClient('https://jxthqgtzybcyediyciqc.supabase.co',
    'sb_publishable_sulYm_YcfXUosfNvhQnDXg_I4lgxjth',
    {auth:{storageKey:'direct-diarista-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let account = null, jobs = [], chosen = null, session = null, loading = false;
  const date = value => value.split('-').reverse().join('/');
  const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
  const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const node = (tag, text, cls='') => {const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
  function feedback(text,error=false){$('feedback').textContent=text;$('feedback').classList.toggle('error',error);$('feedback').hidden=false;}
  async function rpc(name,args={}){const result=await sb.rpc(name,args);if(result.error)throw new Error(result.error.message);return result.data;}
  function friendly(error){if(/Invalid login credentials/.test(error.message))return 'E-mail ou senha incorretos.';if(/Email not confirmed/.test(error.message))return 'Confirme seu e-mail antes de entrar.';if(/rate limit|too many/i.test(error.message))return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';if(/fetch|network/i.test(error.message))return 'Não foi possível conectar. Confira sua internet e tente novamente.';return error.message;}
  function access(){ $('access-error').hidden=true;$('access-dialog').showModal();$('access-email').focus();}
  $('login-button').addEventListener('click',access);
  $('access-close').addEventListener('click',()=>$('access-dialog').close());
  $('access-dialog').addEventListener('click',e=>{if(e.target===$('access-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  $('logout-button').addEventListener('click',async()=>{await sb.auth.signOut();session=null;account=null;await refreshAccount();feedback('Você saiu do seu acesso.');});
  function registrationData(form){const f=new FormData(form);return {nome:String(f.get('nome')||'').trim(),cpf:String(f.get('cpf')||'').replace(/\D/g,''),setores:String(f.get('setores')||'').split(',').map(s=>s.trim()).filter(Boolean),bairro:String(f.get('bairro')||'').trim(),logradouro:String(f.get('logradouro')||'').trim(),numero:String(f.get('numero')||'').trim(),cep:String(f.get('cep')||'').replace(/\D/g,''),complemento:String(f.get('complemento')||'').trim(),transporte:String(f.get('transporte')||'').trim()};}
  function validCpf(cpf){if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;for(let n=9;n<11;n++){let sum=0;for(let i=0;i<n;i++)sum+=Number(cpf[i])*(n+1-i);const digit=(sum*10)%11;if(Number(cpf[n])!==(digit===10?0:digit))return false;}return true;}
  async function refreshAccount(){
    const {data,error}=await sb.auth.getSession();if(error)throw error;session=data.session;
    account=session?await rpc('direct_portal_me'):null;
    // Dados editáveis da conta servem apenas como formulário, nunca como permissão.
    if(account?.status==='sem_cadastro'&&session.user.user_metadata?.direct_cadastro){
      await rpc('direct_portal_register',{p_dados:session.user.user_metadata.direct_cadastro});
      account=await rpc('direct_portal_me');
    }
    $('logout-button').hidden=!session;$('login-button').hidden=Boolean(session);
    const texts={ativo:'Seu cadastro está ativo. Você pode confirmar os dias disponíveis.',pendente:'A Direct vai conferir seu acesso porque este CPF já tinha cadastro. Aguarde a liberação.',recusado:'Seu acesso não foi liberado. Fale com a Direct.',bloqueado:'Seu cadastro está bloqueado. Fale com a Direct.',sem_cadastro:'Complete seu cadastro para assumir uma diária.'};
    if($('account-status'))$('account-status').textContent=account?`${account.nome||''} · ${texts[account.status]||''}`:'Você pode ver as vagas. Entre no seu cadastro para assumir uma diária.';
    if($('registration-form'))for(const name of ['email','senha','confirmar']){const input=$('registration-form').elements[name];input.disabled=Boolean(session);input.closest('label').hidden=Boolean(session);}
    if($('registered')){
      $('registered').replaceChildren();$('registered').hidden=!account||account.status==='sem_cadastro';
      $('registration-form').hidden=Boolean(account&&account.status!=='sem_cadastro');
      if(!$('registered').hidden){$('registered').append(node('p',texts[account.status]));const link=node('a','Ver vagas disponíveis →');link.href='/vagas.html';$('registered').append(link);}
    }
    if($('my-shifts')){
      $('my-shifts').replaceChildren();const scales=account?.escalas||[];$('my-shifts-section').hidden=!scales.length;
      const labels={escalada:'Confirmou que vai',presente:'Presença registrada',falta:'Falta registrada',desistiu:'Desistência registrada'};
      for(const s of scales){const card=node('article','','card');card.append(node('h3',`${s.rede} · ${s.loja}`),node('p',s.setor),node('p',`${date(s.data)} · ${s.inicio} às ${s.fim}`),node('span',labels[s.status]||s.status,'badge'));$('my-shifts').append(card);}
    }
  }
  $('access-form').addEventListener('submit',async e=>{
    e.preventDefault();const b=e.submitter;b.disabled=true;$('access-error').hidden=true;
    try{const result=await sb.auth.signInWithPassword({email:$('access-email').value.trim(),password:$('access-password').value});if(result.error)throw result.error;await refreshAccount();$('access-password').value='';$('access-dialog').close();if($('jobs-list'))await loadJobs();}
    catch(error){$('access-error').textContent=friendly(error);$('access-error').hidden=false;}finally{b.disabled=false;}
  });
  $('registration-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,data=registrationData(form),f=new FormData(form),b=e.submitter;
    if(!validCpf(data.cpf))return feedback('Confira o CPF: ele precisa ser válido e ter 11 números.',true);
    if(!session&&f.get('senha')!==f.get('confirmar'))return feedback('As senhas precisam ser iguais.',true);
    if(data.setores.some(s=>s.length>80))return feedback('Cada setor deve ter até 80 caracteres.',true);
    b.disabled=true;
    try{
      if(!session){
        const result=await sb.auth.signUp({email:String(f.get('email')).trim(),password:String(f.get('senha')),options:{data:{direct_cadastro:data},emailRedirectTo:new URL('/cadastro.html',location.origin).href}});
        if(result.error)throw result.error;
        form.elements.senha.value='';form.elements.confirmar.value='';
        if(!result.data.session){feedback('Enviamos a confirmação para seu e-mail. Confirme e volte a este link para entrar com sua senha e concluir o cadastro. Se já tiver acesso, use “Já tenho acesso”.');return;}
      }
      await rpc('direct_portal_register',{p_dados:data});await refreshAccount();feedback(account.status==='ativo'?'Cadastro salvo! Você já pode escolher suas diárias.':'Pedido de acesso enviado para conferência da Direct.');
    }catch(error){feedback(friendly(error),true);}finally{b.disabled=false;}
  });
  function renderJobs(){
    if(!$('jobs-list'))return;const list=$('jobs-list');list.replaceChildren();const query=normalized($('search').value.trim());
    const visible=jobs.filter(o=>normalized(`${o.rede} ${o.loja} ${o.setor} ${o.endereco||''}`).includes(query));
    if(!visible.length){list.append(node('p',jobs.length&&query?'Nenhuma vaga corresponde à busca.':'Nenhuma diária disponível no momento. Volte mais tarde.'));return;}
    for(const o of visible){
      const values=new Set(o.turnos.map(t=>t.valor_centavos===undefined?o.valor_centavos:t.valor_centavos));const varies=values.size>1;
      const card=node('article','','card');card.append(node('h3',`${o.rede} · ${o.loja}`),node('p',o.setor),node('p',o.endereco||'Confira o endereço com a Direct.'),node('p',varies?'Confira o valor de cada dia abaixo.':o.valor_centavos==null?'Valor da diária: confirmar com a Direct.':`${money(o.valor_centavos)} por diária`,'price'));
      const choices=node('div','');
      for(const t of o.turnos){const label=node('label','','shift-choice'),input=document.createElement('input');input.type='checkbox';input.value=t.data;input.checked=true;input.setAttribute('aria-label',`Selecionar ${date(t.data)} no pedido ${o.id}`);label.append(input,node('span',`${date(t.data)} · ${t.inicio} às ${t.fim}\n${t.vagas} vaga(s)${varies?` · ${t.valor_centavos==null?'valor a confirmar':money(t.valor_centavos)}`:''}`));choices.append(label);}
      const button=node('button','Quero estes dias','primary');button.type='button';
      button.addEventListener('click',()=>{
        if(!session){feedback('Entre no seu cadastro para confirmar uma diária.');access();return;}
        if(account?.status!=='ativo'){feedback('Seu cadastro precisa estar ativo para entrar na escala. Complete o cadastro ou fale com a Direct.',true);return;}
        const dates=[...choices.querySelectorAll('input:checked')].map(i=>i.value);if(!dates.length){feedback('Selecione pelo menos um dia.',true);return;}
        chosen={id:o.id,dates};$('confirm-summary').textContent=`${o.rede} · ${o.loja} · ${o.setor}\n${dates.map(d=>{const t=o.turnos.find(t=>t.data===d);return `${date(d)} (${t.inicio}–${t.fim})`;}).join(', ')}`;$('confirm-error').hidden=true;$('confirm-dialog').showModal();
      });card.append(choices,button);list.append(card);
    }
  }
  async function loadJobs(){if(loading||!$('jobs-list'))return;loading=true;try{jobs=await rpc('direct_portal_orders');renderJobs();}catch(error){feedback(friendly(error),true);$('jobs-list').replaceChildren(node('p','Não foi possível carregar as vagas. Use Atualizar para tentar novamente.'));}finally{loading=false;}}
  $('search')?.addEventListener('input',renderJobs);
  $('refresh-button')?.addEventListener('click',async e=>{e.target.disabled=true;try{await refreshAccount();await loadJobs();}catch(error){feedback(friendly(error),true);}finally{e.target.disabled=false;}});
  for(const id of ['confirm-close','confirm-cancel'])$(id)?.addEventListener('click',()=>$('confirm-dialog').close());
  $('confirm-accept')?.addEventListener('click',async e=>{const b=e.target;b.disabled=true;try{const result=await rpc('direct_portal_accept',{p_pedido_id:chosen.id,p_datas:chosen.dates});$('confirm-dialog').close();feedback(`${result.mensagem} ${result.dias} dia(s) adicionado(s).`);await refreshAccount();await loadJobs();}catch(error){$('confirm-error').textContent=friendly(error);$('confirm-error').hidden=false;await loadJobs();}finally{b.disabled=false;}});
  async function boot(){try{await refreshAccount();}catch(error){feedback(friendly(error),true);}await loadJobs();}
  boot();
  if($('jobs-list'))setInterval(()=>{if(!document.hidden)loadJobs();},45000);
})();
