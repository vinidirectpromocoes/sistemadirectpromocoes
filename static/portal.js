/* Formulários privados por convite; não criam nem usam contas de diaristas. */
(() => {
  const board = new URLSearchParams(location.hash.slice(1)).get('painel');
  const invitation = new URLSearchParams(location.hash.slice(1)).get('convite');
  const kind = document.body.dataset.page, $ = id => document.getElementById(id);
  const sb = supabase.createClient('https://jxthqgtzybcyediyciqc.supabase.co', 'sb_publishable_sulYm_YcfXUosfNvhQnDXg_I4lgxjth',
    {auth:{storageKey:'direct-formulario-privado',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let context = null, jobs = [], chosen = null, loading = false, accepting = false, verified = false, identitySequence = 0;
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
    const anyDay=$('registration-any-day'),dayInputs=[...form.querySelectorAll('input[name="dias"]')];
    anyDay.addEventListener('change',()=>{for(const input of dayInputs)input.checked=anyDay.checked;});
    for(const input of dayInputs)input.addEventListener('change',()=>{anyDay.checked=dayInputs.every(day=>day.checked);});
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
      for(const key of ['nome','telefone','data_nascimento','cep','numero','logradouro','bairro','cidade','uf','complemento','observacoes_locomocao'])data[key]=String(f.get(key)||'').trim();
      data.telefone=data.telefone.replace(/\D/g,'');data.uf=data.uf.toUpperCase();data.cpf=String(f.get('cpf')||'').replace(/\D/g,'');data.cep=data.cep.replace(/\D/g,'');data.setores=f.getAll('setores');data.transporte=f.getAll('transportes').join(', ');
      data.trabalhando=f.get('trabalhando')==='true';data.pode_se_deslocar=f.get('pode_se_deslocar')==='true';data.local_trabalho=data.trabalhando?String(f.get('local_trabalho')).trim():'';data.rede_trabalho=data.trabalhando?String(f.get('rede_trabalho')):'';data.consentimento=f.get('consentimento')==='on';
      let hours=['00:00','23:59'];if(f.get('horario_tipo')==='turno')hours=String(f.get('turno')).split('/');if(f.get('horario_tipo')==='especifico')hours=[String(f.get('inicio')),String(f.get('fim'))];
      data.disponibilidade=f.getAll('dias').map(dia=>({dia,inicio:hours[0],fim:hours[1]}));
      if(data.telefone&&!/^\d{10,13}$/.test(data.telefone))return feedback('Confira o telefone com DDD (10 a 13 números).',true);
      if(!validCpf(data.cpf))return feedback('Confira o CPF: ele precisa ser válido e ter 11 números.',true);
      if(!data.setores.length||!data.disponibilidade.length||!data.transporte)return feedback('Marque os setores, dias disponíveis e meios de locomoção.',true);
      if(!hours.every(h=>/^\d{2}:\d{2}$/.test(h))||hours[0]>=hours[1])return feedback('O horário final deve ser depois do inicial.',true);
      b.disabled=true;b.textContent='Cadastrando…';try{context=await rpc('direct_portal_submit',{p_dados:data,p_convite:invitation});completed(context);}catch(error){feedback(friendly(error),true);$('feedback').scrollIntoView({block:'start'});}finally{b.disabled=false;b.textContent='CADASTRAR';}
    });
  }
  // Resume períodos contínuos; horários diferentes continuam disponíveis nos detalhes.
  function scheduleSummary(o){
    const shifts=[...o.turnos].sort((a,b)=>a.data.localeCompare(b.data));
    const consecutive=shifts.every((t,i)=>!i||Date.parse(t.data)-Date.parse(shifts[i-1].data)===86400000);
    const period=shifts.length===1?date(shifts[0].data):consecutive?`${date(shifts[0].data)} a ${date(shifts.at(-1).data)}`:`${date(shifts[0].data)} a ${date(shifts.at(-1).data)} (dias específicos)`;
    const hours=new Set(shifts.map(t=>`${t.inicio} às ${t.fim}`));
    return {period,hours:hours.size===1?[...hours][0]:'Horários variáveis — veja os dias',variable:hours.size>1,shifts};
  }
  function live(state){
    const el=$('live-status');if(!el)return;
    el.dataset.state=state;el.lastElementChild.textContent=state==='live'?'Ao vivo':state==='offline'?'Sem conexão':state==='stale'?'Reconectando…':'Conectando…';
    el.title=state==='live'?'Vagas atualizadas automaticamente a cada 15 segundos.':state==='offline'?'Conecte-se à internet para atualizar as vagas.':'Exibindo a última consulta. A próxima atualização será automática.';
  }
  function resetIdentity(){verified=false;++identitySequence;$('confirm-accept').disabled=true;$('identity-status').hidden=true;$('confirm-error').hidden=true;}
  function reviewJob(o){
    chosen=o;resetIdentity();$('confirm-name').value='';$('confirm-cpf').value='';
    const summary=scheduleSummary(o);
    $('confirm-summary').textContent=`${o.rede} · ${o.loja}\n${o.setor}\n${summary.period} · ${o.turnos.length} dia(s)\n${summary.hours}`;
    $('confirm-dialog').showModal();
  }
  function jobCard(o){
    const summary=scheduleSummary(o),values=new Set(o.turnos.map(t=>t.valor_centavos===undefined?o.valor_centavos:t.valor_centavos)),varies=values.size>1;
    const card=node('article','','card vacancy-card');card.dataset.jobId=o.id;card.dataset.signature=JSON.stringify(o);
    const heading=node('div','','vacancy-heading');heading.append(node('h3',`${o.rede} · ${o.loja}`),node('span',`${o.turnos.length} ${o.turnos.length===1?'dia':'dias'}`,'badge'));
    card.append(heading,node('p',o.setor,'vacancy-sector'),node('p',summary.period,'vacancy-period'),node('p',summary.hours,'vacancy-hours'),node('p',o.endereco||'Confira o endereço com a Direct.','vacancy-address'));
    if(summary.variable||varies||!summary.shifts.every((t,i)=>!i||Date.parse(t.data)-Date.parse(summary.shifts[i-1].data)===86400000)){
      const detail=node('details');detail.append(node('summary','Ver dias, horários e valores'));
      for(const t of summary.shifts)detail.append(node('p',`${date(t.data)} · ${t.inicio} às ${t.fim}${varies?` · ${t.valor_centavos==null?'valor a confirmar':money(t.valor_centavos)}`:''}`,'vacancy-day'));
      card.append(detail);
    }
    const bottom=node('div','','vacancy-bottom'),price=varies?'Valor varia por dia':o.valor_centavos==null?'Valor a confirmar':`${money(o.valor_centavos)} / diária`;
    const button=node('button','Quero essa vaga','primary');button.type='button';button.addEventListener('click',()=>reviewJob(o));
    bottom.append(node('span',price,'price'),button);card.append(bottom);return card;
  }
  function renderJobs(){
    const list=$('jobs-list'),existing=new Map([...list.querySelectorAll('[data-job-id]')].map(e=>[e.dataset.jobId,e]));
    if(!jobs.length){const text='Nenhuma escala completa disponível no momento.';if(list.childElementCount!==1||list.firstElementChild.textContent!==text)list.replaceChildren(node('p',text));return;}
    for(const child of [...list.children])if(!child.dataset.jobId||!jobs.some(o=>String(o.id)===child.dataset.jobId))child.remove();
    jobs.forEach((o,index)=>{
      const old=existing.get(String(o.id)),card=old?.dataset.signature===JSON.stringify(o)?old:jobCard(o);
      if(old&&old!==card)old.replaceWith(card);
      if(list.children[index]!==card)list.insertBefore(card,list.children[index]||null);
    });
  }
  async function loadJobs(){
    if(!context||loading||!$('jobs-list'))return;loading=true;
    try{
      const current=await rpc(board?'direct_portal_board_orders':'direct_portal_orders',board?{p_token:board}:{p_convite:invitation});
      jobs=current;renderJobs();live(navigator.onLine?'live':'offline');
      if(chosen&&!accepting){const fresh=jobs.find(o=>o.id===chosen.id);
        if(!fresh){chosen=null;resetIdentity();if($('confirm-dialog').open){$('confirm-dialog').close();feedback('Esta escala não está mais disponível. As vagas foram atualizadas.');}}
        else if(JSON.stringify(fresh)!==JSON.stringify(chosen)){chosen=fresh;resetIdentity();const summary=scheduleSummary(fresh);$('confirm-summary').textContent=`${fresh.rede} · ${fresh.loja}\n${fresh.setor}\n${summary.period} · ${fresh.turnos.length} dia(s)\n${summary.hours}`;$('confirm-error').textContent='A escala foi atualizada. Confira os dados e seu cadastro novamente.';$('confirm-error').hidden=false;}
      }
    }catch(e){
      live(navigator.onLine?'stale':'offline');
      if(!jobs.length){feedback(friendly(e),true);$('jobs-list').replaceChildren(node('p','Não foi possível carregar as vagas. A conexão será conferida novamente.'));}
    }finally{loading=false;}
  }
  const identityArgs=()=>({p_token:board||invitation,p_tipo:board?'painel':'vagas',p_nome:$('confirm-name').value.trim(),p_cpf:$('confirm-cpf').value.replace(/\D/g,''),p_pedido_id:chosen?.id});
  for(const id of ['confirm-close','confirm-cancel'])$(id)?.addEventListener('click',()=>{resetIdentity();$('confirm-dialog').close();});
  $('confirm-dialog')?.addEventListener('cancel',resetIdentity);
  for(const id of ['confirm-name','confirm-cpf'])$(id)?.addEventListener('input',resetIdentity);
  $('confirm-check')?.addEventListener('click',async()=>{
    resetIdentity();const args=identityArgs(),sequence=identitySequence,b=$('confirm-check');
    const error=text=>{$('confirm-error').textContent=text;$('confirm-error').hidden=false;};
    if(!args.p_nome.includes(' ')||args.p_nome.length<5)return error('Informe seu nome completo, como está no cadastro.');
    if(!validCpf(args.p_cpf))return error('Confira seu CPF.');if(!chosen)return;
    b.disabled=true;b.textContent='Conferindo…';
    try{const result=await rpc('direct_portal_check_worker',args);if(sequence!==identitySequence||!$('confirm-dialog').open)return;
      if(result.autorizado){verified=true;$('identity-status').textContent='Autorizado a pegar esta vaga';$('identity-status').hidden=false;$('confirm-accept').disabled=false;}
      else error(result.mensagem);
    }catch(e){if(sequence===identitySequence)error(friendly(e));}
    finally{b.disabled=false;b.textContent='Conferir meu cadastro';}
  });
  $('confirm-accept')?.addEventListener('click',async()=>{
    if(!verified||!chosen||accepting)return;const b=$('confirm-accept');b.disabled=true;accepting=true;$('confirm-error').hidden=true;
    try{const result=await rpc('direct_portal_claim_order',identityArgs());if(!result.confirmado)throw Error(result.mensagem);$('confirm-dialog').close();resetIdentity();feedback(result.mensagem);await loadJobs();}
    catch(error){resetIdentity();$('confirm-error').textContent=friendly(error);$('confirm-error').hidden=false;await loadJobs();}
    finally{accepting=false;b.disabled=!verified;}
  });
  async function boot(){try{if(board&&kind==='vagas'){context=await rpc('direct_portal_board_context',{p_token:board});await loadJobs();return;}if(!invitation)throw Error('Acesso somente pelo link privado enviado pela Direct.');context=await rpc('direct_portal_context',{p_convite:invitation,p_tipo:kind});if(kind==='cadastro'){if(context.bloqueado)throw Error('Cadastro bloqueado. Fale com a Direct.');if(context.cadastrado)completed(context);else setupRegistration();}else await loadJobs();}catch(error){feedback(friendly(error),true);$('registration-form')?.setAttribute('hidden','');$('jobs-list')?.replaceChildren();}}
  window.addEventListener('hashchange',()=>location.reload());
  function refreshJobs(){if(!document.hidden&&navigator.onLine)loadJobs();}
  if($('jobs-list')){window.addEventListener('focus',refreshJobs);window.addEventListener('online',refreshJobs);window.addEventListener('offline',()=>live('offline'));document.addEventListener('visibilitychange',refreshJobs);setInterval(refreshJobs,15000);}
  boot();
})();
