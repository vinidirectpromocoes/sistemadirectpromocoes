/* Assistente operacional local: plano explícito, sem avaliação de código ou modelo pago. */
(function(root,factory){const api=factory(typeof module==='object'?require('./reading-parser.js'):root.DirectReadingParser);if(typeof module==='object'&&module.exports)module.exports=api;else root.DirectReadingAssistant=api;})(typeof window==='undefined'?globalThis:window,function(parser){
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const digits=v=>String(v||'').replace(/\D/g,'');
  const line=(text,labels)=>{for(const row of text.split('\n')){const m=/^\s*\*?([^:]+?)\*?\s*:\s*(.*?)\s*$/.exec(row);if(m&&labels.includes(norm(m[1])))return m[2].replace(/^\*|[\\*]+$/g,'').trim();}return '';};
  const contains=(text,value)=>!!norm(value)&&(` ${norm(text)} `).includes(` ${norm(value)} `);
  const stamp=scale=>JSON.stringify([scale.id,scale.pedido_id,scale.diarista_id,scale.data,scale.status,scale.confirmacao||'aguardando',scale.substituida_por_escala_id||null]);
  function person(text,workers,label=['nome','nome completo','diarista','diarista escalado'],cpfLabels=['cpf']){
    const cpf=digits(line(text,cpfLabels)) || (cpfLabels[0]==='cpf' ? digits(/\bCPF\s*:?\s*([\d. -]{11,18})/i.exec(text)?.[1]):'');const name=line(text,label);
    if(cpf)return workers.filter(w=>w.cpf===cpf);
    if(name){const exact=workers.filter(w=>norm(w.nome)===norm(name));return exact.length?exact:workers.filter(w=>contains(w.nome,name));}
    const full=workers.filter(w=>contains(text,w.nome));if(full.length)return full;
    return workers.filter(w=>{const names=norm(w.nome).split(' ').filter(n=>n.length>=3&&!['dos','das'].includes(n));return names.length>0&&contains(text,names[0]);});
  }
  function commandDate(text,today){
    const raw=line(text,['data','dia','data da diaria','data de inicio']);const relative=raw||text.split('\n')[0];
    if(contains(relative,'hoje'))return today;
    if(contains(relative,'ontem')){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
    const iso=/\b(\d{4}-\d{2}-\d{2})\b/.exec(raw||text);if(iso)return parser.range(`${iso[1].split('-').reverse().join('/')} a ${iso[1].split('-').reverse().join('/')}`,today,'00:00','23:59')[0]?.data||'';
    const br=/\b(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/.exec(raw||text);return br?parser.range(`${br[1]} a ${br[1]}`,today,'00:00','23:59')[0]?.data||'':'';
  }
  function enrich(text,context){
    let result=parser.prepareText(text);
    if(!line(result,['nome','nome completo','diarista','diarista escalado'])){
      const m=/(?:cadastr(?:e|ar)|registr(?:e|ar)\s+diarista)\s+(?:o\s+|a\s+)?(?:diarista\s+)?([\p{L}\p{M}][\p{L}\p{M} '\u2019-]+?)\s*(?:,?\s*CPF\s*:|\nCPF\s*:)/iu.exec(result);
      if(m)result=result.replace(m[0],`Nome: ${m[1].trim()}\nCPF:`);
    }
    // Catalog inference is exact; ambiguous stores stay in review.
    if(/\b(pedido|solicitacao)\b/.test(norm(result))&&!line(result,['loja','regiao','unidade'])){
      const networks=[...new Set((context.stores||[]).map(s=>s.rede))].filter(n=>contains(result,n));
      const stores=(context.stores||[]).filter(s=>contains(result,s.nome)&&(!networks.length||networks.includes(s.rede)));
      if(stores.length===1)result+=`\nRede: ${stores[0].rede}\nLoja: ${stores[0].nome}`;
    }
    return result;
  }
  function plan(text,context){
    text=enrich(text,context);const value=norm(text);const workers=context.workers||[];
    const head=norm(text.split('\n')[0]);
    const indirect=workers.some(w=>contains(head,w.nome)||contains(head,norm(w.nome).split(' ')[0]));
    const action=/^(?:marcar |marque |registrar |registre |confirmar |confirme |lancar |lance |o |a )*(?:presenca|presente)\b/.test(value)?'presente':
      /^(?:marcar |marque |registrar |registre |lancar |lance |o |a )*(?:falta|faltou)\b/.test(value)?'falta':
      /^(?:registrar |registre |marcar |marque |o |a )*(?:desistencia|desistiu)\b/.test(value)?'desistiu':
      /^(?:confirmar |confirme |confirmou que vai|confirmacao)\b/.test(value)?'confirmou':
      /^(?:substituir|substitua|substituicao)\b/.test(value)?'substituir':indirect&&/\bconfirmou que vai\b/.test(head)?'confirmou':indirect&&/\bfaltou\b/.test(head)?'falta':indirect&&/\bdesistiu\b/.test(head)?'desistiu':indirect&&/\bpresente\b/.test(head)?'presente':null;
    if(action){
      const people=person(text,workers),date=commandDate(text,context.today),missing=[];
      if(people.length!==1)missing.push(people.length?'Informe o CPF para distinguir as pessoas.':'Informe Nome ou CPF de uma pessoa cadastrada.');
      if(!date)missing.push('Informe Data: dd/mm/aaaa ou hoje.');
      const orderField=line(text,['pedido','pedido id']),orderId=Number(orderField.replace(/^#/,'')||0);if(orderField&&(!Number.isSafeInteger(orderId)||orderId<1))missing.push('Informe um número de pedido válido.');
      const network=line(text,['rede','supermercado']),unit=line(text,['loja','regiao','unidade']),sector=line(text,['setor','funcao']);
      const time=line(text,['horario']).match(/\d{1,2}:\d{2}/)?.[0];
      const candidates=(context.scales||[]).filter(s=>{
        const order=(context.orders||[]).find(o=>o.id===s.pedido_id);
        const shift=order?.turnos.find(t=>t.data===s.data);
        return people.length===1&&s.diarista_id===people[0].id&&s.data===date&&order&&(!orderId||order.id===orderId)&&(!network||norm(network)===norm(order.supermercado))&&(!unit||norm(unit.replace(/^loja\s+/i,''))===norm(order.unidade))&&(!sector||norm(sector)===norm(order.setor))&&(!time||shift?.inicio===time.padStart(5,'0'))&&!s.substituida_por_escala_id;
      });
      if(people.length===1&&date&&candidates.length!==1)missing.push(candidates.length?'Há mais de uma escala. Informe Pedido: número, Loja ou Horário.':'Nenhuma escala encontrada para essa pessoa nessa data. Confira o pedido e a data.');
      const target=candidates.length===1?candidates[0]:null,order=target&&(context.orders||[]).find(o=>o.id===target.pedido_id);
      const reason=line(text,['motivo']);if(['falta','desistiu','substituir'].includes(action)&&reason.length<5)missing.push('Informe Motivo: com pelo menos 5 caracteres.');
      if(['presente','falta'].includes(action)&&date>context.today)missing.push('Presença e falta só podem ser registradas no dia da diária ou depois.');
      if(target?.status==='desistiu'&&action!=='substituir')missing.push('Esta pessoa desistiu. Use Substituir no pedido.');
      let replacement=null;if(action==='substituir'){
        const choices=person(text,workers,['substituto','nova pessoa','novo diarista'],['cpf substituto']);
        if(choices.length!==1)missing.push('Informe Substituto: nome completo ou CPF substituto: de uma pessoa cadastrada.');else replacement=choices[0];
        if(replacement?.id===target?.diarista_id)missing.push('O substituto deve ser outra pessoa.');
      }
      return [{tipo:'comando',texto:text,dados:{acao:action,pessoa:people[0]?.nome||'',data:date,rede:order?.supermercado||network,loja:order?.unidade||unit,setor:order?.setor||sector,pedido_id:target?.pedido_id,escala_id:target?.id,motivo:reason,substituto:replacement?.nome||'',substituto_id:replacement?.id,snapshot:target?stamp(target):null},faltando:missing,avisos:action==='presente'?['A presença gera a diária e atualiza o financeiro. Confirmar que vai é uma ação diferente.']:action==='substituir'?['Confira com o substituto a disponibilidade para esta data e horário antes de confirmar.']:[],chave:target?`acao:${target.id}:${action}`:parser.textKey(text)}];
    }

    if(/^(?:atualizar|atualize|completar|complete|alterar|altere)\b/.test(value)){
      const matches=person(text,workers),missing=[],changes={};
      if(matches.length!==1)missing.push('Informe Nome ou CPF de uma única pessoa cadastrada.');
      const mapping={bairro:['bairro'],cep:['cep'],logradouro:['rua','logradouro'],numero:['numero','n'],complemento:['complemento']};
      for(const [key,labels]of Object.entries(mapping)){const v=line(text,labels);if(v)changes[key]=key==='cep'?digits(v):v;}
      const newName=line(text,['novo nome','novo nome completo']);if(newName)changes.nome=newName;
      if(!Object.keys(changes).length)missing.push('Informe os campos para completar: Bairro, CEP, Rua, Número, Complemento ou Novo nome. Para os demais campos, abra o cadastro.');
      if(changes.cep&&!/^\d{8}$/.test(changes.cep))missing.push('Confira o CEP: são 8 dígitos.');
      return [{tipo:'atualizacao',texto:text,dados:{pessoa:matches[0]?.nome||'',diarista_id:matches[0]?.id,changes,snapshot:matches.length===1?JSON.stringify(matches[0]):null},faltando:missing,avisos:['Somente os campos mostrados serão alterados. Os demais dados serão preservados.']}];
    }
    if(/^(?:ver |mostrar |mostre |consultar |consulte |listar |liste |quais |qual |quanto |como estao )/.test(value)){
      const kind=/financeir|faturamento|lucro|pagamento/.test(value)?'financeiro':/pendencia/.test(value)?'pendencias':/loja|endereco|rede/.test(value)?'lojas':/pedido|escala/.test(value)?'pedidos':/diarista|cadastro/.test(value)?'diaristas':null;
      return [{tipo:kind?'consulta':'indefinido',texto:text,dados:{consulta:kind},faltando:kind?[]:['Posso consultar pedidos, diaristas, lojas, pendências e o financeiro.'],avisos:[]}];
    }
    const items=parser.parse(text,context);
    if(items.length===2&&items[0].tipo==='diarista'&&items[1].tipo==='pedido'&&!items[1].dados.diarista_escalado){
      const worker=items[0],order=items[1];order.dados.diarista_escalado={nome:worker.dados.nome,cpf:worker.dados.cpf};
      order.faltando.push(...worker.faltando);order.texto=text;order.avisos.push('A pessoa informada antes do pedido será escalada em todos os dias. Confira essa associação.');return [order];
    }
    return items;
  }
  function describe(item){
    const d=item.dados;
    if(item.tipo==='diarista')return [['Ação','Cadastrar diarista (ou preservar cadastro existente)'],['Nome',d.nome],['CPF',d.cpf],['Setores',(d.setores||[]).join(', ')],['Bairro',d.bairro],['Endereço',[d.logradouro,d.numero].filter(Boolean).join(', ')]];
    if(item.tipo==='pedido')return [['Ação',d.diarista_escalado?'Salvar pedido e escalar a pessoa em todos os dias':'Salvar pedido'],['Rede',d.supermercado],['Loja',d.unidade],['Setor',d.setor],['Período',d.turnos?.length?`${d.turnos[0].data.split('-').reverse().join('/')} a ${d.turnos.at(-1).data.split('-').reverse().join('/')} · ${d.turnos.length} dia(s)`:''],['Horário',d.turnos?.length?`${d.turnos[0].inicio} às ${d.turnos[0].fim}`:''],['Pessoas por dia',d.quantidade_diaristas],['Diarista',d.diarista_escalado?.nome],['CPF',d.diarista_escalado?.cpf]];
    if(item.tipo==='atualizacao')return [['Ação','Completar cadastro'],['Pessoa',d.pessoa],...Object.entries(d.changes).map(([k,v])=>[{nome:'Novo nome',bairro:'Bairro',cep:'CEP',logradouro:'Rua',numero:'Número',complemento:'Complemento'}[k],v])];
    if(item.tipo==='comando')return [['Ação',{presente:'Marcar presença',falta:'Marcar falta',confirmou:'Confirmar que vai',desistiu:'Registrar desistência',substituir:'Substituir diarista'}[d.acao]],['Pessoa',d.pessoa],['Data',d.data?.split('-').reverse().join('/')],['Pedido',d.pedido_id?`#${d.pedido_id} · ${d.rede} · ${d.loja}`:''],['Setor',d.setor],['Motivo',d.motivo],['Substituto',d.substituto]];
    return [];
  }
  function correction(text,original){
    const m=/^corrigir\s+(nome|cpf|rede|loja|regi[aã]o|setor|fun[cç][aã]o|hor[aá]rio|data(?: de in[ií]cio)?|quantidade de dias)\s+(?:para\s+|:\s*)(.+)$/i.exec(text.trim());
    if(!m)return null;const key=norm(m[1]),groups=[['nome','nome completo','diarista','diarista escalado'],['setor','funcao'],['loja','unidade','regiao'],['data','datas','data de inicio','periodo'],['horario','turno']];const equivalent=groups.find(g=>g.includes(key))||[key];
    const aliases={setor:'Função',regiao:'Loja',data:'Data de início'},label=aliases[key]||m[1],lines=original.split('\n');
    const index=lines.findIndex(row=>{const k=/^\s*\*?([^:]+?)\*?\s*:/.exec(row);return k&&equivalent.includes(norm(k[1]));});
    if(index>=0)lines[index]=`${label}: ${m[2]}`;
    else if(key==='nome'){
      const cpfIndex=lines.findIndex(row=>/^\s*\*?CPF\*?\s*:/i.test(row));let before=cpfIndex-1;while(before>=0&&!lines[before].trim())before--;
      if(before>=0&&/^[*\p{L}\p{M} '\u2019-]+$/u.test(lines[before]))lines[before]=`${label}: ${m[2]}`;else lines.push(`${label}: ${m[2]}`);
    }else lines.push(`${label}: ${m[2]}`);
    return lines.join('\n');
  }
  function completion(text,original){
    const prepared=parser.prepareText(text),rows=prepared.split('\n').filter(r=>r.trim());
    const allowed=['nome','nome completo','diarista','cpf','rede','loja','regiao','funcao','setor','horario','data','data de inicio','quantidade de dias','motivo','pedido','cpf substituto','substituto'];
    if(!rows.length||!rows.every(r=>{const m=/^\s*\*?([^:]+?)\*?\s*:/.exec(r);return m&&allowed.includes(norm(m[1]));}))return null;
    let merged=original;for(const r of rows){const m=/^\s*\*?([^:]+?)\*?\s*:\s*(.*?)\s*$/.exec(r);const corrected=correction(`Corrigir ${m[1]} para ${m[2]}`,merged);if(corrected)merged=corrected;else{const lines=merged.split('\n');const index=lines.findIndex(v=>{const k=/^\s*\*?([^:]+?)\*?\s*:/.exec(v);return k&&norm(k[1])===norm(m[1]);});if(index>=0)lines[index]=r;else lines.push(r);merged=lines.join('\n');}}
    return merged;
  }
  return {plan,describe,correction,completion,stamp,norm};
});
