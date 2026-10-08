/* Conversa operacional por regras locais. Não chama modelos, nem executa texto como código. */
(function(root,factory){const api=factory(typeof module==='object'?require('./reading-assistant.js'):root.DirectReadingAssistant,typeof module==='object'?require('./reading-parser.js'):root.DirectReadingParser);if(typeof module==='object'&&module.exports)module.exports=api;else root.DirectReadingDialogue=api;})(typeof window==='undefined'?globalThis:window,function(base,parser){
  const norm=base.norm,digits=v=>String(v||'').replace(/\D/g,''),has=(text,value)=>!!norm(value)&&(` ${norm(text)} `).includes(` ${norm(value)} `);
  const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)/100);
  const field=(text,labels)=>{for(const row of parser.prepareText(text).split('\n')){const m=/^\s*\*?([^:]+?)\*?\s*:\s*(.*?)\s*$/.exec(row);if(m&&labels.includes(norm(m[1])))return m[2].replace(/^\*|\*$/g,'').trim();}return '';};
  const snapshot=row=>JSON.stringify(row);
  const help='Posso cadastrar diaristas e pedidos; marcar presença, falta, confirmação e desistência; substituir ou escalar uma pessoa; alterar cadastro, pedido e loja; bloquear ou desbloquear cadastro; registrar ou corrigir pagamento; e remover registros sem histórico. Também consulto cadastros, escalas, lojas, pagamentos e pendências. Diga a ação e a pessoa ou pedido. Quando faltar informação, vou perguntar. Tudo funciona por regras locais, sem API paga; frases não reconhecidas precisam ser reformuladas.';
  function date(text,today,label=['data','dia','data da diaria','data de inicio']){
    const raw=field(text,label),head=text.split('\n')[0],value=raw||head;
    const relative=/\b(hoje|ontem|amanha)\b/.exec(norm(value));
    if(relative){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+({ontem:-1,hoje:0,amanha:1}[relative[1]]));return d.toISOString().slice(0,10);}
    const iso=/\b\d{4}-\d{2}-\d{2}\b/.exec(value);const br=/\b\d{1,2}\/\d{1,2}(?:\/\d{4})?\b/.exec(value);
    const supplied=iso?iso[0].split('-').reverse().join('/'):br?.[0];
    return supplied?parser.range(`${supplied} a ${supplied}`,today,'00:00','23:59')[0]?.data||'':'';
  }
  function people(text,context,secondary=false){
    const workers=context.workers||[],cpf=digits(field(text,secondary?['cpf substituto']:['cpf'])||(!secondary?/\bCPF\s*:?\s*([\d. -]{11,18})/i.exec(text)?.[1]:''));
    if(cpf)return workers.filter(w=>digits(w.cpf)===cpf);
    const name=field(text,secondary?['substituto','nova pessoa','novo diarista']:['nome','nome completo','diarista','pessoa']);
    const scope=name||text.split(/\n(?:Substituto|CPF substituto)\s*:/i)[0];
    const exact=workers.filter(w=>norm(w.nome)===norm(scope));if(exact.length)return exact;
    const full=workers.filter(w=>has(scope,w.nome));if(full.length)return full;
    return workers.filter(w=>name?has(w.nome,name):has(scope,norm(w.nome).split(' ')[0]));
  }
  function prepare(text,context){
    let result=parser.prepareText(text).trim().replace(/^(?:(?:oi|ol[aá]|bom dia|boa tarde|boa noite)[,!]?\s+)?(?:por favor[, ]*|eu (?:quero|preciso|gostaria de)\s+|quero\s+|preciso\s+|pode\s+|voc[eê] pode\s+)*/i,'');
    result=result.replace(/^(cadastre|registre|marque|confirme|altere|atualize|complete|corrija|substitua|escale)\b/i,value=>({cadastre:'Cadastrar',registre:'Registrar',marque:'Marcar',confirme:'Confirmar',altere:'Alterar',atualize:'Atualizar',complete:'Completar',corrija:'Corrigir',substitua:'Substituir',escale:'Escalar'}[value.toLowerCase()]));
    result=result.replace(/^dar\s+(?:o\s+)?ok\s+(?:no|ao)\s+pagamento/i,'Registrar pagamento').replace(/^dar baixa (?:no|do) pagamento/i,'Registrar pagamento').replace(/^marcar (?:o )?pagamento(?: como pago)?\b/i,'Registrar pagamento').replace(/^paguei\b/i,'Registrar pagamento').replace(/^trocar\b|^troque\b/i,'Substituir').replace(/^remova\b/i,'Remover').replace(/^exclua\b/i,'Excluir').replace(/^cancele\b/i,'Cancelar').replace(/^bloqueie\b/i,'Bloquear').replace(/^desbloqueie\b/i,'Desbloquear').replace(/^colocar\s+(.+?)\s+(?:no|em um|em) pedido/i,'Escalar $1 no pedido');
    const head=result.split('\n')[0];
    if(/\b(?:faltou|nao (?:compareceu|veio trabalhar|trabalhou|esteve presente))\b/.test(norm(head))&&!/^marcar falta/.test(norm(head)))result='Marcar falta\n'+result;
    else if(/\b(?:compareceu|veio trabalhar|trabalhou|esteve presente)\b/.test(norm(head)))result='Marcar presença\n'+result;
    const whole=norm(result),actionHead=norm(result.split('\n')[0]);
    if(!field(result,['pedido','pedido id'])){const id=/\bpedido\s*(?:n[uú]mero\s*|n[ºo.]\s*)?#?\s*(\d+)\b/i.exec(result);if(id)result+=`\nPedido: ${id[1]}`;}
    if(!field(result,['data','dia'])&&!/pagamento|paguei/.test(actionHead)){const d=date(text,context.today);if(d)result+=`\nData: ${d}`;}
    if(/pagamento/.test(actionHead)&&!field(result,['data pagamento','data do pagamento','pagamento'])){const d=date(head,context.today);if(d)result+=`\nData do pagamento: ${d}`;}
    if(!field(result,['motivo'])){const reason=/\b(?:motivo\s*:\s*|porque\s+|pois\s+)([^\n]+)/i.exec(text);if(reason)result+=`\nMotivo: ${reason[1].trim()}`;}
    if(/pagamento/.test(actionHead)){
      if(!field(result,['valor'])){const amount=/R\$\s*([\d.,]+)/i.exec(text);if(amount)result+=`\nValor: ${amount[1]}`;}
      if(!field(result,['forma','forma pagamento','forma de pagamento'])){const method=/\b(pix|dinheiro|transfer[eê]ncia)\b/i.exec(text);if(method)result+=`\nForma: ${method[1]}`;}
    }
    const swap=/^substituir\s+(.+?)\s+por\s+(.+?)(?=\s+(?:no pedido|hoje|amanh[aã]|ontem|porque|pois)|$)/i.exec(head);
    if(swap&&!field(result,['nome']))result+=`\nNome: ${swap[1].replace(/^(?:o|a|diarista)\s+/i,'')}\nSubstituto: ${swap[2].replace(/^(?:o|a|diarista)\s+/i,'')}`;
    const replacements=field(result,['substituto']);
    if(replacements&&!field(result,['cpf substituto'])){const matches=people(`Nome: ${replacements}`,context);if(matches.length===1)result+=`\nCPF substituto: ${matches[0].cpf}`;}
    const primary=people(result,context);
    if(!field(result,['nome','nome completo','cpf'])&&primary.length===1&&!/^(?:cadastrar|cadastre|registrar diarista)/.test(actionHead))result+=`\nNome: ${primary[0].nome}\nCPF: ${primary[0].cpf}`;
    if(!field(result,['loja','unidade','regiao'])){
      const stores=(context.stores||[]).filter(s=>has(whole,s.nome));if(stores.length===1)result+=`\nRede: ${stores[0].rede}\nLoja: ${stores[0].nome}`;
    }
    return result;
  }
  const question=(field,label,choices)=>({field,label,...(choices?.length?{choices:choices.slice(0,12)}:{})});
  function workerQuestion(matches){return question('CPF',matches.length?'Qual pessoa você quer? Escolha o cadastro ou informe o CPF.':'Qual é o nome ou CPF de uma pessoa cadastrada?',matches.map(w=>({label:`${w.nome} · CPF final ${digits(w.cpf).slice(-4)}`,value:w.cpf})));}
  function orders(text,context){
    const value=field(text,['pedido','pedido id']);
    if(value)return /^#?\d+$/.test(value)?(context.orders||[]).filter(o=>o.id===Number(value.replace('#',''))):[];
    const network=field(text,['rede','supermercado']),store=field(text,['loja','unidade','regiao']),day=date(text,context.today);
    if(!network&&!store)return [];
    return (context.orders||[]).filter(o=>(!network||norm(o.supermercado)===norm(network))&&(!store||norm(o.unidade)===norm(store))&&(!day||o.turnos.some(t=>t.data===day)));
  }
  function task(kind,text,target,changes,questions=[],notes=[]){
    return {tipo:'acao',texto:text,dados:{kind,id:target?.id,target:target||null,changes:changes||{},snapshot:target?snapshot(target):null},faltando:questions.map(q=>q.label),perguntas:questions,avisos:notes,commandOnly:true};
  }
  function requireWorker(text,context){const matches=people(text,context);return {worker:matches.length===1?matches[0]:null,questions:matches.length===1?[]:[workerQuestion(matches)]};}
  function requireOrder(text,context){const matches=orders(text,context);return {order:matches.length===1?matches[0]:null,questions:matches.length===1?[]:[question('Pedido','Qual pedido? Informe o número ou escolha abaixo.',matches.map(o=>({label:`#${o.id} · ${o.supermercado} · ${o.unidade} · ${o.turnos[0]?.data||''}`,value:String(o.id)})))]};}
  function permission(item,role){
    if(!role)return true;
    if(item.tipo==='consulta'){
      if(['financeiro','pagamentos'].includes(item.dados.consulta))return ['admin','financeiro'].includes(role);
      if(['pessoa','diaristas'].includes(item.dados.consulta))return ['admin','operacao','financeiro'].includes(role);
      if(item.dados.consulta==='pendencias')return ['admin','operacao'].includes(role);
      return ['admin','operacao','financeiro','consulta'].includes(role);
    }
    if(item.tipo==='indefinido')return true;
    if(item.tipo==='acao'&&['payment','payment-reopen'].includes(item.dados.kind))return ['admin','financeiro'].includes(role);
    if(item.tipo==='acao'&&item.dados.kind==='worker-delete')return role==='admin';
    return ['admin','operacao'].includes(role);
  }
  function blocked(item,role){if(!permission(item,role)){item.faltando=['Seu perfil não tem permissão para esta ação.'];item.perguntas=[];item.denied=true;}return item;}
  function newAction(text,context){
    const head=norm(text.split('\n')[0]),workerKinds=/^(?:bloquear|desbloquear|remover|excluir|alterar|atualizar|completar|corrigir)\b/;
    if(/\b(?:esta cadastrad[oa]|ja cadastrad[oa]|tem cadastro)\b/.test(head))return {tipo:'consulta',texto:text,dados:{consulta:'pessoa'},faltando:[],avisos:[]};
    if(/^(?:registrar|confirmar|corrigir|reabrir|estornar) pagamento\b/.test(head)){
      const reopening=/^(?:reabrir|estornar)/.test(head),{worker,questions}=requireWorker(text,context);
      const dailyDate=field(text,['data','dia','data da diaria','data de inicio']),day=dailyDate?date('Data: '+dailyDate,context.today):'',dailyId=field(text,['diaria','diaria id']);
      let candidates=worker?(context.finance||[]).filter(r=>r.origem==='diaria'&&r.diarista_id===worker.id&&(!dailyId||r.id===Number(dailyId))&&(!day||r.referencia===day||r.data===day)):[];
      if(!day&&!dailyId&&!reopening&&!/^corrigir/.test(head))candidates=candidates.filter(r=>!r.data_pagamento);
      if(!day&&!dailyId&&reopening)candidates=candidates.filter(r=>r.data_pagamento);
      const daily=candidates.length===1?candidates[0]:null;
      if(worker&&!daily)questions.push(question('Diária',candidates.length?'Qual diária? Escolha a data e o local.':'Não encontrei uma diária para esta pessoa. Informe a data ou o número da diária.',candidates.map(r=>({label:`#${r.id} · ${r.referencia||r.data} · ${r.local||r.descricao} · ${r.valor_centavos?money(r.valor_centavos):'valor não informado'}${r.data_pagamento?' · paga':''}`,value:String(r.id)}))));
      const raw=field(text,['valor']),grouped=/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw),validAmount=grouped||/^\d+(?:[.,]\d{1,2})?$/.test(raw),amount=raw?(validAmount?Math.round(Number((grouped?raw.replace(/\./g,''):raw).replace(',','.'))*100):null):daily?.valor_centavos;
      const paymentDate=field(text,['data pagamento','data do pagamento','pagamento']),paid=paymentDate?date('Data: '+paymentDate,context.today):'',method=field(text,['forma','forma pagamento','forma de pagamento'])||daily?.forma_pagamento||'',reason=field(text,['motivo']);
      if(!reopening){if(!amount||amount>10000000)questions.push(question('Valor','Qual é o valor correto? Informe Valor: 100,00.'));if(!paid||paid>context.today)questions.push(question('Data do pagamento','Em qual data o pagamento foi feito? Informe hoje ou dd/mm/aaaa, sem data futura.'));if(!method)questions.push(question('Forma','Qual foi a forma de pagamento?', ['Pix','Dinheiro','Transferência'].map(value=>({label:value,value}))));}
      if((reopening||daily?.data_pagamento)&&reason.length<8)questions.push(question('Motivo','Por que corrigir ou reabrir este pagamento? Explique com pelo menos 8 caracteres.'));
      if(reopening&&daily&&!daily.data_pagamento)questions.push(question(null,'Esta diária ainda não está paga. Não há pagamento para reabrir.'));
      if(daily?.pagamento_lote_id)questions.push(question(null,'Esta diária pertence a um fechamento. Reabra o fechamento no Financeiro antes de corrigir a diária.'));
      const item=task(reopening?'payment-reopen':'payment',text,daily,{data_pagamento:reopening?null:paid,valor:amount?String(amount/100):null,vencimento_pagamento:daily?.vencimento_pagamento||null,forma_pagamento:reopening?'':method,motivo_ajuste:reason},questions,['A baixa registra no sistema um pagamento que você informou como realizado. Confira a diária, o valor e a data.']);
      item.acknowledge=true;return item;
    }
    if(/^(?:consultar|ver|mostrar|quanto|quais|listar|tem|esta|o|a)\b/.test(head)&&/pagamento|a receber|a pagar|receber/.test(head))return {tipo:'consulta',texto:text,dados:{consulta:'pagamentos'},faltando:[],avisos:[]};
    if(/^(?:consultar|ver|mostrar|esta|tem|buscar|procurar)\b/.test(head)&&(people(text,context).length||field(text,['cpf','nome'])||/\bcpf\b/.test(head)))return {tipo:'consulta',texto:text,dados:{consulta:'pessoa'},faltando:[],avisos:[]};
    if(/^(?:cadastrar|adicionar|incluir|registrar|alterar|atualizar|corrigir) loja\b/.test(head)){
      const creating=/^(?:cadastrar|adicionar|incluir|registrar)/.test(head),network=field(text,['rede']),name=field(text,['loja','nome']),matches=(context.stores||[]).filter(s=>norm(s.nome)===norm(name)&&(!network||norm(s.rede)===norm(network))),target=matches.length===1?matches[0]:null,questions=[],changes={};
      if((!network&&!target)||(network&&!(context.stores||[]).some(s=>norm(s.rede)===norm(network))))questions.push(question('Rede','Em qual rede cadastrada fica a loja?', [...new Set((context.stores||[]).map(s=>s.rede))].map(value=>({label:value,value}))));
      if(!name)questions.push(question('Loja','Qual é o nome da loja ou centro de distribuição?'));
      if(!creating&&name&&!target)questions.push(question('Rede','Não encontrei uma única loja com esse nome. Confira a rede e o nome.'));
      for(const [key,labels] of Object.entries({endereco:['endereco'],bairro:['bairro'],cidade:['cidade'],observacao:['observacao'],responsavel:['responsavel'],telefone_contato:['telefone contato'],entrada:['entrada'],apresentacao:['apresentacao'],uniforme:['uniforme'],orientacoes:['orientacoes']})){const value=field(text,labels);if(value)changes[key]=value;}
      if(creating){if(!target&&!changes.endereco)questions.push(question('Endereço','Qual é o endereço da loja?'));if(!target&&!changes.cidade)questions.push(question('Cidade','Em qual cidade fica a loja?'));Object.assign(changes,{rede:network||target?.rede,nome:name,uf:'CE',situacao:'confirmado'});}
      if(!creating&&!Object.keys(changes).length)questions.push(question('Endereço','Qual informação deseja alterar? Informe Endereço, Bairro, Cidade ou Orientações.'));
      const item=task(creating?'store-create':'store-update',text,target,changes,questions);if(creating&&target)item.avisos.push('Essa loja já existe; o cadastro será preservado.');return item;
    }
    if(/^(?:alterar|atualizar|corrigir|cancelar|remover|excluir) pedido\b/.test(head)){
      const {order,questions}=requireOrder(text,context),removing=/^(?:remover|excluir)/.test(head),changes={};
      if(/^cancelar/.test(head))changes.situacao='cancelado';
      for(const [key,labels] of Object.entries({setor:['setor','funcao'],observacoes:['observacoes','observacao'],situacao:['situacao','status']})){const value=field(text,labels);if(value)changes[key]=value;}
      const count=field(text,['quantidade','pessoas por dia','quantidade diaristas']);if(count){if(!/^\d+$/.test(count)||Number(count)<1||Number(count)>100)questions.push(question('Quantidade','Informe entre 1 e 100 pessoas por dia.'));else changes.quantidade_diaristas=Number(count);}
      if(changes.situacao){const statuses={'em selecao':'em_selecao',confirmado:'confirmado',concluido:'concluido',cancelado:'cancelado'};changes.situacao=statuses[norm(changes.situacao)]||changes.situacao;if(!Object.values(statuses).includes(changes.situacao))questions.push(question('Situação','Qual situação deseja?',Object.keys(statuses).map(value=>({label:value,value}))));}
      const time=field(text,['horario']),range=time.match(/\b\d{1,2}:\d{2}\b/g);if(time){if(range?.length!==2||range.some(t=>Number(t.split(':')[0])>23||Number(t.split(':')[1])>59)||range[0].padStart(5,'0')>=range[1].padStart(5,'0'))questions.push(question('Horário','Informe o horário como 07:00 às 15:20.'));else if(order)changes.turnos=order.turnos.map(t=>({...t,inicio:range[0].padStart(5,'0'),fim:range[1].padStart(5,'0')}));}
      if(!removing&&!Object.keys(changes).length)questions.push(question('Setor','O que deseja alterar? Informe Setor, Horário, Quantidade, Situação ou Observações.'));
      const item=task(removing?'order-delete':'order-update',text,order,changes,questions,removing?['A exclusão só é permitida sem histórico realizado ou financeiro. Pedidos com histórico devem ser cancelados.']:['O servidor confere as escalas e o histórico antes de aceitar a alteração.']);item.acknowledge=removing||changes.situacao==='cancelado';return item;
    }
    if(/^escalar\b|^(?:remover|excluir) escala\b/.test(head)){
      const {worker,questions}=requireWorker(text,context),selected=requireOrder(text,context);questions.push(...selected.questions);const day=date(text,context.today),removing=/^(?:remover|excluir)/.test(head),all=/todos os dias|pedido inteiro/.test(norm(text));
      if(!day&&!all)questions.push(question('Data','Qual dia? Informe a data ou escreva Data: todos os dias.'));
      const dates=all?selected.order?.turnos.map(t=>t.data)||[]:day?[day]:[],matches=(context.scales||[]).filter(s=>s.pedido_id===selected.order?.id&&s.diarista_id===worker?.id&&dates.includes(s.data));
      if(removing&&matches.some(s=>s.status!=='escalada'||s.substituida_por_escala_id||(context.scales||[]).some(old=>old.substituida_por_escala_id===s.id)))questions.push(question(null,'Há histórico de presença, falta, desistência ou substituição. Corrija a situação no pedido, preservando o histórico.'));
      if(removing&&!matches.length&&worker&&selected.order&&dates.length)questions.push(question('Data','Não encontrei esta pessoa escalada na data informada.'));
      if(removing&&matches.length>1)questions.push(question('Data','Remova uma escala por vez. Informe a data específica para preservar o histórico.'));
      if(!removing&&selected.order&&dates.some(d=>!selected.order.turnos.some(t=>t.data===d)))questions.push(question('Data','A data precisa fazer parte dos dias deste pedido.'));
      const item=task(removing?'scale-delete':'scale-add',text,selected.order,{diarista_id:worker?.id,pessoa:worker?.nome,dates,scales:matches},questions);item.acknowledge=removing;item.availabilityRequired=!removing;return item;
    }
    if(workerKinds.test(head)&&/^(?:\w+) (?:o |a )?(?:cadastro|diarista|pessoa)\b/.test(head)){
      const {worker,questions}=requireWorker(text,context),kind=/^desbloquear/.test(head)?'worker-unblock':/^bloquear/.test(head)?'worker-block':/^(remover|excluir)/.test(head)?'worker-delete':'worker-update',changes={};
      if(kind==='worker-update'){
        for(const [key,labels]of Object.entries({nome:['novo nome','novo nome completo'],telefone:['telefone','whatsapp'],cep:['cep'],logradouro:['rua','logradouro'],numero:['numero'],complemento:['complemento'],bairro:['bairro'],cidade:['cidade'],local_trabalho:['local trabalho'],rede_trabalho:['rede trabalho'],transporte:['transporte'],observacoes_locomocao:['observacoes locomocao']})){const value=field(text,labels);if(value)changes[key]=['cep','telefone'].includes(key)?digits(value):value;}
        const sectors=field(text,['setores','experiencia']);if(sectors)changes.setores=sectors.split(/[,;]/).map(s=>s.trim()).filter(Boolean);
        if(changes.telefone&&!/^\d{10,13}$/.test(changes.telefone))questions.push(question('Telefone','Confira o telefone com DDD.'));
        if(changes.cep&&!/^\d{8}$/.test(changes.cep))questions.push(question('CEP','Confira o CEP com 8 dígitos.'));
        if(!Object.keys(changes).length)questions.push(question('Telefone','Qual campo deseja alterar? Informe Novo nome, Telefone, Bairro, CEP, Rua, Número, Setores ou Transporte.'));
      }
      const item=task(kind,text,worker,changes,questions,kind==='worker-delete'?['Um cadastro com escalas ou diárias não será excluído. Use Bloquear para impedir novas escalas e preservar o histórico.']:[]);item.acknowledge=kind==='worker-delete';return item;
    }
    return null;
  }
  function enrichQuestions(item,context){
    if(item.perguntas||!item.faltando.length)return item;
    const questions=[];
    for(const missing of item.faltando){
      if(/CPF.*distinguir|uma pessoa cadastrada|Nome ou CPF/.test(missing))questions.push(workerQuestion(people(item.texto,context)));
      else if(/mais de uma escala/.test(missing)){const workers=people(item.texto,context),day=date(item.texto,context.today);const matches=(context.scales||[]).filter(s=>workers.length===1&&s.diarista_id===workers[0].id&&s.data===day);questions.push(question('Pedido',missing,matches.map(s=>{const o=(context.orders||[]).find(o=>o.id===s.pedido_id);return {label:`#${s.pedido_id} · ${o?.supermercado} · ${o?.unidade}`,value:String(s.pedido_id)};})));}
      else if(/^CPF|CPF válido/.test(missing))questions.push(question('CPF','Qual é o CPF válido da pessoa?'));
      else if(/^nome$/.test(missing))questions.push(question('Nome','Qual é o nome completo?'));
      else if(/Informe Data/.test(missing))questions.push(question('Data','Qual é a data? Pode responder hoje, ontem ou dd/mm/aaaa.'));
      else if(/Motivo/.test(missing))questions.push(question('Motivo','Qual foi o motivo? Explique com pelo menos 5 caracteres.'));
      else if(/Substituto/.test(missing))questions.push(question('CPF substituto','Qual pessoa vai substituir? Informe o CPF ou escolha o cadastro.',(context.workers||[]).filter(w=>!w.bloqueada).map(w=>({label:w.nome,value:w.cpf}))));
      else if(missing==='rede')questions.push(question('Rede','Qual é a rede?', [...new Set((context.stores||[]).map(s=>s.rede))].map(value=>({label:value,value}))));
      else if(missing==='loja conhecida da rede')questions.push(question('Loja','Qual é a loja cadastrada nesta rede?',(context.stores||[]).filter(s=>!item.dados.supermercado||norm(s.rede)===norm(item.dados.supermercado)).map(s=>({label:s.nome,value:s.nome}))));
      else if(missing==='função')questions.push(question('Função','Qual é a função ou setor?'));
      else if(missing==='datas e horário'){if(!field(item.texto,['horario']))questions.push(question('Horário','Qual é o horário? Exemplo: 07:00 às 15:20.'));else questions.push(question('Data','Em qual data começa o pedido?'));}
      else if(missing==='quantidade de diaristas')questions.push(question('Quantidade de diaristas','Quantas pessoas serão necessárias por dia?'));
    }
    item.perguntas=questions;return item;
  }
  function plan(text,context){
    context={workers:[],orders:[],scales:[],stores:[],...context};
    if(/^(?:oi|ola|bom dia|boa tarde|boa noite|ajuda|me ajude|o que voce faz|o que pode fazer|como funciona|comandos|obrigado|obrigada)[.!?]*$/.test(norm(text)))return [{tipo:'consulta',texto:text,dados:{consulta:'ajuda'},faltando:[],avisos:[]}];
    const parts=text.split(/\n\s*(?:---|Depois:|Próxima ação:)\s*\n/i);if(parts.length>1){if(parts.length>10)return [{tipo:'indefinido',texto:text,dados:{},faltando:['Envie até 10 ações por revisão.'],avisos:[]}];return parts.flatMap(part=>plan(part,context));}
    const prepared=prepare(text,context);
    if(/^(?:nao|nunca|ignore|apagar todos|excluir todos|remover todos|alterar todos)\b/.test(norm(prepared)))return [{tipo:'indefinido',texto:prepared,dados:{},faltando:['Não preparei alterações. Informe uma ação e um registro específico.'],avisos:[]}];
    if(/\b(?:todos os cadastros|todos os diaristas|todas as lojas|todos os pedidos|todos os pagamentos)\b/.test(norm(prepared))&&!/^(?:consultar|listar|ver|mostrar)/.test(norm(prepared)))return [{tipo:'indefinido',texto:prepared,dados:{},faltando:['Informe um registro específico. Alterações em massa precisam de revisão no formulário.'],avisos:[]}];
    const extended=newAction(prepared,context);
    if(!extended&&/^(?:registrar|marcar|confirmar)\b/.test(norm(prepared))&&!/^(?:registrar (?:a |o )?(?:diarista|cadastro|pedido|presenca|presente|falta|desistencia)|marcar (?:a |o )?(?:presenca|presente|falta|desistencia)|confirmar (?:presenca|presente|que vai|confirmacao))\b/.test(norm(prepared)))return [{tipo:'indefinido',texto:prepared,dados:{},faltando:['Não reconheci esta ação. Use Ajuda para consultar as ações disponíveis ou abra o formulário específico.'],avisos:[],commandOnly:true}];
    if(!extended&&/^(?:remover|excluir|bloquear|desbloquear|estornar|reabrir|escalar|cancelar|corrigir)\b/.test(norm(prepared)))return [{tipo:'indefinido',texto:prepared,dados:{},faltando:['Não reconheci esta ação. Informe o tipo de registro: cadastro, pedido, loja, escala ou pagamento.'],avisos:[],commandOnly:true}];
    const items=extended?[extended]:base.plan(prepared,context);
    return items.map(item=>{if(item.tipo==='comando'){const row=context.scales.find(s=>s.id===item.dados.escala_id);if(row)item.dados.snapshot=snapshot(row);}return blocked(enrichQuestions(item,context),context.role);});
  }
  function describe(item){
    if(item.tipo!=='acao')return base.describe(item);
    const d=item.dados,t=d.target,c=d.changes,labels={payment:'Registrar ou corrigir pagamento','payment-reopen':'Reabrir pagamento da diária','worker-update':'Alterar cadastro','worker-block':'Bloquear cadastro','worker-unblock':'Desbloquear cadastro','worker-delete':'Excluir cadastro','order-update':'Alterar pedido','order-delete':'Excluir pedido','store-create':'Cadastrar loja','store-update':'Alterar loja','scale-add':'Escalar diarista','scale-delete':'Remover escala planejada'};
    const entries=[['Ação',labels[d.kind]],['Registro',t?.nome||t?.contraparte||(t?.supermercado?`Pedido #${t.id} · ${t.supermercado} · ${t.unidade}`:'')],['CPF',t?.cpf],['Diária',t?.origem==='diaria'?`#${t.id} · ${t.referencia||t.data} · ${t.local||t.descricao}`:'']];
    const names={nome:'Novo nome',telefone:'Telefone',cep:'CEP',logradouro:'Rua',numero:'Número',bairro:'Bairro',cidade:'Cidade',setores:'Setores',transporte:'Transporte',data_pagamento:'Data do pagamento',valor:'Valor',forma_pagamento:'Forma de pagamento',motivo_ajuste:'Motivo da correção',setor:'Setor',quantidade_diaristas:'Pessoas por dia',situacao:'Situação',endereco:'Endereço',rede:'Rede',orientacoes:'Orientações',pessoa:'Pessoa'};
    for(const [key,label]of Object.entries(names))if(c[key]!=null&&c[key]!=='')entries.push([label,key==='valor'?money(Math.round(Number(c[key])*100)):Array.isArray(c[key])?c[key].join(', '):c[key]]);
    if(c.turnos?.length)entries.push(['Horário',`${c.turnos[0].inicio} às ${c.turnos[0].fim} · ${c.turnos.length} dia(s)`]);
    if(c.dates?.length)entries.push(['Datas',c.dates.map(d=>d.split('-').reverse().join('/')).join(', ')]);
    for(const [key,value]of Object.entries(c))if(!names[key]&&!['diarista_id','scales','dates','turnos','uf','vencimento_pagamento'].includes(key)&&value!=null&&value!=='')entries.push([key.replace(/_/g,' '),String(value)]);
    return entries;
  }
  function merge(text,label,value){
    const labels={cpf:['cpf'],nome:['nome','nome completo'],data:['data','dia'],pedido:['pedido','pedido id'],loja:['loja','unidade','regiao'],'data do pagamento':['data pagamento','data do pagamento','pagamento'],forma:['forma','forma pagamento','forma de pagamento']}[norm(label)]||[norm(label)];
    const rows=text.split('\n'),index=rows.findIndex(r=>{const m=/^\s*([^:]+):/.exec(r);return m&&labels.includes(norm(m[1]));});
    if(index>=0)rows[index]=`${label}: ${value}`;else rows.push(`${label}: ${value}`);return rows.join('\n');
  }
  function reply(text,item){
    if(!item||item.applied)return null;
    const corrected=base.correction(text,item.texto);if(corrected)return corrected;
    const rows=parser.prepareText(text).split('\n').filter(Boolean),labels=['cpf','nome','nome completo','data','dia','pedido','rede','loja','substituto','cpf substituto','motivo','telefone','whatsapp','novo nome','novo nome completo','bairro','cep','rua','logradouro','numero','complemento','cidade','setores','transporte','valor','data pagamento','data do pagamento','pagamento','forma','forma pagamento','forma de pagamento','horario','quantidade','situacao','status','endereco','diaria','observacoes','observacao','orientacoes','disponibilidade'];
    if(rows.length&&rows.every(r=>{const m=/^([^:]+):/.exec(r);return m&&labels.includes(norm(m[1]));})){let result=item.texto;for(const r of rows){const m=/^([^:]+):\s*(.*)$/.exec(r);result=merge(result,m[1],m[2]);}return result;}
    const q=item.perguntas?.find(q=>q.field);if(!q)return null;
    if(/^(?:oi|ajuda|consultar|mostrar|ver|cadastrar|cadastre|marcar|registrar|alterar|atualizar|substituir|trocar|escalar|remover|excluir|cancelar|paguei|bloquear|desbloquear)\b/.test(norm(text)))return null;
    let value=text.trim();if(q.choices?.length){const indexed=/^\d+$/.test(value)&&Number(value)<=q.choices.length?q.choices[Number(value)-1]:null;const matched=q.choices.filter(c=>norm(c.value)===norm(value)||norm(c.label)===norm(value));if(indexed)value=indexed.value;else if(matched.length===1)value=matched[0].value;}
    if(q.field==='CPF'&& !/^\d{11}$/.test(digits(value))){return merge(item.texto,'Nome',value);}
    if(q.field==='Data'&&has(value,'todos os dias'))value='todos os dias';
    return merge(item.texto,q.field,value);
  }
  function answer(item,context){
    if(!permission(item,context.role))return {message:'Seu perfil não tem permissão para consultar estas informações.',target:null};
    if(item.dados.consulta==='ajuda')return {message:help,target:null};
    if(item.dados.consulta==='pessoa'){
      const matches=people(item.texto,context);if(matches.length!==1)return {message:matches.length?'Encontrei mais de uma pessoa. Informe o CPF para consultar o cadastro correto.':'Diarista ainda não cadastrado com os dados informados. Confira o nome e o CPF antes de cadastrar.',target:'#diaristas'};
      const w=matches[0],scales=(context.scales||[]).filter(s=>s.diarista_id===w.id&&!s.substituida_por_escala_id);return {message:`${w.nome}: diarista já cadastrado${w.bloqueada?', cadastro bloqueado':''}. Setores: ${(w.setores||[]).join(', ')||'não informados'}. ${scales.filter(s=>s.status==='escalada').length} escala(s) planejada(s), ${scales.filter(s=>s.status==='presente').length} presença(s), ${scales.filter(s=>s.status==='falta').length} falta(s).`,target:'#diaristas'};
    }
    if(item.dados.consulta==='pagamentos'){
      if(!permission(item,context.role))return {message:'Seu perfil não tem acesso aos pagamentos.',target:null};
      const matches=people(item.texto,context),identified=!!field(item.texto,['cpf','nome'])||matches.length>0;
      if(identified&&matches.length!==1)return {message:'Informe o CPF de uma pessoa cadastrada para consultar os pagamentos.',target:null};
      const rows=(context.finance||[]).filter(r=>r.origem==='diaria'&&(!matches.length||r.diarista_id===matches[0].id)),paid=rows.filter(r=>r.data_pagamento),pending=rows.filter(r=>!r.data_pagamento),sum=items=>items.reduce((v,r)=>v+(r.valor_centavos||0),0);
      return {message:`${matches[0]?.nome||'Diárias cadastradas'}: ${paid.length} diária(s) paga(s), total ${money(sum(paid))}; ${pending.length} diária(s) a pagar, total com valores informados ${money(sum(pending))}.${pending.some(r=>!r.valor_centavos)?' Há diárias sem valor definido.':''}`,target:'#financeiro'};
    }
    return null;
  }
  return {...base,plan,describe,reply,merge,permission,answer,snapshot,stamp:snapshot,prepare,help};
});
