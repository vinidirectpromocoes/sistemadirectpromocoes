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
      const context = await browser.newContext({ acceptDownloads: true });
      await context.route(`https://direct.test:${port}/**`, async route => {
        const target = route.request().url().replace(`https://direct.test:${port}`, url.slice(0, -1));
        const response = await route.fetch({ url: target });
        await route.fulfill({ response });
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
          'import sys; sys.path.insert(0,"scripts"); from restore_backup import restore_operational; counts=restore_operational(sys.argv[1],sys.argv[2],sys.argv[3]); assert len(counts) == 16',
          archive, 'senha-de-teste-12345', operational], { cwd: root, encoding: 'utf8' });
        assert.equal(drill.status, 0, `Cópia operacional não restaurou: ${drill.stderr}`);
        console.log('Backup no navegador → verificação → SQLite operacional isolado OK');
      }
      console.log(`Perfil ${role}: navegação e ações visíveis OK`);
      await context.close();
    }
  } finally { await browser.close(); }
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
    await page.getByText('Resultado líquido estimado').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      'Financeiro com dados não deve criar rolagem horizontal no celular');
    assert.match(await page.locator('#forecast-net').innerText(), /78,00/);
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

try {
  await ready();
  await runBrowser(chromium, 'Chromium');
  await runBrowser(webkit, 'WebKit');
  await runRoleNavigation();
  await runReadingFlow();
  await runFinancialWorkflow();
} finally {
  child.kill();
  await rm(work, { recursive: true, force: true });
}
