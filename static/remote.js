/* Adaptador do site publicado. O servidor local continua usando sua API SQLite. */
(() => {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return;
  const sb = supabase.createClient(
    'https://jxthqgtzybcyediyciqc.supabase.co',
    'sb_publishable_sulYm_YcfXUosfNvhQnDXg_I4lgxjth',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );
  const screen = document.querySelector('#login-screen');
  const shell = document.querySelector('.app-shell');
  const feedback = document.querySelector('#login-feedback');
  const emailInput = document.querySelector('#login-email');
  const passwordInput = document.querySelector('#login-password');
  let authorized = false;
  let currentRole = null;
  let booting;

  function message(value, error = false) {
    feedback.textContent = value;
    feedback.classList.toggle('error', error);
    feedback.hidden = false;
  }
  function showLogin() {
    authorized = false;
    currentRole = null;
    shell.hidden = true;
    screen.hidden = false;
    document.querySelector('#logout-button').hidden = true;
  }
  function showApp(role) {
    authorized = true;
    currentRole = role;
    window.DirectHub?.prepare();
    setTimeout(()=>window.dispatchEvent(new Event('direct:authorized')),0);
    document.body.dataset.role = role;
    screen.hidden = true;
    shell.hidden = false;
    document.querySelector('#logout-button').hidden = false;
    document.querySelector('#storage-status').textContent = 'Dados sincronizados';
    for (const [name, allowed] of Object.entries({
      financeiro: ['admin', 'financeiro'], configuracoes: ['admin', 'financeiro'],
      leitura: ['admin', 'operacao'], diaristas: ['admin', 'operacao', 'financeiro'],
    })) document.querySelector(`#nav-${name}`).hidden = !allowed.includes(role);
    document.querySelector('#new-button').hidden = !['admin', 'operacao'].includes(role);
    document.querySelector('#new-order-button').hidden = !['admin', 'operacao'].includes(role);
    document.querySelector('#new-store-button').hidden = !['admin', 'operacao'].includes(role);
    document.querySelector('#backup-settings').hidden = role !== 'admin';
    document.querySelector('#staff-settings').hidden = role !== 'admin';
    for (const [id, roles] of Object.entries({
      'delete-button': ['admin'], 'add-daily-button': ['admin', 'financeiro'],
      'edit-button': ['admin', 'operacao'], 'block-button': ['admin', 'operacao'],
      'order-edit-button': ['admin', 'operacao'], 'order-delete-button': ['admin', 'operacao'],
    })) document.getElementById(id).hidden = !roles.includes(role);
    if (['financeiro', 'configuracoes', 'leitura'].includes(location.hash.slice(1)) &&
        document.querySelector(`#nav-${location.hash.slice(1)}`)?.hidden) location.hash = '#inicio';
  }
  async function authorize(reload = false) {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) { showLogin(); message(`Não foi possível conferir sua sessão: ${error.message}`, true); return false; }
    if (!session) { showLogin(); return false; }
    const result = await sb.from('direct_admins').select('email').eq('email', session.user.email).maybeSingle();
    if (result.error && !navigator.onLine) {
      let grant; try {grant=JSON.parse(sessionStorage.getItem('direct-offline-grant'));}catch{}
      if(grant?.email===session.user.email&&grant.expires*1000>Date.now()){showApp(grant.role);return true;}
    }
    if (result.error) { showLogin(); message(`Não foi possível conferir seu acesso: ${result.error.message}`, true); return false; }
    const staff = result.data ? null : await sb.from('direct_staff').select('role,active').eq('email', session.user.email).maybeSingle();
    if (staff?.error) { showLogin(); message(`Não foi possível conferir seu acesso: ${staff.error.message}`, true); return false; }
    const role = result.data ? 'admin' : staff?.data?.active ? staff.data.role : null;
    if (!role) {
      await sb.auth.signOut();
      showLogin();
      message('Esta conta não tem permissão para acessar o sistema.', true);
      return false;
    }
    sessionStorage.setItem('direct-offline-grant',JSON.stringify({email:session.user.email,role,expires:session.expires_at}));
    showApp(role);
    if (reload) {
      if (typeof load === 'function') await load();
      if (typeof loadStores === 'function') await loadStores();
      if (['admin', 'financeiro'].includes(role) && typeof loadFinance === 'function') await loadFinance();
      if (typeof loadOrders === 'function') await loadOrders();
      if (['admin', 'financeiro'].includes(role) && typeof loadSettings === 'function') await loadSettings().catch(() => {});
      if (typeof loadHome === 'function') await loadHome().catch(() => {});
    }
    return true;
  }
  showLogin();
  booting = authorize();
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLogin();
  });

  document.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.querySelector('#login-submit');
    button.disabled = true;
    feedback.hidden = true;
    const email = emailInput.value.trim().toLowerCase();
    try {
      const result = await sb.auth.signInWithPassword({ email, password: passwordInput.value });
      if (result.error) throw result.error;
      await authorize(true);
    } catch (error) {
      message(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message, true);
    } finally { button.disabled = false; }
  });
  document.querySelector('#logout-button').addEventListener('click', async () => {
    await window.DirectOffline?.clear();
    sessionStorage.removeItem('direct-offline-grant');
    await sb.auth.signOut();
    showLogin();
    passwordInput.value = '';
  });

  function unwrap(result) {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  async function rows(table, select = '*') {
    const all = [];
    const sortKey = table === 'direct_staff' ? 'email' : table === 'custos_extras' ? 'rede' : 'id';
    for (let start = 0; ; start += 1000) {
      const page = unwrap(await sb.from(table).select(select).order(sortKey).range(start, start + 999));
      all.push(...page);
      if (page.length < 1000) return all;
    }
  }
  const money = value => value == null || value === '' ? null : Math.round(Number(value) * 100);
  function diaristaPayload(p) {
    return {
      nome: p.nome, cpf: String(p.cpf).replace(/\D/g, ''), setores: p.setores,
      cep: String(p.cep).replace(/\D/g, ''), logradouro: p.logradouro, numero: p.numero,
      complemento: p.complemento || '', bairro: p.bairro, cidade: 'Fortaleza', uf: 'CE',
      trabalhando: p.trabalhando, local_trabalho: p.local_trabalho || '',
      disponibilidade: p.disponibilidade, pode_se_deslocar: p.pode_se_deslocar,
      transporte: p.transporte || '', observacoes_locomocao: p.observacoes_locomocao || ''
    };
  }
  function dailyPayload(p) {
    return {
      data: p.data, local: p.local, setor: p.setor, observacoes: p.observacoes || '',
      data_pagamento: p.data_pagamento || null, valor_centavos: money(p.valor),
      vencimento_pagamento: p.vencimento_pagamento || null, forma_pagamento: p.forma_pagamento || ''
    };
  }
  function financePayload(p) {
    return {
      tipo: p.tipo, descricao: p.descricao, categoria: p.categoria, contraparte: p.contraparte,
      valor_centavos: money(p.valor), vencimento: p.vencimento,
      data_pagamento: p.data_pagamento || null, forma_pagamento: p.forma_pagamento || '',
      observacoes: p.observacoes || '', motivo_ajuste: p.motivo_ajuste || ''
    };
  }
  function orderPayload(p) {
    return {
      supermercado: p.supermercado, unidade: p.unidade || '', contato: p.contato || '',
      setor: p.setor, quantidade_diaristas: p.quantidade_diaristas, turnos: p.turnos,
      situacao: p.situacao || 'novo', observacoes: p.observacoes || '', ...(p.chave_operacao ? {chave_operacao:p.chave_operacao}: {})
    };
  }
  function storePayload(p) {
    return {
      rede: p.rede, nome: p.nome, endereco: p.endereco, bairro: p.bairro || '',
      cidade: p.cidade, uf: 'CE', fonte_url: p.fonte_url || '',
      situacao: p.situacao || 'revisar', observacao: p.observacao || ''
    };
  }
  const orderView = o => ({ ...o, quantidade_dias: o.turnos.length, total_diarias: o.turnos.length * o.quantidade_diaristas });
  async function invoiceRows() {
    const [invoices, items, receipts] = await Promise.all([
      rows('cobrancas'),
      rows('cobranca_itens', '*, pedidos(supermercado,unidade,setor), diarias(diarista_id,diaristas(nome))'),
      rows('cobranca_recebimentos'),
    ]);
    return invoices.sort((a, b) => b.id - a.id).map(invoice => {
      const invoiceItems = items.filter(item => item.cobranca_id === invoice.id).map(item => ({
        ...item, supermercado: item.pedidos?.supermercado || invoice.rede,
        unidade: item.pedidos?.unidade || '', setor: item.pedidos?.setor || '',
        diarista_id: item.diarias?.diarista_id,
        diarista_nome: item.diarias?.diaristas?.nome || '',
      }));
      const invoiceReceipts = receipts.filter(item => item.cobranca_id === invoice.id)
        .sort((a, b) => a.data_recebimento.localeCompare(b.data_recebimento) || a.id - b.id);
      return { ...invoice, itens: invoiceItems, recebimentos: invoiceReceipts,
        valor_recebido_centavos: invoiceReceipts.reduce((sum, item) => sum + (item.estornado ? 0 : item.valor_centavos), 0) };
    });
  }
  async function financeRows() {
    const [manual, daily, invoices] = await Promise.all([
      rows('financeiro_lancamentos'),
      rows('diarias', '*, diaristas(nome)'), invoiceRows(),
    ]);
    return [
      ...manual.map(item => ({ ...item, chave: `manual:${item.id}`, origem: 'manual', referencia: item.vencimento, diarista_id: null })),
      ...daily.map(item => ({
        ...item, chave: `diaria:${item.id}`, origem: 'diaria', tipo: 'despesa',
        descricao: `Diária · ${item.setor} · ${item.local}`, categoria: 'Pagamento de diarista',
        contraparte: item.diaristas?.nome || '', vencimento: item.vencimento_pagamento,
        referencia: item.data
      })),
      ...invoices.filter(item => item.status !== 'cancelada').map(item => ({
        ...item, chave: `cobranca:${item.id}`, origem: 'cobranca', tipo: 'receita',
        descricao: `Cobrança · ${item.rede}`, categoria: 'Serviços faturados',
        contraparte: item.rede, referencia: item.periodo_fim, data_pagamento: null,
        forma_pagamento: '', observacoes: item.numero_nota || '', diarista_id: null,
      })),
    ];
  }
  async function run(url, options = {}) {
    await booting;
    if (!authorized) throw new Error('Entre na sua conta para continuar.');
    if (!navigator.onLine) throw new Error('Sem conexão. Consulte a agenda salva e revise os rascunhos quando voltar.');
    const method = (options.method || 'GET').toUpperCase();
    const p = options.body ? JSON.parse(options.body) : {};
    const parts = url.split('/').filter(Boolean);
    const entity = parts[1];
    const id = parts[2] ? Number(parts[2]) : null;
    const child = parts[3];
    if (parts[0] !== 'api') throw new Error('Rota inválida.');

    if (entity === 'diaristas') {
      if (child === 'diarias') {
        const dailyId = parts[4] ? Number(parts[4]) : null;
        if (method === 'GET') return (await rows('diarias')).filter(item => item.diarista_id === id).sort((a,b) => b.data.localeCompare(a.data) || b.id - a.id);
        if (method === 'POST') return unwrap(await sb.from('diarias').insert({ ...dailyPayload(p), diarista_id: id }).select().single());
        if (method === 'PATCH' && parts[5] === 'pagamento') {
          return unwrap(await sb.from('diarias').update({
            data_pagamento: p.data_pagamento || null, valor_centavos: money(p.valor),
            vencimento_pagamento: p.vencimento_pagamento || null, forma_pagamento: p.forma_pagamento || '',
            motivo_ajuste: p.motivo_ajuste || ''
          }).eq('id', dailyId).eq('diarista_id', id).select().single());
        }
        if (method === 'DELETE') {
          const current = unwrap(await sb.from('diarias').select('data_pagamento').eq('id', dailyId).eq('diarista_id', id).single());
          if (current.data_pagamento) throw new Error('Esta diária já foi paga. Corrija o pagamento em vez de excluí-la.');
          unwrap(await sb.from('diarias').delete().eq('id', dailyId).eq('diarista_id', id));
          return { ok: true };
        }
      }
      if (child === 'bloqueio' && method === 'PATCH') return unwrap(await sb.from('diaristas').update({ bloqueada: p.bloqueada, atualizado_em: new Date().toISOString() }).eq('id', id).select().single());
      if (method === 'GET') return (await rows('diaristas')).sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      if (method === 'POST') return unwrap(await sb.from('diaristas').insert(diaristaPayload(p)).select().single());
      if (method === 'PUT') return unwrap(await sb.from('diaristas').update({ ...diaristaPayload(p), atualizado_em: new Date().toISOString() }).eq('id', id).select().single());
      if (method === 'DELETE') {
        const history = await sb.from('diarias').select('id', { count: 'exact', head: true }).eq('diarista_id', id);
        if (history.error) throw new Error(history.error.message);
        if (history.count) throw new Error('Este cadastro tem diárias registradas. Bloqueie a diarista para preservar o histórico.');
        unwrap(await sb.from('diaristas').delete().eq('id', id)); return { ok: true };
      }
    }
    if (entity === 'financeiro') {
      if (method === 'GET') return financeRows();
      if (method === 'POST') return unwrap(await sb.from('financeiro_lancamentos').insert(financePayload(p)).select().single());
      if (method === 'PUT') return unwrap(await sb.from('financeiro_lancamentos').update({ ...financePayload(p), atualizado_em: new Date().toISOString() }).eq('id', id).select().single());
      if (method === 'DELETE') {
        const current = unwrap(await sb.from('financeiro_lancamentos').select('data_pagamento').eq('id', id).single());
        if (current.data_pagamento) throw new Error('Este lançamento já foi liquidado. Registre uma correção com motivo.');
        unwrap(await sb.from('financeiro_lancamentos').delete().eq('id', id)); return { ok: true };
      }
    }
    if (entity === 'cobrancas') {
      if (method === 'GET') return invoiceRows();
      if (method === 'POST' && !id) return unwrap(await sb.rpc('direct_create_invoice', {
        p_rede: p.rede, p_inicio: p.periodo_inicio, p_fim: p.periodo_fim,
        p_vencimento: p.vencimento, p_numero_nota: p.numero_nota || '',
      }));
      if (method === 'POST' && parts[3] === 'recebimentos') return unwrap(await sb.rpc('direct_receive_invoice', {
        p_id: id, p_valor_centavos: money(p.valor), p_data: p.data_recebimento, p_forma: p.forma || '',
      }));
      if (method === 'PATCH' && parts[3] === 'cancelar') return unwrap(await sb.rpc('direct_cancel_invoice', {
        p_id: id, p_motivo: p.motivo,
      }));
    }
    if (entity === 'recebimentos' && method === 'PATCH' && parts[3] === 'estornar') {
      return unwrap(await sb.rpc('direct_void_invoice_receipt', { p_id: id, p_motivo: p.motivo }));
    }
    if (entity === 'pagamento-lotes') {
      if (method === 'GET') return rows('pagamento_lotes', '*, diaristas(nome)');
      if (method === 'POST' && !id) return unwrap(await sb.rpc('direct_pay_daily_batch', {
        p_diarista_id: p.diarista_id, p_diaria_ids: p.diaria_ids,
        p_data: p.data_pagamento, p_forma: p.forma || '',
      }));
      if (method === 'PATCH' && parts[3] === 'reabrir') return unwrap(await sb.rpc('direct_reopen_payment_batch', {
        p_id: id, p_motivo: p.motivo,
      }));
    }
    if (entity === 'auditoria' && method === 'GET') {
      return unwrap(await sb.from('direct_auditoria').select('id,tabela,registro_id,operacao,antes,depois,email_autor,alterado_em').order('id', { ascending: false }).limit(100));
    }
    if (entity === 'equipe') {
      if (method === 'GET') return rows('direct_staff');
      if (method === 'POST') return unwrap(await sb.from('direct_staff').upsert({
        email: String(p.email || '').trim().toLowerCase(), role: p.role, active: Boolean(p.active),
      }, { onConflict: 'email' }).select().single());
    }
    if (entity === 'leituras-pendentes') {
      if (method === 'GET') return (await rows('leituras_pendentes')).sort((a,b)=>b.id-a.id);
      if (method === 'POST') return unwrap(await sb.from('leituras_pendentes').upsert({
        tipo: p.tipo, chave: p.chave, dados: p.dados, texto: p.texto, faltando: p.faltando,
        avisos: p.avisos || [], status: 'pendente', atualizado_em: new Date().toISOString()
      }, { onConflict: 'chave' }).select().single());
      if (method === 'PATCH') return unwrap(await sb.from('leituras_pendentes').update({ status: 'resolvido', atualizado_em: new Date().toISOString() }).eq('id', id).select().single());
      if (method === 'DELETE') { unwrap(await sb.from('leituras_pendentes').delete().eq('id', id)); return { ok: true }; }
    }
    if (entity === 'contratos') {
      if (!['admin','financeiro'].includes(currentRole)) throw new Error('Sem permissão para contratos.');
      if (method === 'GET') return rows('contratos');
      if (method === 'POST') return unwrap(await sb.rpc('direct_create_contract', { p: { ...p,
        valor_recebido_centavos: money(p.valor_recebido), valor_pago_centavos: money(p.valor_pago) } }));
    }
    if (entity === 'ocorrencias') {
      if (method === 'GET') return rows('ocorrencias');
      if (!['admin','operacao'].includes(currentRole)) throw new Error('Sem permissão para ocorrências.');
      if (method === 'POST') return unwrap(await sb.from('ocorrencias').insert({ pedido_id:p.pedido_id, escala_id:p.escala_id||null,tipo:p.tipo,descricao:p.descricao }).select().single());
      if (method === 'PATCH') return unwrap(await sb.from('ocorrencias').update({ estado:'resolvida',resolucao:p.resolucao }).eq('id',id).select().single());
    }
    if (entity === 'operacao' && method === 'PATCH') {
      const kind=parts[2], target=Number(parts[3]);
      if (kind==='cobrancas') {
        if (!['admin','financeiro'].includes(currentRole)) throw new Error('Sem permissão para conferir cobrança.');
        unwrap(await sb.rpc('direct_review_invoice',{p_id:target,p})); return {ok:true};
      }
      if (!['admin','operacao'].includes(currentRole)) throw new Error('Sem permissão para operação.');
      if (kind==='diaristas') return unwrap(await sb.from('diaristas').update({telefone:p.telefone,reserva:p.reserva,disponibilidade_confirmada_em:new Date().toISOString(),atualizado_em:new Date().toISOString()}).eq('id',target).select().single());
      if (kind==='escalas') {
        const values=p.acao==='confirmacao'?{confirmacao:p.confirmacao}:
          p.acao==='validacao'?{chegada_em:p.chegada_em||null,saida_em:p.saida_em||null,loja_validacao:p.loja_validacao,loja_responsavel:p.loja_responsavel,loja_observacao:p.loja_observacao||''}:null;
        if (!values) throw new Error('Ação inválida.');
        return unwrap(await sb.from('pedido_escalas').update({...values,atualizado_em:new Date().toISOString()}).eq('id',target).select().single());
      }
    }
    if (entity === 'custos-extras') {
      if (!['admin', 'financeiro'].includes(currentRole)) throw new Error('Sem permissão para consultar custos.');
      if (method === 'GET') return rows('custos_extras');
      if (method === 'PUT') {
        const amount = name => {
          const value = String(p[name] ?? '').replace(',', '.');
          if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error(`Confira o custo de ${name}.`);
          const cents = Math.round(Number(value) * 100);
          if (cents > 10000000) throw new Error('Custo acima do limite permitido.');
          return cents;
        };
        return unwrap(await sb.from('custos_extras').upsert({ rede: p.rede,
          transporte_centavos: amount('transporte'), taxas_centavos: amount('taxas'),
          outros_centavos: amount('outros'), atualizado_em: new Date().toISOString() }, { onConflict: 'rede' }).select().single());
      }
    }
    if (entity === 'escalas' && method === 'GET') {
      const assignments = await rows('pedido_escalas', '*, diaristas(nome)');
      const daily = ['admin', 'financeiro'].includes(currentRole)
        ? await rows('diarias', 'id,pedido_escala_id,data_pagamento,valor_centavos,valor_recebido_centavos,vencimento_pagamento,forma_pagamento,pagamento_lote_id') : [];
      const byScale = new Map(daily.map(item => [item.pedido_escala_id, item]));
      return assignments.map(item => ({ ...item, diarista_nome: item.diaristas?.nome || '', diaria: byScale.get(item.id) || null }));
    }
    if (entity === 'pedidos') {
      if (child === 'escalas') {
        const scaleId = parts[4] ? Number(parts[4]) : null;
        if (method === 'GET') {
          const assignments = unwrap(await sb.from('pedido_escalas').select('*, diaristas(nome)').eq('pedido_id', id).order('data').order('id'));
          if (!assignments.length) return [];
          const daily = ['admin', 'financeiro'].includes(currentRole)
            ? unwrap(await sb.from('diarias').select('id,pedido_escala_id,data_pagamento,valor_centavos,valor_recebido_centavos,vencimento_pagamento,forma_pagamento,pagamento_lote_id').in('pedido_escala_id', assignments.map(item => item.id))) : [];
          const byScale = new Map(daily.map(item => [item.pedido_escala_id, item]));
          return assignments.map(item => ({ ...item, diarista_nome: item.diaristas?.nome || '', diaria: byScale.get(item.id) || null }));
        }
        if (method === 'POST') {
          if (Array.isArray(p.datas)) {
            if (!p.datas.length || p.datas.length > 90 || new Set(p.datas).size !== p.datas.length) throw new Error('Confira as datas escolhidas para a escala.');
            return unwrap(await sb.from('pedido_escalas').insert(p.datas.map(data => ({ pedido_id: id, diarista_id: Number(p.diarista_id), data }))).select());
          }
          return unwrap(await sb.from('pedido_escalas').insert({ pedido_id: id, diarista_id: Number(p.diarista_id), data: p.data }).select().single());
        }
        if (method === 'PATCH') return unwrap(await sb.from('pedido_escalas').update({ status: p.status,
          ...(p.status === 'falta' ? { falta_motivo: p.motivo } : {}) }).eq('pedido_id', id).eq('id', scaleId).select().single());
        if (method === 'DELETE') { unwrap(await sb.from('pedido_escalas').delete().eq('pedido_id', id).eq('id', scaleId)); return { ok: true }; }
      }
      if (method === 'GET') return (await rows('pedidos')).sort((a,b) => b.id - a.id).map(orderView);
      if (method === 'POST') {
        const response=await sb.from('pedidos').insert(orderPayload(p)).select().single();
        if (response.error?.code==='23505' && p.chave_operacao) {
          const existing=unwrap(await sb.from('pedidos').select('*').eq('chave_operacao',p.chave_operacao).single());const sent=orderPayload(p);
          const shifts=v=>JSON.stringify(v.map(t=>[t.data,t.inicio,t.fim]));
          if(Object.keys(sent).some(k=>k!=='chave_operacao'&&(k==='turnos'?shifts(existing[k])!==shifts(sent[k]):existing[k]!==sent[k])))throw Error('Esse rascunho já foi enviado com outros dados. Confira o pedido existente antes de repetir.');
          return orderView(existing);
        }
        return orderView(unwrap(response));
      }
      if (method === 'PUT') return orderView(unwrap(await sb.from('pedidos').update({ ...orderPayload(p), atualizado_em: new Date().toISOString() }).eq('id', id).select().single()));
      if (method === 'DELETE') { unwrap(await sb.from('pedidos').delete().eq('id', id)); return { ok: true }; }
    }
    if (entity === 'lojas') {
      if (method === 'GET') return (await rows('lojas')).sort((a,b) => a.rede.localeCompare(b.rede, 'pt-BR') || a.cidade.localeCompare(b.cidade, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
      if (method === 'POST') return unwrap(await sb.from('lojas').insert(storePayload(p)).select().single());
      if (method === 'PUT') return unwrap(await sb.from('lojas').update({ ...storePayload(p), atualizado_em: new Date().toISOString() }).eq('id', id).select().single());
    }
    if (entity === 'tarifas') {
      if (!parts[2] && method === 'GET') {
        const [redes, setores] = await Promise.all([rows('tarifas_redes'), rows('tarifas_setores')]);
        return {
          redes: redes.sort((a, b) => a.rede.localeCompare(b.rede, 'pt-BR')),
          setores: setores.sort((a, b) => (a.rede || '').localeCompare(b.rede || '', 'pt-BR') || a.setor.localeCompare(b.setor, 'pt-BR'))
        };
      }
      const table = parts[2] === 'redes' ? 'tarifas_redes' : parts[2] === 'setores' ? 'tarifas_setores' : null;
      const rateId = parts[3] ? Number(parts[3]) : null;
      if (table === 'tarifas_redes' && method === 'PUT' && rateId) {
        return unwrap(await sb.from(table).update({ valor_recebido_centavos: money(p.valor_recebido), valor_padrao_centavos: money(p.valor_padrao), atualizado_em: new Date().toISOString() }).eq('id', rateId).select().single());
      }
      if (table === 'tarifas_setores') {
        if (method === 'POST' && !rateId) return unwrap(await sb.from(table).insert({ rede: p.rede, setor: p.setor, valor_pago_centavos: money(p.valor_pago) }).select().single());
        if (method === 'PUT' && rateId) return unwrap(await sb.from(table).update({ rede: p.rede, setor: p.setor, valor_pago_centavos: money(p.valor_pago), atualizado_em: new Date().toISOString() }).eq('id', rateId).select().single());
        if (method === 'DELETE' && rateId) { unwrap(await sb.from(table).delete().eq('id', rateId)); return { ok: true }; }
      }
    }
    throw new Error('Operação não disponível.');
  }
  window.directRemote = { request: run, client: sb, get role() { return currentRole; } };
})();
