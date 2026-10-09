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
    try { const response=await fetch(url); await response.arrayBuffer(); if(response.ok)return; } catch { /* server is starting */ }
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
      for (const tab of ['inicio', 'crm', 'diaristas', 'pedidos', 'leitura', 'redes', 'financeiro', 'configuracoes', 'convites', 'vagas', 'pedidos-links']) {
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
      const context = await browser.newContext({ acceptDownloads: true, serviceWorkers:'block' });
      await context.route(`https://direct.test:${port}/**`, async route => {
        const target = route.request().url().replace(`https://direct.test:${port}`, url.slice(0, -1));
        const response = await route.fetch({ url: target });
        await route.fulfill({ response });
      });
      await context.route('**/vendor/supabase-2.117.2.js', route => route.fulfill({
        contentType: 'text/javascript', body: `window.supabase={createClient:()=>({
          rpc:async(name)=>({data:name==='direct_backup_snapshot_v10'?{format:'direct-data-v10',exportedAt:new Date().toISOString(),tables:Object.fromEntries(window.DirectBackup.versions['direct-data-v10'].map(t=>[t,[]])),snapshot:{consistent:true,counts:Object.fromEntries(window.DirectBackup.versions['direct-data-v10'].map(t=>[t,0]))}}:name==='direct_network_links'||name==='direct_portal_vacancies'?[]:name==='direct_portal_registrations'?{total:0,items:[]}:{whatsapp:'',grupo_url:''},error:null}),
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
        'nav-pedidos-links': ['admin','operacao'], 'nav-vagas': ['admin', 'operacao'], 'nav-convites': ['admin', 'operacao'], 'nav-leitura': ['admin', 'operacao', 'financeiro', 'consulta'], 'new-order-button': ['admin', 'operacao'],
        'backup-settings': ['admin'], 'staff-settings': ['admin'],
        'store-requests-button': ['admin','operacao'], 'daily-summary-button': ['admin','operacao'], 'order-models-button': ['admin','operacao'], 'cash-agenda': ['admin','financeiro'],
      })) {
        const enabledForRole = await page.locator(`#${id}`).evaluate(element => !element.hidden);
        assert.equal(enabledForRole, allowed.includes(role), `${role}: permissão de ${id}`);
      }
      await page.evaluate(() => { location.hash = '#vagas'; });
      if (['admin','operacao'].includes(role)) {
        await page.locator('#vagas-page').waitFor({state:'visible'});
        await page.getByText('Nenhuma escala completa disponível. Cadastre um pedido na Leitura IA ou na aba Pedidos.').waitFor();
      } else { await page.waitForFunction(() => location.hash === '#inicio'); }
      await page.evaluate(() => { location.hash = '#convites'; });
      if (['admin', 'operacao'].includes(role)) {
        await page.locator('#convites-page').waitFor({state:'visible'});
        await page.getByText('Nenhum cadastro recebido pelo link ainda.').waitFor();
      } else {
        await page.waitForFunction(() => location.hash === '#inicio');
        assert.equal(await page.locator('#convites-page').isVisible(), false);
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
          'import sys; sys.path.insert(0,"scripts"); from restore_backup import restore_operational; counts=restore_operational(sys.argv[1],sys.argv[2],sys.argv[3]); assert len(counts) == 35',
          archive, 'senha-de-teste-12345', operational], { cwd: root, encoding: 'utf8' });
        assert.equal(drill.status, 0, `Cópia operacional não restaurou: ${drill.stderr}`);
        console.log('Backup no navegador → verificação → SQLite operacional isolado OK');
      }
      await page.locator('#nav-inicio').click();
      await page.locator('#inicio-page').waitFor({state:'visible'});
      assert.equal(await page.locator('#home-finance-cards').isVisible(), ['admin','financeiro'].includes(role), 'Dashboard respeita o perfil financeiro');
      assert.equal(await page.locator('#home-workers-card').isVisible(), role!=='consulta', 'Consulta não recebe fichas de diaristas');
      await page.locator('#nav-crm').click();
      await page.locator('#crm-page').waitFor({state:'visible'});
      assert.equal(await page.locator('[data-crm-area=financeiro]').isVisible(), ['admin','financeiro'].includes(role));
      assert.equal(await page.locator('[data-crm-scope=payment]').isVisible(), ['admin','financeiro'].includes(role));
      assert.equal(await page.locator('[data-crm-area=cadastros]').isVisible(), role!=='consulta');
      assert.equal(await page.locator('#crm-support').isVisible(), role!=='consulta');
      assert.equal(await page.locator('#crm-filters').isVisible(),false);
      console.log(`Perfil ${role}: navegação e ações visíveis OK`);
      await page.waitForLoadState('networkidle');
      await context.unrouteAll({behavior:'wait'});
      await context.close();
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
      await page.locator('#reading-result-items .reading-item').waitFor().catch(async e=>{console.error('READING DIAGNOSTIC',confidence,await page.locator('#reading-feedback').innerText(),await page.locator('#reading-result-items').innerText());throw e;});
      const state = confidence < 75 ? 'pending' : 'saved';
      await page.locator('#reading-result-items .reading-preview').waitFor();
      if(state==='saved') await page.locator('#reading-confirm').click();
      await page.locator(`#reading-result-items .reading-item.${state}`).waitFor();
      if (state === 'pending') {
        assert.match(await page.locator('#reading-result-items').innerText(), /Fotografe novamente/);
        await page.getByRole('button',{name:'Guardar pendência',exact:true}).click();await page.getByRole('button',{name:'Pendência guardada',exact:true}).waitFor();
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
    nome: 'Pessoa Financeira de Teste', cpf: '529.982.247-25', data_nascimento:'1990-04-10', cidade:'Caucaia', uf:'CE', setores: ['Operador de caixa'],
    cep: '60000-000', logradouro: 'Rua de Teste', numero: '10', complemento: '', bairro: 'Meireles',
    trabalhando: false, local_trabalho: '', disponibilidade: [{ dia: 'segunda', inicio: '07:00', fim: '16:00' }],
    pode_se_deslocar: false, transporte: 'Ônibus, Uber', observacoes_locomocao: 'Centro',
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
    await page.goto(`${url}#diaristas`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof openForm==='function');
    await page.evaluate(record=>openForm(record),worker);
    assert.equal(await page.locator('#cidade').inputValue(),'Caucaia');
    assert.equal(await page.locator('#data_nascimento').inputValue(),'1990-04-10');
    assert.equal(await page.locator('#transporte').inputValue(),'Ônibus, Uber');
    await page.locator('#save-button').click();await page.locator('#form-dialog').waitFor({state:'hidden'});
    const edited=(await api('GET','/api/diaristas')).find(w=>w.id===worker.id);assert.equal(edited.cidade,'Caucaia');assert.equal(edited.data_nascimento,'1990-04-10');assert.equal(edited.transporte,'Ônibus, Uber');
    await page.goto(`${url}#financeiro`, { waitUntil: 'domcontentloaded' });
    await page.locator('#financeiro-page').getByText('Lucro previsto · após extras', {exact:true}).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      'Financeiro com dados não deve criar rolagem horizontal no celular');
    assert.equal(await page.locator('#forecast-period').inputValue(), 'month', 'O período começa no mês selecionado');
    await page.locator('#finance-month').fill('2026-09');
    await page.locator('#confirmed-count').getByText('2 diárias com presença', {exact:true}).waitFor();
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
    assert.equal(await page.locator('#batch-title, #reconciliation-title, #review-section, #invoice-title, #forecast-orders-summary').count(),0,'Os blocos removidos não aparecem no financeiro');
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

    await page.evaluate(() => window.openInvoiceCreate());
    await page.locator('#invoice-network').selectOption('Super do Povo');
    await page.locator('#invoice-start').fill('2026-09-21');
    await page.locator('#invoice-end').fill('2026-09-28');
    await page.locator('#invoice-end').dispatchEvent('change');
    assert.equal(await page.locator('#invoice-due').inputValue(), '2026-10-15', 'Cobrança deve sugerir o calendário da rede');
    await page.locator('#invoice-due').fill('2026-10-10');
    await page.locator('#invoice-note').fill('QA-2026');
    await page.getByText('2 presença(s) ainda não cobradas').waitFor();
    await page.locator('#invoice-create-submit').click();
    await page.locator('#invoice-create-dialog').waitFor({state:'hidden'});
    const createdInvoices=await api('GET','/api/cobrancas');
    assert.ok(createdInvoices.some(i=>i.valor_centavos===26800));
    await page.evaluate(async id=>{await loadFinance();window.openInvoiceDetail(id);},createdInvoices.find(i=>i.valor_centavos===26800).id);
    assert.equal(await page.locator('#invoice-detail-items .workflow-line').count(), 2);
    await page.locator('#invoice-receive-value').fill('100.00');
    await page.locator('#invoice-receive-form button').click();
    await page.waitForFunction(() => document.querySelector('#invoice-detail-summary')?.textContent.includes('168,00'));
    await page.locator('#invoice-detail-dialog [data-close-dialog]').last().click();
    await page.locator('#finance-month').fill('2026-10');
    await page.locator('#finance-rows .finance-group-row button').first().click();
    await page.getByRole('button', { name: 'Fechar pagamento (2)' }).click();
    assert.match(await page.locator('#batch-total').innerText(), /180,00/);
    await page.locator('#batch-date').fill('2026-09-30');
    await page.locator('#batch-method').fill('Pix');
    await page.locator('#batch-submit').click();
    await page.locator('#batch-dialog').waitFor({state:'hidden'});
    const paidBatch=await api('GET','/api/pagamento-lotes');assert.ok(paidBatch.some(b=>b.valor_centavos===18000),'Pagamento em lote continua gravado sem o bloco na página');
    await page.locator('#finance-month').fill('2026-09');
    await page.waitForFunction(()=>document.querySelector('#finance-out').textContent.includes('180,00'));
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
    await page.locator('#nav-crm').click();if(!await page.locator('#crm-support').evaluate(e=>e.open))await page.locator('#crm-support > summary').click();await page.locator('details.crm-tool').filter({has:page.locator('#reserves-section')}).locator('summary').click();await page.locator('#reserves-section').getByText('85999991234').waitFor();
    await page.locator('#nav-pedidos').click();await page.waitForFunction(id=>orderRecords.some(x=>x.id===id),order.id);await page.evaluate(id=>openOrderDetail(id),order.id);
    await page.getByRole('button',{name:'✓ Confirmou que vai',exact:true}).click();await page.getByText('Resposta: confirmada').waitFor();
    await page.getByRole('button',{name:/^Presença de/}).click();await page.getByRole('button',{name:'✓ Validar atendimento',exact:true}).waitFor();
    await page.getByRole('button',{name:'✓ Validar atendimento',exact:true}).click();await page.locator('#ext-loja_responsavel').fill('Ana da loja');await page.locator('#ext-chegada').fill('07:05');await page.locator('#ext-saida').fill('15:20');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.getByText('Loja: validado · Ana da loja').waitFor();
    await page.getByRole('button',{name:'⚑ Ocorrência',exact:true}).click();await page.locator('#ext-tipo').selectOption('elogio');await page.locator('#ext-descricao').fill('Atendimento bem avaliado na loja');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#order-detail-dialog').evaluate(e=>e.close());
    await page.locator('#occurrence-list').getByRole('button',{name:'✓ Resolver'}).click();await page.locator('#ext-resolucao').fill('Informado à equipe na conferência');await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#occurrence-list').getByText(/resolvida/).waitFor();
    await page.route('**/api/tarifas',async route=>{await new Promise(resolve=>setTimeout(resolve,400));await route.continue();});
    await page.locator('#nav-configuracoes').click();await page.locator('#contract-section').getByRole('button',{name:'+ Contrato',exact:true}).click();await page.locator('#ext-rede').selectOption('Super do Povo').catch(async e=>{await page.screenshot({path:'/tmp/direct-extended-fail.png'});throw Error(e.message+' STATE '+JSON.stringify(await page.evaluate(()=>({open:document.querySelector('#extended-dialog').open,title:document.querySelector('#extended-title').textContent,hash:location.hash,rect:document.querySelector('#ext-rede').getBoundingClientRect().toJSON(),feedback:document.querySelector('#extended-feedback').textContent,active:document.activeElement?.id}))));});await page.unroute('**/api/tarifas');await page.locator('#ext-loja').selectOption('Meireles');await page.locator('#ext-setor').selectOption('Operador de caixa');await page.locator('#ext-inicio').fill(day);await page.locator('#ext-valor_recebido').fill('150');await page.locator('#ext-valor_pago').fill('95');
    const width=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(width<=2,'Contrato não pode transbordar');
    const font=await page.locator('#ext-valor_recebido').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));assert.ok(font>=16,'Campo de contrato pode causar zoom');
    await page.locator('#extended-save').click();await page.locator('#extended-dialog').waitFor({state:'hidden'});await page.locator('#contract-list').getByText(/150,00/).waitFor();
    await page.locator('#theme-toggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.locator('#contract-list').getByRole('button',{name:'↗ Nova versão'}).click();await page.locator('#extended-cancel').click();
    await page.locator('#device-section').getByRole('button',{name:'▶ Executar diagnóstico'}).click();assert.match(await page.locator('#device-result').innerText(),/serviceWorker/);
    await page.locator('#nav-financeiro').click();assert.equal(await page.locator('#review-section').count(),0);
    await page.locator('#nav-pedidos').click();await page.waitForFunction(id=>orderRecords.some(x=>x.id===id),order.id);await page.evaluate(id=>openOrderDetail(id),order.id);await page.locator('#order-repeat-button').click();await page.locator('#ext-inicio').fill('2026-10-12');await page.locator('#extended-save').click();await page.getByText('Conferir pedido repetido').waitFor();assert.equal(await page.locator('.order-shift-date').first().inputValue(),'2026-10-12');
    // Guardar rascunho com a conexão cortada; nenhum pedido é gravado nessa etapa.
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await context.setOffline(true);await page.locator('#order-save-draft').click();await page.locator('#order-dialog').waitFor({state:'hidden'});await page.locator('#nav-crm').click();if(!await page.locator('#crm-support').evaluate(e=>e.open))await page.locator('#crm-support > summary').click();await page.locator('details.crm-tool').filter({has:page.locator('#offline-panel')}).locator('summary').click();await page.locator('#offline-drafts .extended-entry').waitFor();
    const encrypted=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('direct-offline-v1');r.onsuccess=()=>{const q=r.result.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result.every(row=>row.blob instanceof ArrayBuffer&&!JSON.stringify(row).includes('Pessoa Financeira')));q.onerror=reject;};r.onerror=reject;}));assert.equal(encrypted,true,'Agenda e rascunho devem estar cifrados');
    await context.setOffline(false);const before=(await api('GET','/api/pedidos')).length;await page.locator('#offline-drafts').getByRole('button',{name:'↗ Revisar'}).click();await page.locator('#order-save-button').click();await page.locator('#order-dialog').waitFor({state:'hidden'});assert.equal((await api('GET','/api/pedidos')).length,before+1);await page.locator('#nav-crm').click();await page.getByText('Nenhum rascunho guardado.').waitFor();
    const cached=await page.evaluate(async()=>{const keys=await caches.keys();const paths=[];for(const key of keys)for(const r of await(await caches.open(key)).keys())paths.push(new URL(r.url).pathname);return paths;});assert.ok(cached.length>10);assert.ok(cached.every(p=>!p.startsWith('/api/')),'Cache não deve armazenar respostas da API');
    await page.screenshot({path:path.join(root,'.design-qa/operacao-mobile-dark.png'),fullPage:true,animations:'disabled'});assert.deepEqual(errors,[],'Fluxos integrados com erro JavaScript');
    console.log('Operação ampliada: reserva, confirmação, validação, ocorrência, contrato, financeiro compacto, repetição e rascunho offline OK');await context.close();
  }finally{await browser.close();}
}

async function runCRMWorkflow() {
  const api=async(method,route,body)=>{const r=await fetch(new URL(route,url),{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
  const fixtures=[];const future='2035-01-01';
  for(let i=0;i<12;i++)fixtures.push(await api('POST','/api/pedidos',{supermercado:'Super do Povo',unidade:`Pendências Teste ${i}`,setor:'FLV',quantidade_diaristas:1,turnos:[{data:future,inicio:'07:00',fim:'15:20'},{data:'2035-01-02',inicio:'07:00',fim:'15:20'}],situacao:'novo'}));
  const disposable=fixtures[0];
  try {for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
    const browser=await engine.launch();try{for(const width of [1280,390,320]){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url+'#inicio');await page.waitForFunction(()=>Number(document.getElementById('home-stores').textContent)>0);await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#inicio-page .extended-list, #inicio-page .home-actions, #inicio-page .offline-panel').count(),0,'Início deve conter apenas resumo e dashboards');
      assert.equal(await page.locator('#inicio-page .hub-charts .finance-chart-card').count(),4);
      await page.locator('#nav-crm').click();await page.locator('.crm-record').first().waitFor();await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#crm-page h1').innerText(),'Pendências');assert.equal(await page.locator('#crm-filters').isVisible(),false);assert.equal(await page.locator('.crm-column').count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Pendências com dados não devem transbordar');
      for(const [task,title] of [['vacancy','Precisa de diarista'],['response','Aguardando confirmação'],['attendance','Presença a registrar'],['payment','Pagamento a realizar']]){await page.locator(`[data-crm-scope=${task}]`).click();assert.match(await page.locator('#crm-list-title').innerText(),new RegExp(title));assert.equal(await page.locator(`[data-crm-scope=${task}]`).getAttribute('aria-pressed'),'true');await page.locator('#crm-all').click();}await page.locator('[data-crm-area=operacao]').click();
      const before=await page.locator('.crm-record').count();await page.locator('#crm-board').getByRole('button',{name:/Ver mais/}).click();assert.ok(await page.locator('.crm-record').count()>before,'Paginação revela pedidos sem duplicar dias');
      assert.equal(await page.locator('[data-crm-key="pedido:'+fixtures[1].id+'"]').count(),1);
      await page.locator('#crm-filter-toggle').click();
      await page.locator('[data-crm-scope=waiting]').click();assert.match(await page.locator('#crm-list-title').innerText(),/Aguardando retorno/);await page.locator('#crm-all').click();
      await page.locator('[data-crm-scope=overdue]').click();assert.match(await page.locator('#crm-list-title').innerText(),/Atrasadas/);await page.locator('#crm-all').click();
      await page.locator('#crm-search').fill('Pendências Teste 1');
      const first=page.locator('.crm-record').first();await first.locator('.pending-details > summary').click();assert.equal(await first.locator('.pending-issue').count(),2);await first.getByRole('button',{name:'Escalar diarista',exact:true}).first().click();await page.locator('#order-detail-dialog').waitFor({state:'visible'});await page.locator('#order-detail-close').click();await page.locator('#nav-crm').click();
      await page.locator('#crm-clear').click();await page.locator('[data-crm-area=financeiro]').click();await page.locator('#crm-search').fill('Pessoa Financeira');assert.ok(await page.locator('.crm-record').count()>0);assert.equal(await page.locator('.crm-record').evaluateAll(items=>items.every(x=>x.textContent.includes('Pessoa Financeira'))),true);
      const group=page.locator('[data-crm-key^="pagamentos:"]').first();await group.getByRole('button',{name:'Conferir diárias',exact:true}).click();await page.locator('#finance-group-dialog').waitFor({state:'visible'});assert.match(await page.locator('#finance-group-title').innerText(),/Pessoa Financeira/);assert.equal(await page.locator('#finance-status-filter').inputValue(),'pendente');await page.locator('#finance-group-close').click();await page.locator('#nav-crm').click();
      await page.locator('#crm-history').click();assert.match(await page.locator('#crm-list-title').innerText(),/Histórico/);await page.locator('#crm-pending').click();await page.locator('#crm-clear').click();
      if(name==='Chromium'&&width===1280){
        const reading=(await api('GET','/api/leituras-pendentes')).find(r=>r.status==='pendente'&&r.tipo==='pedido');assert.ok(reading);
        await page.locator('[data-crm-area=cadastros]').click();await page.locator('#crm-search').fill(`Leitura #${reading.id}`);await page.locator(`[data-crm-key="leitura:${reading.id}"]`).getByRole('button',{name:'Revisar leitura',exact:true}).click();
        await page.locator('#crm-reading-dialog').waitFor({state:'visible'});assert.match(await page.locator('#crm-reading-text').innerText(),/Meireles/);await page.locator('#crm-reading-complete').click();await page.locator('#order-dialog').waitFor({state:'visible'});await page.locator('#order-close-button').click();await page.locator('#nav-crm').click();await page.locator('#crm-clear').click();
        await page.locator('[data-crm-area=operacao]').click();await page.locator('#crm-search').fill('Pendências Teste 0');await page.locator(`[data-crm-key="pedido:${disposable.id}"]`).waitFor();
        await api('PUT',`/api/pedidos/${disposable.id}`,{...disposable,situacao:'cancelado'});await page.locator('#crm-refresh').click();await page.locator(`[data-crm-key="pedido:${disposable.id}"]`).waitFor({state:'detached'});await page.locator('#crm-history').click();await page.locator(`[data-crm-key="pedido:${disposable.id}"]`).waitFor();assert.match(await page.locator('#crm-board').innerText(),/Pedido cancelado/);
        await api('DELETE',`/api/pedidos/${disposable.id}`);await page.locator('#crm-refresh').click();await page.locator(`[data-crm-key="pedido:${disposable.id}"]`).waitFor({state:'detached'});await page.locator('#crm-pending').click();await page.locator('#crm-clear').click();
      }
      await page.locator('[data-crm-area=operacao]').click();await page.locator('#crm-clear').click();await page.locator('#crm-filter-toggle').click();
      await page.screenshot({path:path.join(root,`.design-qa/pendencias-${name}-${width}-light.png`),fullPage:true,animations:'disabled'});await page.locator('#theme-toggle').click();await page.screenshot({path:path.join(root,`.design-qa/pendencias-${name}-${width}-dark.png`),fullPage:true,animations:'disabled'});await page.locator('#theme-toggle').click();
      if(width<500){await page.locator('#crm-filter-toggle').click();const inputs=await page.locator('#crm-page input, #crm-page select').evaluateAll(items=>items.filter(x=>x.getClientRects().length).map(x=>parseFloat(getComputedStyle(x).fontSize)));assert.ok(inputs.every(n=>n>=16),'Filtros não devem induzir zoom');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Filtros abertos não devem transbordar');}
      await page.waitForLoadState('networkidle');assert.deepEqual(errors,[],`${name} ${width}: Pendências sem erros JavaScript`);console.log(`${name} ${width}: Pendências agrupadas, prioridades, filtros, histórico, links e largura OK`);await context.close();
    }}finally{await browser.close();}
  }}finally{for(const f of fixtures.slice(1))await api('DELETE',`/api/pedidos/${f.id}`);}
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
        await row.getByRole('button',{name:'Ver pedido de Super do Povo',exact:true}).click();
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
          // Aguarda os controles auxiliares para não abortar fetches no WebKit/Linux ao recarregar.
          await page.evaluate(async()=>{await loadHome();await window.DirectOperations.refresh();await window.DirectManagementUI.refresh();});
          await page.waitForFunction(()=>activeRequests===0 && !orderDetailBusy);
          await page.waitForLoadState('networkidle');
          await page.reload(); await page.locator('#orders-rows tr').filter({hasText:'Repositor de FLV'}).filter({hasText:firstDateLabel}).getByRole('button',{name:'Ver pedido de Super do Povo',exact:true}).click();
          await cards.first().locator('.order-worker-row').waitFor();
        }
        await cards.nth(1).getByRole('combobox').selectOption(String(worker.id));
        await page.getByRole('button',{name:'Todos os dias possíveis (6)',exact:true}).click();
        await page.getByText('Diarista escalada em 6 dias deste pedido.',{exact:true}).waitFor();
        assert.equal((await api('GET',`/api/pedidos/${order.id}/escalas`)).length,7);
        // Aguarda os controles auxiliares para não abortar fetches no WebKit/Linux ao recarregar.
          await page.evaluate(async()=>{await loadHome();await window.DirectOperations.refresh();await window.DirectManagementUI.refresh();});
          await page.waitForFunction(()=>activeRequests===0 && !orderDetailBusy);
          await page.waitForLoadState('networkidle');
          await page.reload(); await page.locator('#orders-rows tr').filter({hasText:'Repositor de FLV'}).filter({hasText:firstDateLabel}).getByRole('button',{name:'Ver pedido de Super do Povo',exact:true}).click();
        await page.locator('#order-detail-shifts .order-worker-row').nth(6).waitFor();
        assert.equal(await page.locator('#order-detail-shifts .order-worker-row').count(),7,'Escalas persistem ao recarregar e reabrir');
        await page.waitForLoadState('networkidle');
        assert.deepEqual(errors,[]); console.log(`${name} ${width}: Escalar visível, confirmação, cancelamento e persistência de 7 dias OK`);
        await context.close();
      }
    } finally {await browser.close();}
  }
}

async function runPartialRegistration() {
  const api=async(method,route,body)=>{const r=await fetch(new URL(route,url),{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
  function cpfFor(n){let v=String(n);for(let size=9;size<=10;size++){const sum=[...v].reduce((n,x,i)=>n+Number(x)*(size+1-i),0),digit=(sum*10)%11;v+=digit===10?'0':String(digit);}return v;}
  let serial=999003000;
  for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
    const browser=await engine.launch();try{for(const width of [1280,390,320]){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const cpf=cpfFor(++serial),label=`Cadastro Parcial ${name} ${width}`;
      await page.goto(url+'#diaristas');await page.locator('#new-button').click();await page.locator('#nome').fill(label);await page.locator('#cpf').fill(cpf);await page.locator('#save-button').click();await page.locator('#form-dialog').waitFor({state:'hidden'});
      let saved=(await api('GET','/api/diaristas')).find(x=>x.cpf===cpf);assert.ok(saved);assert.equal(saved.trabalhando,null);assert.equal(saved.pode_se_deslocar,null);assert.deepEqual(saved.disponibilidade,[]);
      await page.reload();await page.getByRole('row').filter({hasText:label}).getByRole('button',{name:`Ver ficha e histórico de ${label}`,exact:true}).click();await page.locator('#detail-dialog').waitFor({state:'visible'});assert.match(await page.locator('#detail-status').innerText(),/Cadastro parcial/);assert.match(await page.locator('#detail-fields').innerText(),/Não informado/);
      await page.locator('#edit-button').click();assert.equal(await page.locator('input[name=trabalhando][value=unknown]').isChecked(),true);assert.equal(await page.locator('input[name=pode_se_deslocar][value=unknown]').isChecked(),true);
      await page.locator('#telefone').fill('(85) 99999-1234');await page.locator('#setores').fill('FLV');await page.locator('#cep').fill('60000000');await page.locator('#logradouro').fill('Rua Teste');await page.locator('#numero').fill('1');await page.locator('#bairro').fill('Centro');await page.locator('input[name=trabalhando][value=false]').check();await page.locator('input[name=pode_se_deslocar][value=false]').check();await page.locator('.day-row[data-day=segunda] .day-enabled').check();await page.locator('#save-button').click();await page.locator('#form-dialog').waitFor({state:'hidden'});
      saved=(await api('GET','/api/diaristas')).find(x=>x.cpf===cpf);assert.equal(saved.telefone,'85999991234');assert.equal(saved.trabalhando,false);assert.equal(saved.pode_se_deslocar,false);assert.equal(saved.setores[0],'FLV');assert.equal(saved.disponibilidade.length,1);await page.reload();await page.getByRole('row').filter({hasText:label}).getByRole('button',{name:`Ver ficha e histórico de ${label}`,exact:true}).click();await page.locator('#detail-dialog').waitFor({state:'visible'});assert.doesNotMatch(await page.locator('#detail-status').innerText(),/Cadastro parcial/);assert.match(await page.locator('#detail-fields').innerText(),/85999991234/);await page.locator('#detail-close-button').click();
      if(name==='Chromium'&&width===1280){
        const aiCpf=cpfFor(++serial);await page.locator('#nav-leitura').click();await page.locator('#reading-text').fill(`Nome Completo: Leitura Parcial\nCPF: ${aiCpf}`);await page.locator('#reading-submit').click();await page.locator('#reading-confirm').click();await page.locator('#reading-result-items .reading-item.saved').waitFor();const partial=(await api('GET','/api/diaristas')).find(x=>x.cpf===aiCpf);assert.ok(partial);assert.equal(partial.trabalhando,null);assert.deepEqual(partial.setores,[]);await api('DELETE',`/api/diaristas/${partial.id}`);
        await page.locator('#reading-text').fill(`Nome Completo: ${label}\nCPF: ${cpf}\nBairro: Meireles`);await page.locator('#reading-submit').click();await page.locator('#reading-confirm').click();await page.locator('#reading-result-items .reading-item.duplicate').waitFor();await page.locator('#reading-result-items').getByRole('button',{name:'Completar no formulário',exact:true}).click();await page.locator('#form-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#setores').inputValue(),'FLV');assert.equal(await page.locator('#logradouro').inputValue(),'Rua Teste');assert.equal(await page.locator('#bairro').inputValue(),'Meireles');await page.locator('#save-button').click();await page.locator('#form-dialog').waitFor({state:'hidden'});assert.equal((await api('GET','/api/diaristas')).filter(x=>x.cpf===cpf).length,1);
      }
      assert.deepEqual(errors,[]);console.log(`${name} ${width}: cadastro com nome/CPF, respostas não informadas, completar, recarregar e preservar dados OK`);await page.waitForLoadState('networkidle');await api('DELETE',`/api/diaristas/${saved.id}`);await context.close();
    }}finally{await browser.close();}
  }
}

async function runPaymentCalendars() {
  for (const [engine, name] of [[chromium, 'Chromium'], [webkit, 'WebKit']]) {
    const browser = await engine.launch({headless:true});
    try {
      const context = await browser.newContext({viewport:{width:320,height:700},isMobile:true,hasTouch:true});
      const page = await context.newPage(), errors=[];
      page.on('pageerror', error=>errors.push(error.message));
      await page.goto(`${url}#configuracoes`);
      const form = page.getByRole('form', {name:'Calendário de Super do Povo',exact:true});
      await form.getByRole('button', {name:'Salvar calendário'}).waitFor();
      const inputs = form.locator('input');
      assert.equal(await inputs.nth(0).inputValue(),'30'); assert.equal(await inputs.nth(1).inputValue(),'15');
      const calendarFields = await form.locator('input, select').evaluateAll(elements => elements
        .filter(e => e.getClientRects().length)
        .map(e => ({type:e.type, fontSize:parseFloat(getComputedStyle(e).fontSize)})));
      assert.ok(calendarFields.every(field=>field.fontSize>=16),
        `${name}: campos do calendário devem evitar zoom de foco: ${JSON.stringify(calendarFields)}`);
      for(const theme of ['light','dark']) {
        await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Calendários cabem em 320px');
      }
      await inputs.nth(1).fill('18'); await form.getByRole('button',{name:'Salvar calendário'}).click();
      await page.getByText('Calendário de Super do Povo atualizado para recebimentos e pagamentos.',{exact:true}).waitFor();
      await page.waitForLoadState('networkidle'); await page.reload();
      await form.getByRole('button', {name:'Salvar calendário'}).waitFor(); assert.equal(await form.locator('input').nth(1).inputValue(),'18');
      await form.locator('input').nth(1).fill('15');await form.getByRole('button',{name:'Salvar calendário'}).click();
      await page.getByText('Calendário de Super do Povo atualizado para recebimentos e pagamentos.',{exact:true}).waitFor();
      const weekly=page.getByRole('form',{name:'Calendário de Pinheiro',exact:true});
      assert.equal(await weekly.getByLabel('Frequência de pagamento').inputValue(),'semanal');
      assert.equal(await weekly.getByLabel('Prazo na semana seguinte').inputValue(),'6');
      assert.equal(await weekly.locator('input').nth(0).isVisible(),false);
      assert.match(await weekly.innerText(),/segunda a domingo.*até sábado.*semana seguinte/);
      assert.ok(await weekly.getByLabel('Prazo na semana seguinte').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=16);
      await weekly.getByLabel('Prazo na semana seguinte').selectOption('5');
      await weekly.getByRole('button',{name:'Salvar calendário'}).click();
      await page.getByText('Calendário de Pinheiro atualizado para recebimentos e pagamentos.',{exact:true}).waitFor();
      await page.waitForLoadState('networkidle');await page.reload();
      await weekly.getByRole('button',{name:'Salvar calendário'}).waitFor();
      assert.equal(await weekly.getByLabel('Prazo na semana seguinte').inputValue(),'5');
      await weekly.getByLabel('Prazo na semana seguinte').selectOption('6');
      await weekly.getByRole('button',{name:'Salvar calendário'}).click();
      await page.getByText('Calendário de Pinheiro atualizado para recebimentos e pagamentos.',{exact:true}).waitFor();
      if(name==='WebKit'){await weekly.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/direct-calendario-semanal.png'});}
      await page.waitForLoadState('networkidle'); assert.deepEqual(errors,[]);
      console.log(`${name} 320px: calendários quinzenal/semanal, próxima semana, persistência, tema e foco sem zoom OK`);
      await context.close();
    } finally { await browser.close(); }
  }
}

async function runLinkedReading() {
  const api=async(method,route,data)=>{const response=await fetch(url.slice(0,-1)+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  function cpfFor(n){let v=String(n);for(let size=9;size<=10;size++){const sum=[...v].reduce((total,x,i)=>total+Number(x)*(size+1-i),0),digit=(sum*10)%11;v+=digit===10?'0':String(digit);}return v;}
  let serial=999004000;
  for(const [engine,name] of [[chromium,'Chromium'],[webkit,'WebKit']]) {
    const browser=await engine.launch({headless:true});
    try {for(const width of [1280,390,320]) {
      const cpf=cpfFor(++serial),workerName=`Pessoa Leitura ${name} ${width===320?'Compacta':width===390?'Celular':'Desktop'}`;
      const start=width===1280?'06:00':'13:40',end=width===1280?'14:20':'22:00';
      const message=`*NOVA SOLICITAÇÃO*\nREDE: Hipermarket\n*${width===1280?'Loja':'Região'}:* LOJA VILA UNIÃO\n*Função:* Repositor de mercearia\n*Horário:* ${start} as ${end}\n*Data de início:* 03/10/2026\n*Quantidade de dias:* 2 dias\n\n*${width===1280?'nome: ':''}${workerName}*\nCPF: ${cpf}`;
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const existingOrder=width===390?await api('POST','/api/pedidos',{supermercado:'hipermarket',unidade:'vila união',setor:'repositor de mercearia',quantidade_diaristas:1,turnos:[{data:'2026-10-03',inicio:start,fim:end},{data:'2026-10-04',inicio:start,fim:end}]}):null;
      await page.goto(url+'#leitura');await page.locator('#reading-text').fill(message);await page.locator('#reading-submit').click();
      await page.locator('#reading-confirm').waitFor();
      assert.equal((await api('GET','/api/diaristas')).filter(w=>w.cpf===cpf).length,0,'Sugestão não cadastra automaticamente pessoa desconhecida');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Sugestão cabe no celular');
      await page.locator('#reading-confirm').click();
      await page.waitForFunction(()=>document.querySelector('#reading-result-items .reading-item.saved')?.textContent.includes('2 dia(s) escalado(s)'));
      assert.equal(await page.locator('#reading-result-items').getByRole('button',{name:'Desfazer este registro',exact:true}).count(),0,'Cadastro e escala conjuntos são gerenciados no pedido');
      const worker=(await api('GET','/api/diaristas')).find(w=>w.cpf===cpf);assert.ok(worker);assert.deepEqual(worker.disponibilidade,[]);assert.deepEqual(worker.setores,[]);assert.equal(worker.trabalhando,null);
      const assignments=(await api('GET','/api/escalas')).filter(e=>e.diarista_id===worker.id);
      assert.equal(assignments.length,2);assert.deepEqual(assignments.map(e=>e.data),['2026-10-03','2026-10-04']);assert.ok(assignments.every(e=>e.status==='escalada'&&e.disponibilidade_pedido_confirmada));
      if(existingOrder) assert.ok(assignments.every(e=>e.pedido_id===existingOrder.id),'Vincula pedido existente com diferenças de maiúsculas');
      assert.equal((await api('GET','/api/pedidos')).find(o=>o.id===assignments[0].pedido_id).situacao,'confirmado');
      await page.locator('#reading-text').fill(message);await page.locator('#reading-submit').click();await page.locator('#reading-confirm').click();await page.locator('#reading-result-items .reading-item.duplicate').waitFor();
      assert.equal((await api('GET','/api/escalas')).filter(e=>e.diarista_id===worker.id).length,2,'Releitura não duplica escala');
      await page.locator('#reading-result-items').getByRole('button',{name:'Ver pedido e escala',exact:true}).click();await page.locator('#order-detail-dialog').waitFor({state:'visible'});await page.waitForFunction(name=>document.querySelector('#order-detail-shifts')?.textContent.includes(name),workerName);assert.match(await page.locator('#order-detail-shifts').innerText(),new RegExp(workerName));await page.locator('#order-detail-close-bottom').click();
      let orderRow=page.locator('#orders-rows tr').filter({hasText:workerName});assert.equal(await orderRow.count(),1);assert.match(await orderRow.innerText(),/Confirmado/);
      await page.reload();await orderRow.waitFor();assert.match(await orderRow.innerText(),/Confirmado/);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Nome escalado cabe na tela');
      await page.waitForLoadState('networkidle');assert.deepEqual(errors,[]);
      for(const scale of assignments) await api('DELETE',`/api/pedidos/${scale.pedido_id}/escalas/${scale.id}`);
      await api('DELETE',`/api/pedidos/${assignments[0].pedido_id}`);await api('DELETE',`/api/diaristas/${worker.id}`);
      console.log(`${name} ${width}: pedido com nome/CPF, sugestão, cadastro básico, 2 escalas, releitura e navegação OK`);
      await context.close();
    }}finally{await browser.close();}
  }
}

async function runOrderFilters() {
  const api=async(method,route,data)=>{const response=await fetch(url.slice(0,-1)+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  const created=[];
  for(const [network,store,sector,quantity,status,days] of [
    ['Super do Povo','Meireles','FLV',2,'novo',[1,3,5]],
    ['Super do Povo','Cambeba','Operador de caixa',1,'confirmado',[2,4]],
    ['Hipermarket','Vila União','FLV',3,'novo',[1,6]],
    ['Super do Povo','Meireles','Operador de caixa',1,'cancelado',[3]]]) {
    created.push(await api('POST','/api/pedidos',{supermercado:network,unidade:store,setor:sector,quantidade_diaristas:quantity,situacao:status,contato:'Teste Filtros QA',turnos:days.map(d=>({data:`2026-10-${String(d).padStart(2,'0')}`,inicio:'07:00',fim:'15:20'}))}));
  }
  const total=(await api('GET','/api/pedidos')).length;
  try {for(const [engine,name] of [[chromium,'Chromium'],[webkit,'WebKit']]) {
    const browser=await engine.launch({headless:true});
    try {for(const width of [1280,390,320]) {
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url+'#pedidos');await page.locator('#orders-search').fill('Filtros QA');
      await page.waitForFunction(()=>document.querySelectorAll('#orders-rows tr').length===4);
      assert.equal(await page.locator('#orders-open-count').innerText(),'2');assert.equal(await page.locator('#orders-demand-count').innerText(),'12');
      await page.locator('#orders-filter-toggle').click();
      await page.locator('#orders-network-filter').selectOption('super do povo');
      assert.equal(await page.locator('#orders-rows tr').count(),3);assert.equal(await page.locator('#orders-confirmed-count').innerText(),'1');
      await page.locator('#orders-store-filter').selectOption('meireles');assert.equal(await page.locator('#orders-rows tr').count(),2);
      await page.locator('#orders-sector-filter').selectOption('flv');assert.equal(await page.locator('#orders-rows tr').count(),1);
      await page.locator('#orders-start-filter').fill('2026-10-03');await page.locator('#orders-end-filter').fill('2026-10-04');
      await page.waitForFunction(()=>document.querySelector('#orders-demand-count').textContent==='2');
      assert.equal(await page.locator('.weekly-card').count(),0);assert.match(await page.locator('#orders-rows').innerText(),/03\/10\/2026/);assert.doesNotMatch(await page.locator('#orders-rows').innerText(),/01\/10\/2026|05\/10\/2026/);
      assert.match(await page.locator('#orders-rows').innerText(),/1 dia.*2 diárias no período/);assert.equal(await page.locator('#weekly-date').count(),0);
      await page.locator('#orders-status-filter').selectOption('confirmado');assert.equal(await page.locator('#orders-rows tr').count(),0);assert.ok(await page.locator('#orders-no-results').isVisible());
      await page.locator('#orders-status-filter').selectOption('novo');
      await page.locator('#orders-start-filter').fill('2026-10-05');await page.locator('#orders-end-filter').fill('2026-10-03');assert.ok(await page.locator('#orders-filter-error').isVisible());assert.equal(await page.locator('#orders-rows tr').count(),0);
      await page.locator('#orders-end-filter').fill('2026-10-06');assert.equal(await page.locator('#orders-demand-count').innerText(),'2');assert.equal(await page.locator('#orders-filter-error').isVisible(),false);
      await page.locator('#orders-start-filter').fill('');await page.locator('#orders-end-filter').fill('2026-10-02');assert.equal(await page.locator('#orders-demand-count').innerText(),'2');assert.match(await page.locator('#orders-rows').innerText(),/01\/10\/2026/);
      await page.locator('#orders-end-filter').fill('');await page.locator('#orders-start-filter').fill('2026-10-03');assert.equal(await page.locator('#orders-demand-count').innerText(),'4');assert.match(await page.locator('#orders-rows').innerText(),/2 dias/);
      for(const theme of ['light','dark']) {
        await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Filtros cabem na tela');
        if(width<500) assert.equal(await page.locator('#orders-filter-fields input, #orders-filter-fields select').evaluateAll(elements=>elements.some(e=>parseFloat(getComputedStyle(e).fontSize)<16)),false,'Filtros não provocam zoom de foco');
      }
      await page.locator('#orders-filter-toggle').click();assert.equal(await page.locator('#orders-filter-fields').isVisible(),false);assert.equal(await page.locator('#orders-rows tr').count(),1,'Fechar filtros preserva seleção');
      await page.locator('#orders-filter-clear').click();assert.equal(await page.locator('#orders-rows tr').count(),total);assert.equal(await page.locator('#orders-search').inputValue(),'');assert.equal(await page.locator('#orders-filter-clear').isDisabled(),true);
      await page.locator('#orders-filter-toggle').click();await page.locator('#orders-search').fill('Filtros QA');await page.locator('#orders-network-filter').selectOption('super do povo');await page.locator('#orders-store-filter').selectOption('cambeba');
      await page.locator('#orders-network-filter').selectOption('hipermarket');assert.equal(await page.locator('#orders-store-filter').inputValue(),'todos');assert.equal(await page.locator('#orders-rows tr').count(),1,'Mudar rede remove loja incompatível');
      await page.waitForLoadState('networkidle');assert.deepEqual(errors,[]);console.log(`${name} ${width}: rede, loja, setor, situação, período, cards, escala, intervalo inválido, limpar e temas OK`);await context.close();
    }}finally{await browser.close();}
  }} finally {for(const order of created)await api('DELETE',`/api/pedidos/${order.id}`);}
}

async function runScaleLifecycle() {
  const api=async(method,route,data)=>{const response=await fetch(url.slice(0,-1)+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  function cpfFor(n){let v=String(n);for(let size=9;size<=10;size++){const sum=[...v].reduce((total,x,i)=>total+Number(x)*(size+1-i),0),digit=(sum*10)%11;v+=digit===10?'0':String(digit);}return v;}
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());let serial=999006000;
  for(const [engine,name]of [[chromium,'Chromium'],[webkit,'WebKit']]){
    const browser=await engine.launch();try{for(const width of [1280,390,320]){
      const label=`Lifecycle ${name} ${width}`,person=`Original ${label}`, substitute=`Substituta ${label}`;
      const original=await api('POST','/api/leitura/pedido-escalado',{pedido:{supermercado:'Hipermarket',unidade:'Vila União',setor:'Repositor de FLV',contato:label,quantidade_diaristas:1,turnos:[{data:day,inicio:'00:00',fim:'23:59'}]},diarista:{nome:person,cpf:cpfFor(++serial)},confirmar_cadastro:true,chave_operacao:crypto.randomUUID()});
      const replacement=await api('POST','/api/diaristas',{nome:substitute,cpf:cpfFor(++serial)});
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url+'#pedidos');await page.locator('#orders-search').fill(label);let row=page.locator('#orders-rows tr');await row.filter({hasText:person}).waitFor();assert.equal(await page.locator('.weekly-card').count(),0);
      assert.equal(await row.locator('.order-neon.green').count(),1);
      await row.getByRole('button',{name:`Editar pedido #${original.pedido_id}`,exact:true}).click();await page.locator('#order-dialog').waitFor({state:'visible'});await page.locator('#order-cancel-button').click();
      await row.getByText('Hipermarket',{exact:true}).click();await page.locator('#order-detail-dialog').waitFor({state:'visible'});
      await page.getByRole('button',{name:'✓ Confirmou que vai',exact:true}).click();await page.getByText('Resposta: confirmada',{exact:true}).waitFor();
      let scale=(await api('GET','/api/escalas')).find(s=>s.pedido_id===original.pedido_id);assert.equal(scale.status,'escalada');assert.equal(scale.confirmacao,'confirmou');assert.equal(scale.diaria,null);
      await page.getByRole('button',{name:`Substituir ${person} em ${day.split('-').reverse().join('/')}`,exact:true}).click();
      await page.getByLabel(`Pessoa substituta de ${person}`,{exact:true}).selectOption(String(replacement.id));await page.getByLabel('Motivo da desistência para substituir',{exact:true}).fill('Desistiu por motivo pessoal');await page.getByText('Confirmei a disponibilidade da pessoa substituta para os dias e horários escolhidos',{exact:true}).click();await page.getByRole('button',{name:'Salvar substituição',exact:true}).click();
      await page.getByText(/^Substituição registrada somente em /).waitFor();
      let scales=(await api('GET','/api/escalas')).filter(s=>s.pedido_id===original.pedido_id);const old=scales.find(s=>s.diarista_id===original.diarista_id),current=scales.find(s=>s.diarista_id===replacement.id);assert.equal(old.status,'desistiu');assert.equal(old.substituida_por_escala_id,current.id);assert.equal(old.confirmacao,'confirmou');assert.equal(current.status,'escalada');assert.equal(current.confirmacao,'aguardando');assert.equal(current.diaria,null);
      await page.locator('#order-detail-close-bottom').click();
      // This assertion checks persistence after the save and its dependent refreshes.
      // Reload during an unfinished read is covered separately by fluency_e2e.
      await page.waitForLoadState('networkidle');await page.waitForFunction(()=>activeRequests===0);
      await page.reload();await page.locator('#orders-search').fill(label);await row.filter({hasText:substitute}).waitFor();assert.doesNotMatch(await row.innerText(),new RegExp(`Escalados?: ${person}`));assert.equal(await row.locator('.order-neon.green').count(),1);
      await row.getByRole('button',{name:'Ver pedido de Hipermarket',exact:true}).click();await page.locator('#order-detail-dialog').waitFor({state:'visible'});
      page.once('dialog',dialog=>dialog.accept('Desistência comunicada para teste'));
      await page.getByRole('button',{name:`Desistência de ${substitute} em ${day.split('-').reverse().join('/')}`,exact:true}).click();await page.getByText(/^Desistência registrada. Diarista retirado das escalas deste dia em diante neste pedido/).waitFor();
      await page.locator('#order-detail-close-bottom').click();assert.equal(await row.locator('.order-neon.yellow').count(),1);
      assert.equal(await page.evaluate(()=>orderCoverage({id:99999,situacao:'novo',quantidade_diaristas:1,turnos:[{data:'2099-10-01',inicio:'07:00',fim:'15:20'}]}).color),'red');
      for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));}
      await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await row.locator('.order-neon').evaluate(e=>getComputedStyle(e).animationName),'none');
      await page.waitForLoadState('networkidle');assert.deepEqual(errors,[]);console.log(`${name} ${width}: lista sem escala semanal, edição, confirmou que vai, desistência, substituição atômica, histórico, neon e persistência OK`);await context.close();
    }}finally{await browser.close();}
  }
}

async function runRecentOrderAttendance() {
  const api=async(method,route,data)=>{const response=await fetch(url.slice(0,-1)+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  function cpfFor(n){let v=String(n);for(let size=9;size<=10;size++){const sum=[...v].reduce((total,x,i)=>total+Number(x)*(size+1-i),0),digit=(sum*10)%11;v+=digit===10?'0':String(digit);}return v;}
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const first=new Date(today+'T12:00:00Z');first.setUTCDate(first.getUTCDate()-2);const firstDay=first.toISOString().slice(0,10),display=firstDay.split('-').reverse().join('/');
  const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const futureDay=tomorrow.toISOString().slice(0,10);
  await api('PUT','/api/custos-extras',{rede:'Super do Povo',transporte:'0',taxas:'0',outros:'0'});
  let serial=999007000;
  for(const [engine,name] of [[chromium,'Chromium'],[webkit,'WebKit']]) {
    const browser=await engine.launch({headless:true});
    try {for(const width of [1280,390,320]) {
      const person=`Presença recente ${name} ${width}`,cpf=cpfFor(++serial);
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(url+'#financeiro');await page.waitForFunction(()=>financeForecastInput!==null);await page.locator('#forecast-period').selectOption('day');await page.locator('#forecast-date').fill(firstDay);
      const amounts=async()=>Promise.all(['revenue','cost','profit'].map(async key=>Number((await page.locator('#confirmed-'+key).innerText()).replace(/\D/g,''))));
      const before=await amounts();
      await page.locator('#nav-leitura').click();
      await page.locator('#reading-text').fill(`Rede: Super do Povo\nLoja: Meireles\nFunção: Mercearia\nHorário: 13:40 às 22:00\nData de início: ${display.slice(0,5)}\nQuantidade de dias: 7\nNome: ${person}\nCPF: ${cpf}`);
      await page.locator('#reading-submit').click();await page.locator('#reading-confirm').click();await page.locator('#reading-result-items .reading-item.saved').waitFor();
      const worker=(await api('GET','/api/diaristas')).find(w=>w.cpf===cpf),scales=(await api('GET','/api/escalas')).filter(e=>e.diarista_id===worker.id);
      assert.equal(scales.length,7);assert.equal(scales[0].data,firstDay);
      await page.locator('#reading-result-items').getByRole('button',{name:'Ver pedido e escala',exact:true}).click();
      const present=page.getByRole('button',{name:`Presença de ${person} em ${display}`,exact:true});assert.equal(await present.isEnabled(),true);await present.click();
      await page.waitForFunction(id=>document.querySelector('#order-detail-shifts')?.textContent.includes('Pagamento pendente'),worker.id);
      assert.equal((await api('GET','/api/escalas')).find(e=>e.id===scales[0].id).status,'presente');
      assert.equal(await page.getByRole('button',{name:`Presença de ${person} em ${futureDay.split('-').reverse().join('/')}`,exact:true}).isEnabled(),false,'Não lança presença futura como realizada');
      await page.locator('#order-detail-close-bottom').click();await page.locator('#nav-financeiro').click();
      await page.waitForFunction(expected=>Number(document.querySelector('#confirmed-revenue').textContent.replace(/\D/g,''))===expected,before[0]+13400);
      const after=await amounts();assert.deepEqual(after.map((value,i)=>value-before[i]),[13400,9000,4400],'Presença atualiza faturamento, diária e lucro no dashboard');
      assert.match(await page.locator('#confirmed-extra-note').innerText(),/Média por diária:/);
      await page.waitForFunction(()=>activeRequests===0 && !orderDetailBusy);await page.waitForLoadState('networkidle');await page.reload();await page.waitForFunction(()=>financeForecastInput!==null);await page.locator('#forecast-period').selectOption('day');await page.locator('#forecast-date').fill(firstDay);assert.deepEqual(await amounts(),after,'Financeiro persiste após recarga');
      await page.waitForFunction(()=>activeRequests===0);await page.waitForLoadState('networkidle');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[]);
      await api('PATCH',`/api/pedidos/${scales[0].pedido_id}/escalas/${scales[0].id}`,{status:'escalada'});
      for(const scale of scales)await api('DELETE',`/api/pedidos/${scale.pedido_id}/escalas/${scale.id}`);
      await api('DELETE',`/api/pedidos/${scales[0].pedido_id}`);await api('DELETE',`/api/diaristas/${worker.id}`);
      console.log(`${name} ${width}: leitura de início recente, presença disponível, faturamento +134, custo +90, lucro +44, média e persistência OK`);await context.close();
    }}finally{await browser.close();}
  }
}

async function runAssistantFlow(){
  const api=async(method,route,body)=>{const response=await fetch(url.slice(0,-1)+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  let serial=720001;const cpfFor=n=>{let s=String(n).padStart(9,'0');for(const size of [9,10]){const sum=[...s].reduce((a,d,i)=>a+Number(d)*(size+1-i),0);const digit=(sum*10)%11;s+=digit===10?0:digit;}return s;};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const [engine,name]of [[chromium,'Chromium'],[webkit,'WebKit']]){
    const browser=await engine.launch({headless:true});try{for(const width of [1280,390,320]){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500}),page=await context.newPage(),errors=[],writes=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')writes.push(r.url());});
      const cpf=cpfFor(++serial),person=`Assistente Teste ${name} ${width===1280?'Desktop':width===390?'Celular':'Compacto'}`;
      await page.goto(url+'#leitura');
      const message=`Rede: Hipermarket\n*Região:* LOJA VILA UNIÃO\n*Função:* Repositor de mercearia\n*Horário:* 06:00 às 14:20\n*Data de início:* ${today.split('-').reverse().join('/')}\n*Quantidade de dias:* 2 dias\n\n*${person}*\nCPF: ${cpf}`;
      await page.locator('#reading-text').fill(message);await page.locator('#reading-submit').click();await page.locator('.reading-preview').waitFor().catch(async error=>{console.log('Diagnóstico assistente:',await page.locator('#reading-feedback').textContent(),errors);throw error;});
      assert.match(await page.locator('#reading-result-items').innerText(),/Vila União/);assert.equal(writes.length,0,'Interpretar não grava nem pendência');assert.equal((await api('GET','/api/diaristas')).filter(w=>w.cpf===cpf).length,0);
      assert.match(await page.locator('.reading-preview').innerText(),/Diarista ainda não cadastrado/);
      await page.locator('#reading-text').fill('Corrigir horário para 07:00 às 15:20');await page.locator('#reading-submit').click();await page.waitForFunction(()=>document.querySelector('.reading-preview')?.textContent.includes('07:00 às 15:20'));assert.equal(writes.length,0);
      await page.locator('#reading-cancel').click();assert.equal(writes.length,0,'Cancelar não altera dados');
      await page.locator('#reading-text').fill(message);await page.locator('#reading-submit').click();await page.locator('.reading-preview').waitFor();await page.locator('#reading-confirm').click();await page.locator('.reading-item.saved').waitFor();
      const worker=(await api('GET','/api/diaristas')).find(w=>w.cpf===cpf),scales=(await api('GET','/api/escalas')).filter(s=>s.diarista_id===worker.id);assert.equal(scales.length,2);assert.equal((await api('GET','/api/pedidos')).find(o=>o.id===scales[0].pedido_id).situacao,'confirmado');
      const send=async text=>{await page.locator('#reading-text').fill(text);await page.locator('#reading-submit').click();await page.locator('.reading-preview').waitFor();};
      const registrationWrites=writes.length,formattedCpf=cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
      await send(`Nome: Assistente Teste\nCPF: ${formattedCpf}`);
      assert.match(await page.locator('.reading-preview').innerText(),/Diarista já cadastrado/);
      assert.match(await page.locator('.reading-preview').innerText(),new RegExp(person));
      assert.doesNotMatch(await page.locator('.reading-preview').innerText(),/Cadastro parcial:/);
      assert.equal(writes.length,registrationWrites,'Consultar identidade não grava');
      await page.locator('#reading-confirm').click();await page.locator('.reading-item.duplicate').waitFor();
      assert.equal(writes.length,registrationWrites,'Confirmar cadastro existente não grava nem sobrescreve');
      assert.deepEqual((await api('GET','/api/diaristas')).find(w=>w.cpf===cpf),worker);
      const raceCpf=cpfFor(++serial);await send(`Nome: Cadastro recebido por link\nCPF: ${raceCpf}`);
      assert.match(await page.locator('.reading-preview').innerText(),/Diarista ainda não cadastrado/);
      const received=await api('POST','/api/diaristas',{nome:'Cadastro recebido por link completo',cpf:raceCpf,telefone:'85999998888',bairro:'Centro'});
      await page.locator('#reading-confirm').click();await page.locator('.reading-item.duplicate').waitFor();
      const matches=(await api('GET','/api/diaristas')).filter(w=>w.cpf===raceCpf);assert.equal(matches.length,1);assert.deepEqual(matches[0],received);
      assert.equal(writes.length,registrationWrites,'Cadastro recebido após leitura é consultado novamente antes de confirmar');
      await api('DELETE',`/api/diaristas/${received.id}`);
      if(name==='Chromium'&&width===1280){
        const concurrentCpf=cpfFor(++serial);let concurrent;
        await send(`Nome: Cadastro concorrente\nCPF: ${concurrentCpf}`);
        const intercept=async route=>{if(route.request().method()==='POST')concurrent=await api('POST','/api/diaristas',{nome:'Cadastro concorrente completo',cpf:concurrentCpf,bairro:'Centro'});await route.continue();};
        await page.route('**/api/diaristas',intercept);await page.locator('#reading-confirm').click();await page.locator('.reading-item.duplicate').waitFor();await page.unroute('**/api/diaristas',intercept);
        assert.deepEqual((await api('GET','/api/diaristas')).filter(w=>w.cpf===concurrentCpf),[concurrent]);
        assert.equal(writes.length,registrationWrites+1,'Conflito de CPF não cria cadastro duplicado nem pendência');await api('DELETE',`/api/diaristas/${concurrent.id}`);
      }
      const countBefore=writes.length;await send(`Marcar presença\nCPF: ${cpf}\nData: hoje\nPedido: ${scales[0].pedido_id}`);assert.equal(writes.length,countBefore);await page.locator('#reading-text').fill('está certo');await page.locator('#reading-submit').click();await page.locator('.reading-item.saved').waitFor();assert.equal((await api('GET','/api/escalas')).find(s=>s.id===scales[0].id).status,'presente');assert.equal((await api('GET',`/api/diaristas/${worker.id}/diarias`)).length,1);
      await send(`Marcar falta\nCPF: ${cpf}\nData: hoje\nPedido: ${scales[0].pedido_id}`);assert.equal(await page.locator('#reading-confirm').isEnabled(),false,'Falta sem motivo pede complemento');
      await page.locator('.reading-preview').getByRole('button',{name:'✎ Corrigir',exact:true}).click();await page.locator('#reading-text').fill(`Marcar falta\nCPF: ${cpf}\nData: hoje\nPedido: ${scales[0].pedido_id}\nMotivo: Correção controlada de teste`);await page.locator('#reading-submit').click();await page.locator('#reading-confirm').click();await page.locator('.reading-item.saved').waitFor();assert.equal((await api('GET',`/api/diaristas/${worker.id}/diarias`)).length,0,'Falta remove pagamento e faturamento de presença');
      await api('PATCH',`/api/pedidos/${scales[0].pedido_id}/escalas/${scales[0].id}`,{status:'escalada'});
      await send(`Confirmar que vai\nCPF: ${cpf}\nData: hoje\nPedido: ${scales[0].pedido_id}`);
      await api('PATCH',`/api/operacao/escalas/${scales[0].id}`,{acao:'confirmacao',confirmacao:'confirmou'});await page.locator('#reading-confirm').click();await page.locator('.reading-item.error').waitFor();assert.match(await page.locator('#reading-result-items').innerText(),/mudou depois da leitura/);
      await send(`Completar cadastro\nCPF: ${cpf}\nBairro: Meireles\nCEP: 60165-000`);const beforeUpdate=(await api('GET','/api/diaristas')).find(w=>w.id===worker.id);assert.equal(beforeUpdate.bairro,'');await page.locator('#reading-confirm').click();await page.locator('.reading-item.saved').waitFor();const updated=(await api('GET','/api/diaristas')).find(w=>w.id===worker.id);assert.equal(updated.bairro,'Meireles');assert.equal(updated.cpf,cpf);assert.deepEqual(updated.disponibilidade,[]);
      const queryWrites=writes.length;await page.locator('#reading-text').fill('Consultar financeiro de hoje');await page.locator('#reading-submit').click();await page.waitForFunction(()=>document.querySelector('#reading-result-items')?.textContent.includes('faturamento previsto'));assert.equal(writes.length,queryWrites,'Consulta não altera dados');
      await page.locator('#reading-text').fill('Apagar todos os pedidos');await page.locator('#reading-submit').click();await page.locator('.reading-preview').waitFor();assert.equal(await page.locator('#reading-confirm').isEnabled(),false,'Comando não suportado não é executado');
      assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
      const finalReplacement=name==='WebKit'&&width===320;
      if(finalReplacement){const substitute=await api('POST','/api/diaristas',{nome:'Substituto Assistente Teste',cpf:cpfFor(++serial)});await send(`Registrar desistência\nCPF: ${cpf}\nData: hoje\nPedido: ${scales[0].pedido_id}\nMotivo: Não pode comparecer hoje`);await page.locator('#reading-confirm').click();await page.locator('.reading-item.saved').waitFor();assert.equal((await api('GET','/api/escalas')).find(s=>s.id===scales[0].id).status,'desistiu');await send(`Substituir\nCPF: ${cpf}\nData: hoje\nPedido: ${scales[0].pedido_id}\nSubstituto: ${substitute.nome}\nMotivo: Não pode comparecer hoje`);assert.equal(await page.locator('#reading-confirm').isEnabled(),false);await page.getByText('Confirmei a disponibilidade do substituto',{exact:true}).click();await page.locator('#reading-confirm').click();await page.locator('.reading-item.saved').waitFor();assert.ok((await api('GET','/api/escalas')).some(s=>s.pedido_id===scales[0].pedido_id&&s.diarista_id===substitute.id));console.log('WebKit 320: desistência e substituição pelo assistente preservam histórico OK');}
      await page.waitForLoadState('networkidle');if(!finalReplacement){for(const scale of scales)await api('DELETE',`/api/pedidos/${scale.pedido_id}/escalas/${scale.id}`);await api('DELETE',`/api/pedidos/${scales[0].pedido_id}`);await api('DELETE',`/api/diaristas/${worker.id}`);}
      console.log(`${name} ${width}: assistente interpreta sem gravar, corrige, cancela, confirma, registra 2 escalas, presença/falta, conflito e consulta OK`);await context.close();
    }}finally{await browser.close();}
  }
}

async function runMessagesFlow() {
 const api=async(method,route,data)=>{const response=await fetch(url.slice(0,-1)+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
 const cpfFor=n=>{let v=String(n);for(const size of [9,10]){const sum=[...v].reduce((total,x,i)=>total+Number(x)*(size+1-i),0),digit=(sum*10)%11;v+=digit===10?'0':String(digit);}return v;};let serial=999008000;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);const tomorrow=d.toISOString().slice(0,10);
 for(const [engine,name]of [[chromium,'Chromium'],[webkit,'WebKit']]){const browser=await engine.launch();try{for(const width of [1280,390,320]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.messageCopies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.messageCopies.push(text);}}});});
  const person=await api('POST','/api/diaristas',{nome:`Mensagens Teste ${name} ${width}`,cpf:cpfFor(++serial),setores:['Repositor de FLV'],trabalhando:false,pode_se_deslocar:true,transporte:'Ônibus',disponibilidade:['segunda','terca','quarta','quinta','sexta','sabado','domingo'].map(dia=>({dia,inicio:'00:00',fim:'23:59'}))});
  const order=await api('POST','/api/pedidos',{supermercado:'Super do Povo',unidade:'Meireles',setor:'Repositor de FLV',quantidade_diaristas:1,turnos:[{data:today,inicio:'07:00',fim:'15:20'},{data:tomorrow,inicio:'07:00',fim:'15:20'}]});
  await api('POST',`/api/pedidos/${order.id}/escalas`,{diarista_id:person.id,data:today,disponibilidade_confirmada:true});
  await page.goto(url+'#pedidos');await page.waitForFunction(id=>orderRecords.some(o=>o.id===id),order.id);await page.evaluate(id=>openOrderDetail(id),order.id);await page.locator('#order-detail-shifts .order-worker-row').waitFor();await page.locator('#order-messages').click();await page.locator('#messages-dialog').waitFor({state:'visible',timeout:5000}).catch(async e=>{throw Error(`Mensagens: ${await page.locator('#order-detail-error').innerText()} | ${errors.join(';')} | ${e.message}`);});
  const text=await page.locator('#messages-preview').inputValue();assert.match(text,new RegExp(person.nome));assert.match(text,/Júlio Ibiapina/);assert.doesNotMatch(text,new RegExp(person.cpf));await page.locator('#messages-copy').click();assert.equal(await page.evaluate(()=>messageCopies.at(-1)),text);
  await page.locator('#messages-kind').selectOption('address');assert.match(await page.locator('#messages-preview').inputValue(),/\*Endereço:\*/);assert.equal(await page.locator('#messages-person-wrap').isVisible(),false);
  await page.locator('#messages-kind').selectOption('vacancy');assert.match(await page.locator('#messages-preview').inputValue(),new RegExp(tomorrow.split('-').reverse().join('/')));assert.doesNotMatch(await page.locator('#messages-preview').inputValue(),new RegExp(today.split('-').reverse().join('/')));
  await page.locator('#messages-preview').fill('Texto corrigido pela operação');await page.locator('#messages-copy').click();assert.equal(await page.evaluate(()=>messageCopies.at(-1)),'Texto corrigido pela operação');await page.locator('#messages-reset').click();assert.match(await page.locator('#messages-preview').inputValue(),/DIÁRIA DISPONÍVEL/);
  if(width===320){await page.evaluate(()=>navigator.clipboard.writeText=async()=>{throw Error('bloqueado');});await page.locator('#messages-copy').click();assert.match(await page.locator('#messages-feedback').innerText(),/copiar manualmente/);await page.evaluate(()=>navigator.clipboard.writeText=async text=>messageCopies.push(text));}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));if(width<500)assert.ok(await page.locator('#messages-preview').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
  await page.screenshot({path:path.join(root,`.design-qa/mensagens-${name}-${width}.png`),fullPage:true,animations:'disabled'});await page.locator('#messages-close').click();await page.locator('#order-detail-close').click();
  await page.locator('#nav-diaristas').click();await page.getByRole('button',{name:`Completar cadastro de ${person.nome}`,exact:true}).click();await page.locator('#form-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#nome').inputValue(),person.nome);await page.locator('#close-button').click();
  const scale=(await api('GET',`/api/pedidos/${order.id}/escalas`))[0];await api('PATCH',`/api/pedidos/${order.id}/escalas/${scale.id}`,{status:'presente'});
  await page.goto(url+'#financeiro');await page.locator('#finance-all-months').check();await page.locator('#finance-search').fill(person.nome);await page.getByRole('button',{name:`Ver 1 diária de ${person.nome}`,exact:true}).click();await page.locator('#finance-payment-message').click();await page.locator('#messages-dialog').waitFor({state:'visible'});assert.match(await page.locator('#messages-preview').inputValue(),/Total a pagar/);await page.locator('#messages-copy').click();assert.match(await page.evaluate(()=>messageCopies.at(-1)),/90,00/);
  await page.locator('#messages-close').click();await page.locator('#finance-group-close').click();await api('PATCH',`/api/pedidos/${order.id}/escalas/${scale.id}`,{status:'escalada'});await api('DELETE',`/api/pedidos/${order.id}/escalas/${scale.id}`);await api('DELETE',`/api/pedidos/${order.id}`);await api('DELETE',`/api/diaristas/${person.id}`);
  assert.deepEqual(errors,[],`${name} ${width}: mensagens sem erro JS`);console.log(`${name} ${width}: mensagem com equipe/endereço, vagas, correção/cópia, cadastro parcial e pagamento OK`);await context.close();
 }}finally{await browser.close();}}
}

try {
  await ready();
  if(process.env.DIRECT_READING_ONLY==='1'){await runReadingFlow();}
  else if(process.env.DIRECT_EXTENDED_ONLY==='1'){await runFinancialWorkflow();await runExtendedWorkflow();}
  else if(process.env.DIRECT_ASSIGNMENT_ONLY==='1'){await runAssignmentPersistence();}
  else if(process.env.DIRECT_RECENT_ONLY==='1'){await runRecentOrderAttendance();}
  else if(process.env.DIRECT_ROLES_ONLY==='1'){await runRoleNavigation();}
  else if(process.env.DIRECT_MESSAGES_ONLY==='1'){await runMessagesFlow();await runRoleNavigation();}
  else if(process.env.DIRECT_FINANCE_ONLY==='1'){await runFinancialWorkflow();}
  else if(process.env.DIRECT_CALENDAR_ONLY==='1'){await runPaymentCalendars();}
  else if(process.env.DIRECT_ASSISTANT_ONLY==='1'){await runAssistantFlow();}
  else if(process.env.DIRECT_REMAINING_ONLY==='1'){await runLinkedReading();await runOrderFilters();await runScaleLifecycle();await runRecentOrderAttendance();await runAssistantFlow();}
  else {
  await runMessagesFlow();
  await runBrowser(chromium, 'Chromium');
  await runBrowser(webkit, 'WebKit');
  await runRoleNavigation();
  if(process.env.DIRECT_REAL_OCR==='1')await runRealReading();
  await runReadingFlow();
  await runFinancialWorkflow();
  await runExtendedWorkflow();
  await runAssignmentPersistence();
  await runCRMWorkflow();
  await runPartialRegistration();
  await runPaymentCalendars();
  await runLinkedReading();
  await runOrderFilters();
  await runScaleLifecycle();
  await runRecentOrderAttendance();
  await runAssistantFlow();
  }
} finally {
  child.kill();
  await rm(work, { recursive: true, force: true });
}
