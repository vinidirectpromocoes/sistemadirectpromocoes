(() => {
  const area = document.querySelector('#backup-settings');
  if (!area) return;
  const tables = ['diaristas', 'diarias', 'pedidos', 'pedido_escalas', 'lojas',
    'financeiro_lancamentos', 'tarifas_redes', 'tarifas_setores', 'leituras_pendentes',
    'direct_staff', 'direct_auditoria', 'cobrancas', 'cobranca_itens',
    'cobranca_recebimentos', 'pagamento_lotes', 'custos_extras'];
  const legacyTables = tables.slice(0, 11);
  const output = document.querySelector('#backup-feedback');
  const lastCheck = document.querySelector('#backup-last-check');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const toBase64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  function showLastCheck() {
    const value = localStorage.getItem('direct-backup-verified-at');
    if (!value || Number.isNaN(Date.parse(value))) {
      lastCheck.textContent = 'Nenhuma cópia foi verificada neste aparelho.';
      return;
    }
    const days = Math.floor((Date.now() - Date.parse(value)) / 86400000);
    lastCheck.textContent = `Última verificação neste aparelho: ${new Date(value).toLocaleString('pt-BR')}.${days >= 7 ? ' Faça uma nova cópia agora.' : ''}`;
  }

  async function key(password, salt) {
    const secret = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
      secret, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function password() {
    const value = document.querySelector('#backup-password').value;
    if (value.length < 12) throw new Error('Informe uma senha de pelo menos 12 caracteres.');
    return value;
  }
  async function fetchTable(table) {
    const all = [];
    let expected = null;
    const sortKey = table === 'direct_staff' ? 'email' : table === 'custos_extras' ? 'rede' : 'id';
    for (let start = 0; ; start += 1000) {
      const { data, error, count } = await window.directRemote.client.from(table)
        .select('*', { count: 'exact' }).order(sortKey).range(start, start + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (expected === null) expected = count;
      if (count !== expected) throw new Error(`${table}: os dados mudaram durante a cópia; tente novamente.`);
      all.push(...data);
      if (all.length === expected) return all;
      if (!data.length || all.length > expected) throw new Error(`${table}: contagem divergente; tente novamente.`);
    }
  }
  async function download() {
    if (window.directRemote?.role !== 'admin') return;
    const button = document.querySelector('#backup-download'); button.disabled = true;
    try {
      const pass = password();
      const data = {};
      for (const table of tables) {
        output.textContent = `Copiando ${table}...`;
        data[table] = await fetchTable(table);
      }
      const payload = { format: 'direct-data-v3', exportedAt: new Date().toISOString(), tables: data };
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt), encoder.encode(JSON.stringify(payload)));
      const archive = { format: 'direct-encrypted-v1', salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) };
      const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `direct-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      output.textContent = `Cópia baixada: ${tables.length} tabelas. Use “Verificar cópia” para testar o arquivo.`;
    } catch (error) { output.textContent = `Falha na cópia: ${error.message}`; }
    finally { button.disabled = false; }
  }
  async function check() {
    const button = document.querySelector('#backup-check'); button.disabled = true;
    try {
      const file = document.querySelector('#backup-file').files[0];
      if (!file) throw new Error('Selecione um arquivo de cópia.');
      const archive = JSON.parse(await file.text());
      if (archive.format !== 'direct-encrypted-v1') throw new Error('Formato de arquivo não reconhecido.');
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(archive.iv) },
        await key(password(), fromBase64(archive.salt)), fromBase64(archive.data));
      const payload = JSON.parse(decoder.decode(plain));
      const required = payload.format === 'direct-data-v3' ? tables : payload.format === 'direct-data-v2' ? tables.slice(0, 15) : payload.format === 'direct-data-v1' ? legacyTables : null;
      if (!required || !required.every(table => Array.isArray(payload.tables?.[table]))) throw new Error('Arquivo incompleto.');
      const count = required.reduce((sum, table) => sum + payload.tables[table].length, 0);
      const missing = payload.format === 'direct-data-v1' ? ' Esta cópia antiga não inclui cobranças, fechamentos e custos extras.' :
        payload.format === 'direct-data-v2' ? ' Esta cópia antiga não inclui custos extras.' : '';
      output.textContent = `Cópia legível e íntegra: ${count} registro(s) em ${required.length} tabelas, criada em ${new Date(payload.exportedAt).toLocaleString('pt-BR')}.${missing}`;
      localStorage.setItem('direct-backup-verified-at', new Date().toISOString());
      showLastCheck();
    } catch (error) { output.textContent = `Não foi possível verificar: ${error.message}. Confira a senha e o arquivo.`; }
    finally { button.disabled = false; }
  }
  document.querySelector('#backup-download').addEventListener('click', download);
  document.querySelector('#backup-check').addEventListener('click', check);
  window.addEventListener('hashchange', () => { area.hidden = window.directRemote?.role !== 'admin'; });
  area.hidden = window.directRemote?.role !== 'admin';
  showLastCheck();
})();
