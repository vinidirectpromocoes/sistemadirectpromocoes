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
        console.log('Backup no navegador → verificação → SQLite isolado OK');
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

try {
  await ready();
  await runBrowser(chromium, 'Chromium');
  await runBrowser(webkit, 'WebKit');
  await runRoleNavigation();
  await runReadingFlow();
} finally {
  child.kill();
  await rm(work, { recursive: true, force: true });
}
