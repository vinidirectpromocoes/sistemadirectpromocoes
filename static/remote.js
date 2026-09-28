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
  let booting;

  function message(value, error = false) {
    feedback.textContent = value;
    feedback.classList.toggle('error', error);
    feedback.hidden = false;
  }
  function showLogin() {
    authorized = false;
    shell.hidden = true;
    screen.hidden = false;
    document.querySelector('#logout-button').hidden = true;
  }
  function showApp() {
    authorized = true;
    screen.hidden = true;
    shell.hidden = false;
    document.querySelector('#logout-button').hidden = false;
    document.querySelector('#storage-status').textContent = 'Dados sincronizados';
  }
  async function authorize(reload = false) {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error || !session) { showLogin(); return false; }
    const result = await sb.from('direct_admins').select('email').eq('email', session.user.email).maybeSingle();
    if (result.error || !result.data) {
      await sb.auth.signOut();
      showLogin();
      message('Esta conta não tem permissão para acessar o sistema.', true);
      return false;
    }
    showApp();
    if (reload) {
      if (typeof load === 'function') await load();
      if (typeof loadStores === 'function') await loadStores();
      if (typeof loadFinance === 'function') await loadFinance();
      if (typeof loadOrders === 'function') await loadOrders();
      if (typeof loadSettings === 'function') await loadSettings().catch(() => {});
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
    for (let start = 0; ; start += 1000) {
      const page = unwrap(await sb.from(table).select(select).range(start, start + 999));
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
      situacao: p.situacao || 'novo', observacoes: p.observacoes || ''
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
  async function financeRows() {
    const [manual, daily] = await Promise.all([
      rows('financeiro_lancamentos'),
      rows('diarias', '*, diaristas(nome)')
    ]);
    return [
      ...manual.map(item => ({ ...item, chave: `manual:${item.id}`, origem: 'manual', referencia: item.vencimento, diarista_id: null })),
      ...daily.map(item => ({
        ...item, chave: `diaria:${item.id}`, origem: 'diaria', tipo: 'despesa',
        descricao: `Diária · ${item.setor} · ${item.local}`, categoria: 'Pagamento de diarista',
        contraparte: item.diaristas?.nome || '', vencimento: item.vencimento_pagamento,
        referencia: item.data
      }))
    ];
  }
  async function run(url, options = {}) {
    await booting;
    if (!authorized) throw new Error('Entre na sua conta para continuar.');
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
    if (entity === 'auditoria' && method === 'GET') {
      return unwrap(await sb.from('direct_auditoria').select('id,tabela,registro_id,operacao,antes,depois,email_autor,alterado_em').order('id', { ascending: false }).limit(100));
    }
    if (entity === 'leituras-pendentes') {
      if (method === 'GET') return unwrap(await sb.from('leituras_pendentes').select('*').order('id', { ascending: false }).limit(500));
      if (method === 'POST') return unwrap(await sb.from('leituras_pendentes').insert({
        tipo: p.tipo, chave: p.chave, dados: p.dados, texto: p.texto, faltando: p.faltando, avisos: p.avisos || []
      }).select().single());
      if (method === 'PATCH') return unwrap(await sb.from('leituras_pendentes').update({ status: 'resolvido', atualizado_em: new Date().toISOString() }).eq('id', id).select().single());
      if (method === 'DELETE') { unwrap(await sb.from('leituras_pendentes').delete().eq('id', id)); return { ok: true }; }
    }
    if (entity === 'pedidos') {
      if (child === 'escalas') {
        const scaleId = parts[4] ? Number(parts[4]) : null;
        if (method === 'GET') {
          const assignments = unwrap(await sb.from('pedido_escalas').select('*, diaristas(nome)').eq('pedido_id', id).order('data').order('id'));
          if (!assignments.length) return [];
          const daily = unwrap(await sb.from('diarias').select('id,pedido_escala_id,data_pagamento,valor_centavos,vencimento_pagamento,forma_pagamento').in('pedido_escala_id', assignments.map(item => item.id)));
          const byScale = new Map(daily.map(item => [item.pedido_escala_id, item]));
          return assignments.map(item => ({ ...item, diarista_nome: item.diaristas?.nome || '', diaria: byScale.get(item.id) || null }));
        }
        if (method === 'POST') return unwrap(await sb.from('pedido_escalas').insert({ pedido_id: id, diarista_id: Number(p.diarista_id), data: p.data }).select().single());
        if (method === 'PATCH') return unwrap(await sb.from('pedido_escalas').update({ status: p.status }).eq('pedido_id', id).eq('id', scaleId).select().single());
        if (method === 'DELETE') { unwrap(await sb.from('pedido_escalas').delete().eq('pedido_id', id).eq('id', scaleId)); return { ok: true }; }
      }
      if (method === 'GET') return (await rows('pedidos')).sort((a,b) => b.id - a.id).map(orderView);
      if (method === 'POST') return orderView(unwrap(await sb.from('pedidos').insert(orderPayload(p)).select().single()));
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
  window.directRemote = { request: run, client: sb };
})();
