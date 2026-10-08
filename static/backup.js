(() => {
  const area = document.querySelector('#backup-settings');
  if (!area) return;
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
  async function download() {
    if (window.directRemote?.role !== 'admin') return;
    const button = document.querySelector('#backup-download'); button.disabled = true;
    try {
      const pass = password();
      output.textContent = 'Preparando cópia consistente no banco...';
      const { data: payload, error } = await window.directRemote.client.rpc('direct_backup_snapshot_v9');
      if (error) throw new Error(error.message);
      const verified = window.DirectBackup.validate(payload);
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
      output.textContent = `Cópia baixada: ${verified.tables} tabelas, incluindo contatos e links privados. Use “Verificar cópia” para testar o arquivo.`;
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
      const checked = window.DirectBackup.validate(payload);
      const missing = ['direct-data-v5','direct-data-v6','direct-data-v7','direct-data-v8'].includes(payload.format) ? '' : ' Esta cópia antiga não inclui configurações e vínculos privados do portal.';
      output.textContent = `Cópia legível e íntegra: ${checked.count} registro(s) em ${checked.tables} tabelas, criada em ${new Date(payload.exportedAt).toLocaleString('pt-BR')}.${missing}`;
      localStorage.setItem('direct-backup-verified-at', new Date().toISOString());
      showLastCheck();
    } catch (error) { output.textContent = `Não foi possível verificar: ${error.message}. Confira a senha e o arquivo.`; }
    finally { button.disabled = false; }
  }
  document.querySelector('#backup-download').addEventListener('click', download);
  document.querySelector('#backup-check').addEventListener('click', check);
  window.addEventListener('hashchange', () => { area.hidden = window.directRemote?.role !== 'admin'; });
  area.hidden = window.directRemote?.role !== 'admin';
  const panel=document.createElement('details');panel.className='profile-more';
  const heading=document.createElement('summary');heading.textContent='Cópias automáticas e recuperação';
  const status=document.createElement('p');status.setAttribute('role','status');
  const history=document.createElement('div');const button=document.createElement('button');button.type='button';button.className='button button-outline';button.textContent='Atualizar histórico';
  panel.append(heading,status,button,history);area.append(panel);
  async function refresh(){
    area.hidden=window.directRemote?.role!=='admin';if(area.hidden)return;
    button.disabled=true;
    try{const result=await window.directRemote.client.rpc('direct_backup_status');if(result.error)throw Error(result.error.message);
      const rows=result.data.runs||[],last=rows.find(r=>r.state==='ok'&&r.verified);const old=!last||Date.now()-Date.parse(last.finished_at)>36*3600000;
      status.textContent=old?'Atenção: sem cópia automática verificada nas últimas 36 horas. Confira se o Mac está ligado e a rotina está ativa.':'Última cópia verificada: '+new Date(last.finished_at).toLocaleString('pt-BR')+'.';status.classList.toggle('finance-warning',old);history.replaceChildren();
      for(const row of rows.slice(0,10)){const line=document.createElement('p');line.textContent=new Date(row.started_at).toLocaleString('pt-BR')+' · '+({ok:'Verificada',running:'Em execução',error:'Falhou'}[row.state])+' · '+(row.message||'');history.append(line);}
      if(!rows.length)history.textContent='Nenhuma execução registrada.';
    }catch(e){status.textContent='Não foi possível conferir as cópias: '+e.message;}finally{button.disabled=false;}
  }
  button.onclick=refresh;panel.addEventListener('toggle',()=>{if(panel.open)refresh();});
  window.addEventListener('direct:authorized',refresh);window.addEventListener('hashchange',()=>{if(location.hash==='#configuracoes')refresh();});
  refresh();
  showLastCheck();
})();
