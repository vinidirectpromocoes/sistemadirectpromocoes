/* Formulários privados por convite; não criam nem usam contas de diaristas. */
(() => {
  const invitation = new URLSearchParams(location.hash.slice(1)).get('convite');
  const kind = document.body.dataset.page, $ = id => document.getElementById(id);
  const sb = supabase.createClient('https://jxthqgtzybcyediyciqc.supabase.co', 'sb_publishable_sulYm_YcfXUosfNvhQnDXg_I4lgxjth',
    {auth:{storageKey:'direct-formulario-privado',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let context = null, jobs = [], chosen = null, loading = false, accepting = false;
  const date = value => value.split('-').reverse().join('/');
  const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
  const node = (tag,text,cls='') => {const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
  function feedback(text,error=false){$('feedback').textContent=text;$('feedback').classList.toggle('error',error);$('feedback').hidden=false;}
  const friendly = e => /fetch|network/i.test(e.message)?'Não foi possível conectar. Confira sua internet e tente novamente.':e.message;
  async function rpc(name,args){const r=await sb.rpc(name,args);if(r.error)throw new Error(r.error.message);return r.data;}
  function validCpf(cpf){if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;for(let n=9;n<11;n++){let sum=0;for(let i=0;i<n;i++)sum+=Number(cpf[i])*(n+1-i);const digit=(sum*10)%11;if(Number(cpf[n])!==(digit===10?0:digit))return false;}return true;}
  function choices(id,name,values){const box=$(id);for(const [value,text] of values){const label=node('label','','check'),input=document.createElement('input');input.type='checkbox';input.name=name;input.value=value;label.append(input,node('span',text));box.append(label);}}
  function completed(data){
    $('registration-form').hidden=true;$('registration-heading').hidden=true;
    const box=$('registered');box.hidden=false;box.replaceChildren(node('div','✓','success-icon'),node('h1','Cadastro concluído!'),node('p','Obrigado! Seus dados estão na base da Direct Promoções. A equipe poderá complementar ou atualizar seu cadastro.'));
    const links=node('div','','success-links');
    for(const [label,value,hint] of [['Falar com a Direct no WhatsApp',data.whatsapp?'https://wa.me/'+data.whatsapp:null,'Contato será informado pela Direct.'],['Entrar no grupo de diárias',data.grupo_url||null,'Link do grupo será informado pela Direct.'],['Ver diárias disponíveis',data.vagas_token?'/vagas.html#convite='+data.vagas_token:null,'Peça seu link privado de vagas à Direct.']]){
      const a=node('a',label,value&&label==='Ver diárias disponíveis'?'primary':'');
      if(value){a.href=value;if(value.startsWith('https://')){a.target='_blank';a.rel='noopener noreferrer';}}else{a.setAttribute('aria-disabled','true');a.append(node('small',hint));}links.append(a);
    }
    box.append(links);$('feedback').hidden=true;box.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function setupRegistration(){
    const form=$('registration-form');choices('sector-options','setores',context.setores.map(s=>[s,s]));
    choices('day-options','dias',[['segunda','Segunda'],['terca','Terça'],['quarta','Quarta'],['quinta','Quinta'],['sexta','Sexta'],['sabado','Sábado'],['domingo','Domingo']]);
    choices('transport-options','transportes',['Ônibus','Bike','Moto','Carro','Metrô','Uber'].map(s=>[s,s]));
    for(const name of context.redes){const opt=node('option',name);opt.value=name;form.elements.rede_trabalho.append(opt);}
    form.elements.data_nascimento.max=new Date().toLocaleDateString('en-CA');
    form.elements.horario_tipo.addEventListener('change',()=>{const mode=form.elements.horario_tipo.value;$('shift-options').hidden=mode!=='turno';$('specific-hours').hidden=mode!=='especifico';});
    form.elements.trabalhando.addEventListener('change',()=>{const yes=form.elements.trabalhando.value==='true';$('work-options').hidden=!yes;form.elements.local_trabalho.required=yes;form.elements.rede_trabalho.required=yes;});
    form.elements.pode_se_deslocar.addEventListener('change',()=>{const limited=form.elements.pode_se_deslocar.value==='false';$('region-options').hidden=!limited;form.elements.observacoes_locomocao.required=limited;});
    let timer,controller,lastCep='',lookupSequence=0;const cepCache=new Map();
    async function lookup(){
      const cep=form.elements.cep.value.replace(/\D/g,''),sequence=++lookupSequence;controller?.abort();
      if(cep.length!==8)return;if(lastCep===cep&&form.elements.cidade.value)return;lastCep=cep;
      $('cep-status').textContent='Buscando endereço…';form.elements.cidade.readOnly=true;form.elements.uf.readOnly=true;
      controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
      try{
        let data=cepCache.get(cep);if(!data){const r=await fetch('https://viacep.com.br/ws/'+cep+'/json/',{signal:controller.signal,referrerPolicy:'no-referrer'});if(!r.ok)throw Error('Consulta indisponível');data=await r.json();if(data.erro||!data.localidade||!data.uf)throw Error('CEP não encontrado');cepCache.set(cep,data);}
        if(sequence!==lookupSequence||cep!==form.elements.cep.value.replace(/\D/g,''))return;
        for(const [name,value] of Object.entries({logradouro:data.logradouro||'',bairro:data.bairro||'',cidade:data.localidade,uf:data.uf}))form.elements[name].value=value;
        $('cep-status').textContent='Endereço encontrado. Confira a rua, bairro e o número da casa.';
      }catch(e){if(sequence!==lookupSequence)return;lastCep='';form.elements.cidade.readOnly=false;form.elements.uf.readOnly=false;$('cep-status').textContent='Não foi possível consultar este CEP. Confira os números e preencha o endereço para continuar.';}
      finally{clearTimeout(timeout);}
    }
    form.elements.cep.addEventListener('input',()=>{clearTimeout(timer);++lookupSequence;controller?.abort();for(const name of ['cidade','uf','logradouro','bairro'])form.elements[name].value='';$('cep-status').textContent='Digite os 8 números do CEP.';timer=setTimeout(lookup,400);});
    form.elements.cep.addEventListener('blur',()=>{clearTimeout(timer);lookup();});
    form.hidden=false;
    form.addEventListener('submit',async e=>{
      e.preventDefault();const f=new FormData(form),b=e.submitter,data={};
      for(const key of ['nome','data_nascimento','cep','numero','logradouro','bairro','cidade','uf','complemento','observacoes_locomocao'])data[key]=String(f.get(key)||'').trim();
      data.uf=data.uf.toUpperCase();data.cpf=String(f.get('cpf')||'').replace(/\D/g,'');data.cep=data.cep.replace(/\D/g,'');data.setores=f.getAll('setores');data.transporte=f.getAll('transportes').join(', ');
      data.trabalhando=f.get('trabalhando')==='true';data.pode_se_deslocar=f.get('pode_se_deslocar')==='true';data.local_trabalho=data.trabalhando?String(f.get('local_trabalho')).trim():'';data.rede_trabalho=data.trabalhando?String(f.get('rede_trabalho')):'';data.consentimento=f.get('consentimento')==='on';
      let hours=['00:00','23:59'];if(f.get('horario_tipo')==='turno')hours=String(f.get('turno')).split('/');if(f.get('horario_tipo')==='especifico')hours=[String(f.get('inicio')),String(f.get('fim'))];
      data.disponibilidade=f.getAll('dias').map(dia=>({dia,inicio:hours[0],fim:hours[1]}));
      if(!validCpf(data.cpf))return feedback('Confira o CPF: ele precisa ser válido e ter 11 números.',true);
      if(!data.setores.length||!data.disponibilidade.length||!data.transporte)return feedback('Marque os setores, dias disponíveis e meios de locomoção.',true);
      if(!hours.every(h=>/^\d{2}:\d{2}$/.test(h))||hours[0]>=hours[1])return feedback('O horário final deve ser depois do inicial.',true);
      b.disabled=true;b.textContent='Cadastrando…';try{context=await rpc('direct_portal_submit',{p_dados:data,p_convite:invitation});completed(context);}catch(error){feedback(friendly(error),true);$('feedback').scrollIntoView({block:'start'});}finally{b.disabled=false;b.textContent='CADASTRAR';}
    });
  }
  function reviewJob(o){
    if(!context?.cadastrado||context.bloqueado)return feedback('Para pegar uma vaga, você precisa estar cadastrado e liberado. Peça à Direct seu link privado de cadastro.',true);
    chosen=o;$('confirm-cpf').value='';$('confirm-summary').textContent=`${o.rede} · ${o.loja} · ${o.setor}\n${o.turnos.length} dia(s) — escala completa\n${o.turnos.map(t=>`${date(t.data)} (${t.inicio}–${t.fim})`).join('\n')}`;$('confirm-error').hidden=true;$('confirm-dialog').showModal();
  }
  function renderJobs(){const list=$('jobs-list');list.replaceChildren();if(!jobs.length){list.append(node('p','Nenhuma escala completa disponível no momento.'));return;}
    for(const o of jobs){const values=new Set(o.turnos.map(t=>t.valor_centavos===undefined?o.valor_centavos:t.valor_centavos)),varies=values.size>1;
      const card=node('article','','card');card.append(node('h3',`${o.rede} · ${o.loja}`),node('p',o.setor),node('p',o.endereco||'Confira o endereço com a Direct.'),node('p',varies?'Confira o valor de cada dia abaixo.':o.valor_centavos==null?'Valor da diária: confirmar com a Direct.':`${money(o.valor_centavos)} por diária`,'price'),node('p',`${o.turnos.length} dia(s) · compromisso com a escala inteira`));
      for(const t of o.turnos)card.append(node('p',`${date(t.data)} · ${t.inicio} às ${t.fim}${varies?` · ${t.valor_centavos==null?'valor a confirmar':money(t.valor_centavos)}`:''}`,'shift-choice'));
      const button=node('button','Quero pegar essa vaga','primary');button.type='button';button.addEventListener('click',()=>reviewJob(o));card.append(button);list.append(card);
    }
  }
  async function loadJobs(){if(!context||loading||!$('jobs-list'))return;loading=true;try{jobs=await rpc('direct_portal_orders',{p_convite:invitation});renderJobs();if(chosen&&!jobs.some(o=>o.id===chosen.id)&&!accepting){chosen=null;if($('confirm-dialog').open){$('confirm-dialog').close();feedback('Esta escala não está mais disponível. As vagas foram atualizadas.');}}}catch(e){jobs=[];chosen=null;$('confirm-dialog')?.close();feedback(friendly(e),true);$('jobs-list').replaceChildren(node('p','Não foi possível carregar as vagas. Reabra este link para tentar novamente.'));}finally{loading=false;}}
  for(const id of ['confirm-close','confirm-cancel'])$(id)?.addEventListener('click',()=>$('confirm-dialog').close());
  $('confirm-accept')?.addEventListener('click',async e=>{const b=e.target,cpf=$('confirm-cpf').value.replace(/\D/g,'');$('confirm-error').hidden=true;if(!validCpf(cpf)){$('confirm-error').textContent='Confira seu CPF.';$('confirm-error').hidden=false;return;}if(!chosen)return feedback('Esta escala não está mais disponível. Escolha uma vaga atual.',true);b.disabled=true;accepting=true;
    try{const result=await rpc('direct_portal_take_order',{p_pedido_id:chosen.id,p_convite:invitation,p_cpf:cpf});$('confirm-dialog').close();feedback(result.mensagem);await loadJobs();}catch(error){$('confirm-error').textContent=friendly(error);$('confirm-error').hidden=false;await loadJobs();}finally{b.disabled=false;accepting=false;}
  });
  async function boot(){try{if(!invitation)throw Error('Acesso somente pelo link privado enviado pela Direct.');context=await rpc('direct_portal_context',{p_convite:invitation,p_tipo:kind});if(kind==='cadastro'){if(context.bloqueado)throw Error('Cadastro bloqueado. Fale com a Direct.');if(context.cadastrado)completed(context);else setupRegistration();}else await loadJobs();}catch(error){feedback(friendly(error),true);$('registration-form')?.setAttribute('hidden','');$('jobs-list')?.replaceChildren();}}
  window.addEventListener('hashchange',()=>location.reload());
  function refreshJobs(){if(!document.hidden&&navigator.onLine)loadJobs();}
  if($('jobs-list')){window.addEventListener('focus',refreshJobs);window.addEventListener('online',refreshJobs);document.addEventListener('visibilitychange',refreshJobs);setInterval(refreshJobs,15000);}
  boot();
})();
