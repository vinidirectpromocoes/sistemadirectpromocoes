import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(path.join(os.tmpdir(), 'direct-e2e-'));
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const url = `http://127.0.0.1:${port}/`;
const child = spawn(process.env.PYTHON || 'python3', ['server.py'], {
  cwd: root, env: { ...process.env, DIARISTAS_DB_PATH: path.join(work, 'qa.db'), DIARISTAS_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErrors = '';
child.stderr.on('data', chunk => { serverErrors += chunk.toString(); });

async function ready() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Servidor local não iniciou: ${serverErrors}`);
}

async function runBrowser(engine, name) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 },
      { width: 320, height: 640 }, { width: 844, height: 390 }]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 500,
        hasTouch: viewport.width < 500, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('#nav-diaristas').waitFor({ state: 'visible' });
      for (const tab of ['inicio', 'diaristas', 'pedidos', 'leitura', 'redes', 'financeiro', 'configuracoes']) {
        await page.locator(`#nav-${tab}`).click();
        assert.equal(new URL(page.url()).hash, `#${tab}`, `${name} ${viewport.width}: navegação ${tab}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 2, `${name} ${viewport.width}: aba ${tab} excede largura em ${overflow}px`);
      }
      await page.locator('#nav-diaristas').click();
      await page.locator('#new-button').click();
      await page.locator('#form-dialog').waitFor({ state: 'visible' });
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        smallInputs: [...document.querySelectorAll('input, select, textarea')]
          .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'
            && !['checkbox', 'radio', 'hidden', 'button', 'submit', 'file'].includes(element.type))
          .map(element => ({ id: element.id, size: parseFloat(getComputedStyle(element).fontSize) }))
          .filter(item => item.size < 16),
        viewport: document.querySelector('meta[name="viewport"]')?.content,
      }));
      assert.ok(metrics.scrollWidth <= metrics.width + 2,
        `${name} ${viewport.width}: largura ${metrics.scrollWidth} > ${metrics.width}`);
      if (viewport.width < 500) {
        assert.deepEqual(metrics.smallInputs, [], `${name} ${viewport.width}: campos podem provocar zoom no iPhone`);
        assert.ok(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(metrics.viewport || ''),
          `${name}: zoom de acessibilidade está bloqueado`);
        await page.locator('#nome').focus();
        await page.setViewportSize({ width: viewport.width, height: 420 });
        await page.locator('#save-button').scrollIntoViewIfNeeded();
        const footer = await page.locator('#save-button').boundingBox();
        assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= 422,
          `${name} ${viewport.width}: botão salvar inacessível com teclado aberto`);
        await page.setViewportSize(viewport);
      }
      await page.locator('#close-button').click();
      await page.locator('#form-dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, [], `${name} ${viewport.width}: erro JavaScript`);
      console.log(`${name} ${viewport.width}x${viewport.height}: navegação, formulário e largura OK`);
      await context.close();
    }
  } finally { await browser.close(); }
}

async function runRoleNavigation() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const role of ['admin', 'operacao', 'financeiro', 'consulta']) {
      let closing=false;
      const context = await browser.newContext({ acceptDownloads: true, serviceWorkers:'block' });
      await context.route(`https://direct.test:${port}/**`, async route => {
        const target = route.request().url().replace(`https://direct.test:${port}`, url.slice(0, -1));
        const response = await route.fetch({ url: target });
        try { await route.fulfill({ response }); } catch (error) { if (!closing) throw error; }
      });
      await context.route('**/vendor/supabase-2.117.2.js', route => route.fulfill({
        contentType: 'text/javascript', body: `window.supabase={createClient:()=>({
          auth:{getSession:async()=>({data:{session:{user:{email:'qa@example.invalid'}}},error:null}),onAuthStateChange:()=>{},signOut:async()=>({error:null})},
          from:(table)=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:[],error:null,count:0}),
            maybeSingle:async()=>({data:table==='direct_admins'?${role === 'admin' ? "{email:'qa@example.invalid'}" : 'null'}:
              table==='direct_staff'?${role === 'admin' ? 'null' : `{role:'${role}',active:true}`}:null,error:null}),
            then:(resolve)=>resolve({data:[],error:null})};return q;}})};`,
      }));
      await context.route('https://jxthqgtzybcyediyciqc.supabase.co/**', route => route.abort());
      const page = await context.newPage();
      await page.goto(`https://direct.test:${port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(expected => window.directRemote?.role === expected, role);
      for (const [id, allowed] of Object.entries({
        'nav-financeiro': ['admin', 'financeiro'], 'nav-configuracoes': ['admin', 'financeiro'],
        'nav-leitura': ['admin', 'operacao'], 'new-order-button': ['admin', 'operacao'],
        'backup-settings': ['admin'], 'staff-settings': ['admin'],
      })) {
        const enabledForRole = await page.locator(`#${id}`).evaluate(element => !element.hidden);
        assert.equal(enabledForRole, allowed.includes(role), `${role}: permissão de ${id}`);
      }
      if (role === 'admin') {
        await page.locator('#nav-configuracoes').click();
        await page.locator('#backup-password').fill('senha-de-teste-12345');
        const downloadReady = page.waitForEvent('download', { timeout: 5000 });
        await page.locator('#backup-download').click();
        const download = await downloadReady.catch(async error => {
          throw new Error(`Backup não baixou: ${await page.locator('#backup-feedback').innerText()} (${error.message})`);
        });
        const archive = path.join(work, 'browser-backup.json');
        await download.saveAs(archive);
        await page.locator('#backup-file').setInputFiles(archive);
        await page.locator('#backup-check').click();
        await page.getByText(/Cópia legível e íntegra/).waitFor();
        const output = path.join(work, 'browser-restored.db');
        const result = spawnSync(process.env.PYTHON || 'python3', ['-c',
          'import sys; sys.path.insert(0,"scripts"); from restore_backup import restore; restore(sys.argv[1],sys.argv[2],sys.argv[3])',
          archive, 'senha-de-teste-12345', output], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, `Cópia do navegador não restaurou: ${result.stderr}`);
        const operational = path.join(work, 'browser-operational.db');
        const drill = spawnSync(process.env.PYTHON || 'python3', ['-c',
          'import sys; sys.path.insert(0,"scripts"); from restore_backup import restore_operational; counts=restore_operational(sys.argv[1],sys.argv[2],sys.argv[3]); assert len(counts) == 18',
          archive, 'senha-de-teste-12345', operational], { cwd: root, encoding: 'utf8' });
        assert.equal(drill.status, 0, `Cópia operacional não restaurou: ${drill.stderr}`);
        console.log('Backup no navegador → verificação → SQLite operacional isolado OK');
      }
      console.log(`Perfil ${role}: navegação e ações visíveis OK`);
      closing=true;await context.close();
    }
  } finally { await browser.close(); }
}

async function runRealReading() {
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({serviceWorkers:'block'});const make=await context.newPage();
    const source=['Rede: Super do Povo','Loja: Meireles','Função: Operador de caixa','Horário: 07:00 as 15:20','Data de inicio: 29/09/2026 a 05/10/2026','Quantidade de dias: 7'];
    const png=await make.evaluate(lines=>{const c=document.createElement('canvas');c.width=1500;c.height=720;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#000';x.font='36px Arial';lines.forEach((line,i)=>x.fillText(line,40,80+i*90));return c.toDataURL('image/png');},source);
    const imagePath=path.join(work,'ocr-clear.png');await (await import('node:fs/promises')).writeFile(imagePath,Buffer.from(png.split(',')[1],'base64'));
    await make.setContent('<html lang="pt-BR"><body>'+source.map(line=>'<p>'+line+'</p>').join('')+'</body></html>');const digital=path.join(work,'ocr-digital.pdf');await make.pdf({path:digital,format:'A4'});
    await make.setContent('<html><body><img width="700" src="'+png+'"></body></html>');const scanned=path.join(work,'ocr-scanned.pdf');await make.pdf({path:scanned,format:'A4'});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const file of [imagePath,digital,scanned]) {
      await page.goto(url+'#leitura');await page.locator('#reading-file').setInputFiles(file);await page.locator('#reading-submit').click();
      await page.locator('#reading-result-items .reading-item').waitFor({timeout:90000});
      const text=await page.locator('#reading-result-items').innerText();assert.match(text,/Super do Povo/);assert.match(text,/Meireles/);
      const undo=page.getByRole('button',{name:'Desfazer este registro'});if(await undo.count()){await undo.click();await page.getByText('Desfeito').waitFor();}else assert.match(text,/revis|pend|confir/i);
      console.log('Reconhecimento real de '+path.basename(file)+': leitura de conteúdo e tratamento da revisão OK');
    }
    assert.deepEqual(errors,[],'OCR/PDF real: erro JavaScript');await context.close();
  }finally{await browser.close();}
}

async function runReadingFlow() {
  const browser = await chromium.launch({ headless: true });
  const source = `Rede: Super do Povo\nLoja: Meireles\nFunção: Operador de caixa\nHorário: 07:00 as 15:20\nData de inicio: 29/09/2026 a 05/10/2026\nQuantidade de dias: 7`;
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8fRZkAAAAASUVORK5CYII=', 'base64');
  try {
    for (const confidence of [31, 95]) {
      const context = await browser.newContext();
      await context.addInitScript(({ source, confidence }) => {
        window.Tesseract = { createWorker: async () => ({ recognize: async () => ({ data: { text: source, confidence } }) }) };
      }, { source, confidence });
      const page = await context.newPage();
      await page.goto(`${url}#leitura`, { waitUntil: 'domcontentloaded' });
      await page.locator('#reading-file').setInputFiles({ name: `teste-${confidence}.png`, mimeType: 'image/png', buffer: tinyPng });
      await page.locator('#reading-submit').click();
      await page.locator('#reading-result-items .reading-item').waitFor();
      const state = confidence < 75 ? 'pending' : 'saved';
      await page.locator(`#reading-result-items .reading-item.${state}`).waitFor();
      if (state === 'pending') {
        assert.match(await page.locator('#reading-result-items').innerText(), /Fotografe novamente/);
      } else {
        await page.getByRole('button', { name: 'Desfazer este registro' }).click();
        await page.getByText('Desfeito').waitFor();
      }
      console.log(`Leitura com confiança ${confidence}%: ${state === 'pending' ? 'revisão obrigatória' : 'registro e desfazer'} OK`);
      await context.close();
    }
  } finally { await browser.close(); }
}

async function runFinancialWorkflow() {
  const api = async (method, route, body) => {
    const response = await fetch(`${url.slice(0, -1)}${route}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  const worker = await api('POST', '/api/diaristas', {
    nome: 'Pessoa Financeira de Teste', cpf: '529.982.247-25', setores: ['Operador de caixa'],
    cep: '60000-000', logradouro: 'Rua de Teste', numero: '10', complemento: '', bairro: 'Meireles',
    trabalhando: false, local_trabalho: '', disponibilidade: [{ dia: 'segunda', inicio: '07:00', fim: '16:00' }],
    pode_se_deslocar: true, transporte: 'Ônibus', observacoes_locomocao: '',
  });
  await api('PUT', '/api/custos-extras', { rede: 'Super do Povo', transporte: '5.00', taxas: '0', outros: '0' });
  for (const day of ['2026-09-21', '2026-09-28']) {
    const order = await api('POST', '/api/pedidos', {
      supermercado: 'Super do Povo', unidade: 'Meireles', contato: '', setor: 'Operador de caixa',
      quantidade_diaristas: 1, turnos: [{ data: day, inicio: '07:00', fim: '15:20' }],
      situacao: 'confirmado', observacoes: '',
    });
    const scale = await api('POST', `/api/pedidos/${order.id}/escalas`, { diarista_id: worker.id, data: day });
    await api('PATCH', `/api/pedidos/${order.id}/escalas/${scale.id}`, { status: 'presente' });
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const scaleRequests = [];
    page.on('request', request => { if (/\/api\/(?:pedidos\/\d+\/)?escalas/.test(request.url())) scaleRequests.push(request.url()); });
    await page.goto(`${url}#financeiro`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Lucro previsto · após extras', {exact:true}).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      'Financeiro com dados não deve criar rolagem horizontal no celular');
    assert.match(await page.locator('#forecast-net').innerText(), /78,00/);
    assert.match(await page.locator('#confirmed-revenue').innerText(), /268,00/);
    assert.match(await page.locator('#confirmed-cost').innerText(), /180,00/);
    assert.match(await page.locator('#confirmed-profit').innerText(), /78,00/);
    assert.equal(await page.evaluate(() => {
      const charts = [...document.querySelectorAll('#financeiro-page .finance-dashboard, #financeiro-page .forecast-visuals')];
      const lists = [...document.querySelectorAll('#financeiro-page .workflow-section, #financeiro-page .forecast-order-section, #financeiro-page .finance-list')];
      return charts.every(chart => lists.every(list => Boolean(chart.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)));
    }), true, 'Todos os gráficos devem aparecer antes das listas');
    await page.locator('#forecast-period').selectOption('day');
    await page.locator('#forecast-date').fill('2026-09-28');
    assert.match(await page.locator('#confirmed-revenue').innerText(), /134,00/);
    assert.match(await page.locator('#confirmed-cost').innerText(), /90,00/);
    assert.match(await page.locator('#confirmed-profit').innerText(), /39,00/);
    assert.match(await page.locator('#forecast-net').innerText(), /39,00/);
    assert.match(await page.locator('#reconciliation-summary').innerText(), /1 presença/);
    await page.locator('#forecast-period').selectOption('week');
    assert.match(await page.locator('#forecast-period-note').innerText(), /28\/09\/2026 a 04\/10\/2026/);
    assert.match(await page.locator('#confirmed-revenue').innerText(), /134,00/);
    await page.locator('#forecast-period').selectOption('day');
    await page.locator('#forecast-date').fill('2026-09-27');
    assert.match(await page.locator('#confirmed-revenue').innerText(), /0,00/);
    assert.match(await page.locator('#forecast-net').innerText(), /0,00/);
    await page.locator('#forecast-today').click();
    assert.equal(await page.locator('#forecast-period').inputValue(), 'day');
    await page.locator('#forecast-week').click();
    assert.equal(await page.locator('#forecast-period').inputValue(), 'week');
    await page.locator('#forecast-period').selectOption('month');
    await page.locator('#finance-month').fill('2026-09');
    assert.match(await page.locator('#confirmed-revenue').innerText(), /268,00/);
    await page.locator('#forecast-period').selectOption('all');
    await page.setViewportSize({width:320,height:700});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Cards confirmados não devem transbordar em 320px');
    assert.ok(await page.locator('#forecast-date').evaluate(e => parseFloat(getComputedStyle(e).fontSize)) >= 16, 'Campo de data não deve induzir zoom');
    await page.locator('#theme-toggle').click();
    await page.screenshot({path:path.join(root,'.design-qa/financeiro-dashboard-mobile-dark.png'),fullPage:true,animations:'disabled'});
    await page.locator('#theme-toggle').click();
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:path.join(root,'.design-qa/financeiro-dashboard-desktop.png'),fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:390,height:844});

    await page.locator('#invoice-new').click();
    await page.locator('#invoice-network').selectOption('Super do Povo');
    await page.locator('#invoice-start').fill('2026-09-21');
    await page.locator('#invoice-end').fill('2026-09-28');
    await page.locator('#invoice-due').fill('2026-10-10');
    await page.locator('#invoice-note').fill('QA-2026');
    await page.getByText('2 presença(s) ainda não cobradas').waitFor();
    await page.locator('#invoice-create-submit').click();
    await page.locator('#invoice-list .workflow-entry').waitFor();
    await page.waitForFunction(() => document.querySelector('#reconciliation-summary')?.textContent.includes('2 cobradas'));
    assert.match(await page.locator('#reconciliation-summary').innerText(), /0 em cobranças integralmente recebidas/);
    assert.match(await page.locator('#invoice-billed').innerText(), /268,00/);
    await page.locator('#invoice-list .workflow-entry button').first().click();
    assert.equal(await page.locator('#invoice-detail-items .workflow-line').count(), 2);
    await page.locator('#invoice-receive-value').fill('100.00');
    await page.locator('#invoice-receive-form button').click();
    await page.waitForFunction(() => document.querySelector('#invoice-detail-summary')?.textContent.includes('168,00'));
    await page.locator('#invoice-detail-dialog [data-close-dialog]').last().click();
    await page.locator('#finance-rows .finance-group-row button').first().click();
    await page.getByRole('button', { name: 'Fechar pagamento (2)' }).click();
    assert.match(await page.locator('#batch-total').innerText(), /180,00/);
    await page.locator('#batch-method').fill('Pix');
    await page.locator('#batch-submit').click();
    await page.locator('#batch-list .workflow-entry').waitFor();
    assert.match(await page.locator('#finance-out').innerText(), /180,00/);
    assert.ok(scaleRequests.length > 0 && scaleRequests.every(path => path.endsWith('/api/escalas')),
      `Carregamento fez chamadas individuais por pedido: ${scaleRequests.join(', ')}`);
    assert.deepEqual(errors, [], 'Fluxo financeiro no navegador teve erro JavaScript');
    console.log('Cobrança por dois pedidos, recebimento parcial e fechamento de diárias no celular OK');
    await context.close();
  } finally { await browser.close(); }
}

async function runExtendedWorkflow() {
  const api=async(method,route,body)=>{const r=await fetch(url.slice(0,-1)+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
  const worker=(await api('GET','/api/diaristas'))[0];
  await api('PUT',`/api/diaristas/${worker.id}`,{...worker,disponibilidade:['segunda','terca','quarta','quinta','sexta','sabado','domingo'].map(dia=>({dia,inicio:'00:00',fim:'23:59'}))});
  const prior=new Date();prior.setDate(prior.getDate()-1);const day=prior.toISOString().slice(0,10);
  const source={supermercado:'Super do Povo',unidade:'Meireles',setor:'Operador de caixa',quantidade_diaristas:1,turnos:[{data:day,inicio:'07:00',fim:'15:20'}],situacao:'confirmado',observacoes:'TESTE INTERLIGAÇÃO'};
  const order=await api('POST','/api/pedidos',source);const scale=await api('POST',`/api/pedidos/${order.id}/escalas`,{diarista_id:worker.id,data:day});
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:320,height:640},isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url+'#diaristas');await page.evaluate(id=>openDetail(id),worker.id);
    await page.locator('#worker-reserve-button').click();await page.locator('#ext-telefone').fill('85999991234');await page.locator('#ext-reserva').selectOption('sim');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#detail-dialog').evaluate(e=>e.close());
    await page.locator('#nav-inicio').click();await page.getByText('85999991234').waitFor();
    await page.locator('#nav-pedidos').click();await page.waitForFunction(id=>orderRecords.some(x=>x.id===id),order.id);await page.evaluate(id=>openOrderDetail(id),order.id);
    await page.getByRole('button',{name:'✓ Confirmou',exact:true}).click();await page.getByText('Resposta: confirmada').waitFor();
    await page.getByRole('button',{name:/^Presença de/}).click();await page.getByRole('button',{name:'✓ Validar atendimento',exact:true}).waitFor();
    await page.getByRole('button',{name:'✓ Validar atendimento',exact:true}).click();await page.locator('#ext-loja_responsavel').fill('Ana da loja');await page.locator('#ext-chegada').fill('07:05');await page.locator('#ext-saida').fill('15:20');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.getByText('Loja: validado · Ana da loja').waitFor();
    await page.getByRole('button',{name:'⚑ Ocorrência',exact:true}).click();await page.locator('#ext-tipo').selectOption('elogio');await page.locator('#ext-descricao').fill('Atendimento bem avaliado na loja');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#order-detail-dialog').evaluate(e=>e.close());
    await page.locator('#occurrence-list').getByRole('button',{name:'✓ Resolver'}).click();await page.locator('#ext-resolucao').fill('Informado à equipe na conferência');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#occurrence-list').getByText(/resolvida/).waitFor();
    await page.locator('#nav-configuracoes').click();await page.locator('#contract-section').getByRole('button',{name:'+ Contrato',exact:true}).click();await page.locator('#ext-rede').selectOption('Super do Povo');await page.locator('#ext-loja').selectOption('Meireles');await page.locator('#ext-setor').selectOption('Operador de caixa');await page.locator('#ext-inicio').fill(day);await page.locator('#ext-valor_recebido').fill('150');await page.locator('#ext-valor_pago').fill('95');
    const width=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(width<=2,'Contrato não pode transbordar');
    const font=await page.locator('#ext-valor_recebido').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));assert.ok(font>=16,'Campo de contrato pode causar zoom');
    await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#contract-list').getByText(/150,00/).waitFor();
    await page.locator('#theme-toggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.locator('#contract-list').getByRole('button',{name:'↗ Nova versão'}).click();await page.locator('#extended-cancel').click();
    await page.locator('#device-section').getByRole('button',{name:'▶ Executar diagnóstico'}).click();assert.match(await page.locator('#device-result').innerText(),/serviceWorker/);
    await page.locator('#nav-financeiro').click();await page.locator('#invoice-review-list .extended-entry').waitFor();
    await page.locator('#invoice-review-list').getByRole('button',{name:'✓ Conferir'}).first().click();await page.locator('#ext-conferencia').selectOption('contestada');await page.locator('#ext-responsavel').fill('Marcos');await page.locator('#ext-motivo').fill('Conferir horário solicitado pela loja');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#invoice-review-list').getByText(/contestada/).waitFor();
    await page.evaluate(()=>{window.print=()=>{window.qaPrinted=document.getElementById('print-demonstrative').innerText;};});await page.locator('#invoice-review-list').getByRole('button',{name:'▤ PDF / imprimir'}).first().click();assert.match(await page.evaluate(()=>window.qaPrinted),/Pessoa Financeira de Teste/);assert.match(await page.evaluate(()=>window.qaPrinted),/Total: R\$\s*268,00/);
    await page.locator('#nav-pedidos').click();await page.waitForFunction(id=>orderRecords.some(x=>x.id===id),order.id);await page.evaluate(id=>openOrderDetail(id),order.id);await page.locator('#order-repeat-button').click();await page.locator('#ext-inicio').fill('2026-10-12');await page.locator('#extended-save').click();await page.getByText('Conferir pedido repetido').waitFor();assert.equal(await page.locator('.order-shift-date').first().inputValue(),'2026-10-12');
    // Guardar rascunho com a conexão cortada; nenhum pedido é gravado nessa etapa.
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await context.setOffline(true);await page.locator('#order-save-draft').click();await page.locator('#order-dialog').waitFor({state:'hidden'});await page.locator('#nav-inicio').click();await page.locator('#offline-drafts .extended-entry').waitFor();
    const encrypted=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('direct-offline-v1');r.onsuccess=()=>{const q=r.result.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result.every(row=>row.blob instanceof ArrayBuffer&&!JSON.stringify(row).includes('Pessoa Financeira')));q.onerror=reject;};r.onerror=reject;}));assert.equal(encrypted,true,'Agenda e rascunho devem estar cifrados');
    await context.setOffline(false);const before=(await api('GET','/api/pedidos')).length;await page.locator('#offline-drafts').getByRole('button',{name:'↗ Revisar'}).click();await page.locator('#order-save-button').click();await page.locator('#order-dialog').waitFor({state:'hidden'});assert.equal((await api('GET','/api/pedidos')).length,before+1);await page.locator('#nav-inicio').click();await page.getByText('Nenhum rascunho guardado.').waitFor();
    const cached=await page.evaluate(async()=>{const keys=await caches.keys();const paths=[];for(const key of keys)for(const r of await(await caches.open(key)).keys())paths.push(new URL(r.url).pathname);return paths;});assert.ok(cached.length>10);assert.ok(cached.every(p=>!p.startsWith('/api/')),'Cache não deve armazenar respostas da API');
    await page.screenshot({path:path.join(root,'.design-qa/operacao-mobile-dark.png'),fullPage:true,animations:'disabled'});assert.deepEqual(errors,[],'Fluxos integrados com erro JavaScript');
    console.log('Operação ampliada: reserva, confirmação, validação, ocorrência, contrato, contestação, PDF, repetição e rascunho offline OK');await context.close();
  }finally{await browser.close();}
}

async function runAssignmentPersistence() {
  const api = async (method, route, body) => {
    const response = await fetch(new URL(route, url), {method, headers: {'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  const worker = await api('POST','/api/diaristas', {
    nome:'Pessoa com nome longo para escala de teste', cpf:'11144477735', setores:['FLV'],
    cep:'60000000', logradouro:'Rua de Teste', numero:'1', bairro:'Meireles', trabalhando:false,
    disponibilidade:['segunda','terca','quarta','quinta','sexta','sabado','domingo'].map(dia=>({dia,inicio:'00:00',fim:'23:59'})),
    pode_se_deslocar:true, transporte:'Ônibus', observacoes_locomocao:'',
  });
  let week = 0;
  for (const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
    const browser = await engine.launch({headless:true});
    try {
      for (const width of [1280,390,320]) {
        const shifts = Array.from({length:7},(_,index)=>({data:new Date(Date.UTC(2030,0,1+7*week+index)).toISOString().slice(0,10),inicio:'07:00',fim:'15:20'})); week++;
        const order = await api('POST','/api/pedidos',{supermercado:'Super do Povo',unidade:'Meireles',setor:'Repositor de FLV',quantidade_diaristas:1,turnos:shifts,situacao:'confirmado'});
        const context = await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
        const page = await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        await page.goto(`${url}#pedidos`);
        const firstDateLabel = shifts[0].data.split('-').reverse().join('/');
        const row = page.locator('#orders-rows tr').filter({hasText:'Repositor de FLV'}).filter({hasText:firstDateLabel});
        await row.getByRole('button').click();
        const cards = page.locator('#order-detail-shifts .order-day-card');
        try {await cards.first().getByRole('combobox').waitFor();}
        catch(error) {console.error(`${name} ${width}: pedido ${order.id}: ${await page.locator('#order-detail-dialog').innerText()}`);throw error;}
        const clipped = await cards.first().evaluate(card=>{
          const button=card.querySelector('.order-worker-picker button').getBoundingClientRect(), bounds=card.getBoundingClientRect();
          return button.left<bounds.left || button.right>bounds.right+1;
        });
        assert.equal(clipped,false,`${name} ${width}: botão Escalar escondido fora do card`);
        await cards.first().getByRole('combobox').selectOption(String(worker.id));
        await page.getByRole('button',{name:'Todos os dias possíveis (7)',exact:true}).waitFor();
        assert.equal((await api('GET',`/api/pedidos/${order.id}/escalas`)).length,0,'Selecionar exige confirmação antes de gravar');
        await page.getByRole('button',{name:'Cancelar',exact:true}).click();
        assert.equal(await cards.first().getByRole('combobox').inputValue(),'');
        await cards.first().getByRole('combobox').selectOption(String(worker.id));
        let failRefresh = name==='Chromium' && width===1280;
        const simulateRefreshFailure = failRefresh;
        if (simulateRefreshFailure) await page.route(`**/api/pedidos/${order.id}/escalas`,async route=>{
          if (route.request().method()==='GET' && failRefresh) {
            failRefresh=false; await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({erro:'Falha simulada de atualização'})});
          } else await route.continue();
        });
        await page.getByRole('button',{name:'Só este dia',exact:true}).click();
        if (simulateRefreshFailure) {
          await page.locator('#order-detail-error').waitFor({state:'visible'});
          assert.match(await page.locator('#order-detail-error').innerText(),/A escala foi salva/,'Falha de atualização não deve informar que uma gravação confirmada falhou');
        } else await page.locator('#order-detail-success').waitFor({state:'visible'});
        assert.equal((await api('GET',`/api/pedidos/${order.id}/escalas`)).length,1);
        if (simulateRefreshFailure) {
          await page.reload(); await page.locator('#orders-rows tr').filter({hasText:'Repositor de FLV'}).filter({hasText:firstDateLabel}).getByRole('button').click();
          await cards.first().locator('.order-worker-row').waitFor();
        }
        await cards.nth(1).getByRole('combobox').selectOption(String(worker.id));
        await page.getByRole('button',{name:'Todos os dias possíveis (6)',exact:true}).click();
        await page.getByText('Diarista escalada em 6 dias deste pedido.',{exact:true}).waitFor();
        assert.equal((await api('GET',`/api/pedidos/${order.id}/escalas`)).length,7);
        await page.reload(); await page.locator('#orders-rows tr').filter({hasText:'Repositor de FLV'}).filter({hasText:firstDateLabel}).getByRole('button').click();
        await page.locator('#order-detail-shifts .order-worker-row').nth(6).waitFor();
        assert.equal(await page.locator('#order-detail-shifts .order-worker-row').count(),7,'Escalas persistem ao recarregar e reabrir');
        assert.deepEqual(errors,[]); console.log(`${name} ${width}: Escalar visível, confirmação, cancelamento e persistência de 7 dias OK`);
        await context.close();
      }
    } finally {await browser.close();}
  }
}

try {
  await ready();
  await runBrowser(chromium, 'Chromium');
  await runBrowser(webkit, 'WebKit');
  await runRoleNavigation();
  if(process.env.DIRECT_REAL_OCR==='1')await runRealReading();
  await runReadingFlow();
  await runFinancialWorkflow();
  await runExtendedWorkflow();
  await runAssignmentPersistence();
} finally {
  child.kill();
  await rm(work, { recursive: true, force: true });
}
