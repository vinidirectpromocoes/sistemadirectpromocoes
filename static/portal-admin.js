(() => {
  const $ = id => document.getElementById(id);
  let offset = 0, total = 0, generation = 0, listRequest = 0, inviteRequest = 0;
  const allowed = () => ['admin', 'operacao'].includes(window.directRemote?.role);
  const active = () => location.hash === '#convites';
  const msg = text => { $('portal-admin-feedback').textContent = text; };
  function clearInvite() {
    inviteRequest++;
    $('portal-invite-cpf').value = '';
    $('portal-invite-links').hidden = true;
    $('portal-invite-expiry').textContent = '';
    for (const kind of ['cadastro', 'vagas']) $('portal-' + kind + '-url').value = '';
    msg('');
  }
  async function rpc(name, args) {
    if (!allowed()) throw Error('Entre com um perfil de administrador ou operação.');
    const { data, error } = await window.directRemote.client.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  }
  for (const b of document.querySelectorAll('[data-copy-portal]')) {
    b.addEventListener('click', async () => {
      const url = $('portal-' + b.dataset.copyPortal + '-url');
      if (!allowed() || !url.value) return;
      const version = inviteRequest;
      try { await navigator.clipboard.writeText(url.value); if (version === inviteRequest) msg('Link copiado. Pode enviar pelo WhatsApp.'); }
      catch { if (version === inviteRequest) { url.focus(); url.select(); msg('Selecione e copie o link acima.'); } }
    });
  }
  $('portal-invite-form').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter, version = generation, inviteVersion = ++inviteRequest; b.disabled = true;
    // O novo convite substitui os links exibidos, evitando enviar o convite anterior por engano.
    $('portal-invite-links').hidden = true;
    for (const kind of ['cadastro', 'vagas']) $('portal-' + kind + '-url').value = '';
    try {
      const cpf = $('portal-invite-cpf').value.replace(/\D/g, '');
      const data = await rpc('direct_portal_create_invite', { p_cpf: cpf || null, p_dias: Number($('portal-invite-days').value) });
      if (version !== generation || inviteVersion !== inviteRequest || !allowed()) return;
      for (const kind of ['cadastro', 'vagas']) $('portal-' + kind + '-url').value = new URL('/' + kind + '.html#convite=' + data[kind + '_token'], location.origin).href;
      $('portal-invite-expiry').textContent = 'Convite para uma pessoa. Válido até ' + new Date(data.expira_em).toLocaleDateString('pt-BR') + '.';
      $('portal-invite-links').hidden = false;
      msg('Copie o link de cadastro e envie no privado. Gere outro convite para a próxima pessoa.');
    } catch (error) { if (version === generation && inviteVersion === inviteRequest) msg(error.message); }
    finally { if (inviteVersion === inviteRequest) b.disabled = false; }
  });
  $('portal-contact-form').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter, version = generation; b.disabled = true;
    try {
      let phone = $('portal-whatsapp').value.replace(/\D/g, '');
      if (phone.length === 10 || phone.length === 11) phone = '55' + phone;
      await rpc('direct_portal_settings', { p_whatsapp: phone, p_grupo_url: $('portal-group').value.trim() });
      if (version === generation) $('portal-contact-feedback').textContent = 'Contatos salvos. Eles aparecerão após o cadastro.';
    } catch (error) { if (version === generation) $('portal-contact-feedback').textContent = error.message; }
    finally { b.disabled = false; }
  });
  function render(items) {
    $('portal-registration-list').replaceChildren();
    $('portal-registration-count').textContent = total;
    $('portal-registration-status').textContent = total ? '' : 'Nenhum cadastro recebido pelo link ainda. Gere um convite acima para começar.';
    $('portal-registration-status').hidden = total > 0;
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'portal-registration-row';
      const identity = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = item.nome;
      const info = document.createElement('small');
      info.textContent = 'CPF ' + formatCpf(item.cpf) + ' · ' + new Date(item.registrado_em).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' });
      identity.append(name, info);
      const view = document.createElement('button'); view.type = 'button'; view.className = 'view-button'; view.append(eyeIcon());
      view.title = 'Ver ficha e histórico'; view.setAttribute('aria-label', 'Ver cadastro de ' + item.nome);
      view.addEventListener('click', async () => {
        const version = generation; view.disabled = true;
        try {
          // Reutiliza a ficha principal, inclusive edição, disponibilidade e histórico.
          const workers = await request('/api/diaristas');
          if (version !== generation || !allowed()) return;
          records = workers;
          window.render();
          if (!records.some(w => w.id === item.id)) { await loadRegistrations(); return; }
          await openDetail(item.id);
        } catch (error) { if (version === generation) msg('Não foi possível abrir a ficha: ' + error.message); }
        finally { view.disabled = false; }
      });
      row.append(identity, view); $('portal-registration-list').append(row);
    }
    $('portal-registration-pagination').hidden = total <= 20;
    $('portal-registration-prev').disabled = offset === 0;
    $('portal-registration-next').disabled = offset + 20 >= total;
    $('portal-registration-page').textContent = 'Página ' + (offset / 20 + 1) + ' de ' + Math.max(1, Math.ceil(total / 20));
  }
  async function loadRegistrations() {
    const version = ++listRequest;
    $('portal-refresh').disabled = true;
    if (!allowed()) {
      $('portal-registration-status').hidden = false;
      $('portal-registration-status').textContent = 'Disponível no sistema publicado para administrador e operação.';
      $('portal-invite-form').querySelector('button').disabled = true;
      $('portal-refresh').disabled = false;
      return;
    }
    $('portal-invite-form').querySelector('button').disabled = false;
    try {
      let data = await rpc('direct_portal_registrations', { p_offset: offset });
      if (version !== listRequest || !allowed()) return;
      total = Number(data.total);
      // Uma exclusão pode retirar a última página: retorna à última página existente.
      if (offset && offset >= total) {
        offset = Math.max(0, (Math.ceil(total / 20) - 1) * 20);
        data = await rpc('direct_portal_registrations', { p_offset: offset });
        if (version !== listRequest || !allowed()) return;
        total = Number(data.total);
      }
      render(data.items);
    } catch (error) {
      if (version !== listRequest) return;
      $('portal-registration-list').replaceChildren(); $('portal-registration-pagination').hidden = true;
      $('portal-registration-count').textContent = '—';
      $('portal-registration-status').hidden = false;
      $('portal-registration-status').textContent = 'Não foi possível carregar os cadastros: ' + error.message + '. Toque em Atualizar para tentar novamente.';
    } finally { if (version === listRequest) $('portal-refresh').disabled = false; }
  }
  async function loadContacts() {
    const version = generation;
    $('portal-settings').hidden = !allowed();
    if (!allowed()) return;
    $('portal-contact-form').hidden = window.directRemote.role !== 'admin';
    try {
      const data = await rpc('direct_portal_settings');
      if (version !== generation || !allowed()) return;
      $('portal-whatsapp').value = data.whatsapp; $('portal-group').value = data.grupo_url;
    } catch (error) { if (version === generation) $('portal-contact-feedback').textContent = error.message; }
  }
  $('portal-refresh').addEventListener('click', () => { clearInvite(); offset = 0; loadRegistrations(); });
  $('portal-registration-prev').addEventListener('click', () => { offset = Math.max(0, offset - 20); loadRegistrations(); });
  $('portal-registration-next').addEventListener('click', () => { if (offset + 20 < total) { offset += 20; loadRegistrations(); } });
  function refresh() { if (active() && allowed()) loadRegistrations(); }
  window.addEventListener('direct:authorized', () => { if (active()) loadRegistrations(); loadContacts(); });
  window.addEventListener('hashchange', () => { if (active()) loadRegistrations(); if (location.hash === '#configuracoes') loadContacts(); });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  window.addEventListener('direct:signed-out', () => {
    generation++; listRequest++; offset = total = 0;
    $('portal-registration-list').replaceChildren(); $('portal-registration-count').textContent = '0';
    $('portal-registration-pagination').hidden = true; $('portal-registration-status').textContent = '';
    clearInvite(); $('portal-settings').hidden = true;
    $('portal-contact-form').reset(); $('portal-invite-form').reset(); msg(''); $('portal-contact-feedback').textContent = '';
  });
  if (active()) loadRegistrations();
  if (window.directRemote?.role) loadContacts();
})();
