import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import net from 'node:net';import os from 'node:os';import path from 'node:path';
import {chromium,webkit} from 'playwright';
const root=process.cwd(),work=await mkdtemp(path.join(os.tmpdir(),'direct-theme-')),output=path.join(root,'.design-qa/sidebar');await mkdir(output,{recursive:true});
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const url='http://127.0.0.1:'+port;
const child=spawn(process.env.PYTHON||'python3',['server.py'],{cwd:root,env:{...process.env,DIARISTAS_DB_PATH:path.join(work,'test.db'),DIARISTAS_PORT:String(port)},stdio:'ignore'}),metrics=[];
async function setTheme(page,theme){if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();await page.waitForFunction(t=>document.documentElement.dataset.theme===t&&document.documentElement.style.colorScheme===t,theme);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
try{
 for(let i=0;i<80;i++){try{if((await fetch(url+'/api/lojas')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const seed=spawnSync(process.env.PYTHON||'python3',['scripts/supervisor_ui_fixture.py',path.join(work,'test.db')],{cwd:root,encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);const fixture=JSON.parse(seed.stdout.trim());
 for(const [engine,name]of [[chromium,'Chromium'],[webkit,'WebKit']]){const browser=await engine.launch();try{for(const width of [390,320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,serviceWorkers:'block',acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let before=null;
  if(width<500){await page.route('**/direct-theme.css',r=>r.abort());await page.goto(url+'/#pedidos');await page.locator('#orders-rows tr').first().waitFor();before=await page.locator('.order-stats').evaluate(e=>e.getBoundingClientRect().height);await page.unroute('**/direct-theme.css');await page.reload();}
  else await page.goto(url+'/#pedidos');
  await page.locator('#orders-rows tr').first().waitFor();
  const geometry=await page.locator('.order-stats').evaluate(e=>({height:e.getBoundingClientRect().height,cards:[...e.children].map(c=>({height:c.getBoundingClientRect().height,bg:getComputedStyle(c).backgroundColor,tint:getComputedStyle(c).borderTopColor}))}));
  metrics.push({browser:name,width,before,after:geometry});
  if(width<500){assert.ok(geometry.height<before*.85,'Indicadores ocupam pelo menos 15% menos altura');assert.ok(geometry.cards.every(c=>c.height<=90),'Cards compactos sem altura excessiva');}
  assert.ok(new Set(geometry.cards.map(c=>c.tint)).size>=3,'Cores identificam os indicadores');
  for(const theme of ['light','dark']){await setTheme(page,theme);const channels=await page.locator('.order-legend').evaluate(e=>getComputedStyle(e).color.match(/[\d.]+/g).slice(0,3).map(Number));assert.ok(theme==='dark'?Math.min(...channels)>=150:Math.max(...channels)<=160,'Legenda legível no tema '+theme);await page.screenshot({path:path.join(output,`cards-${name}-${width}-${theme}.png`),animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));}
  await page.goto(url+'/#inicio');await page.locator('#home-day-panel').waitFor();await page.waitForFunction(()=>document.getElementById('home-day-present').textContent==='1');
  assert.equal(await page.locator('#home-day-date').inputValue(),fixture.day);assert.match(await page.locator('#home-day-list').innerText(),/Pessoa fictícia supervisor/);assert.match(await page.locator('#home-day-cities').innerText(),/Cidade não informada/);
  await page.locator('#home-day-status').selectOption('escalada');assert.equal(await page.locator('#home-day-csv').isDisabled(),true);assert.match(await page.locator('#home-day-list').innerText(),/Nenhuma escala/);
  await page.locator('#home-day-status').selectOption('presente');
  for(const [id,pattern]of [['home-day-csv',/Presença registrada/],['home-day-excel',/urn:schemas-microsoft-com:office:spreadsheet/],['home-day-print',/%PDF-1.4/]]){const pending=page.waitForEvent('download');await page.locator('#'+id).click();const file=await pending;assert.match(file.suggestedFilename(),new RegExp(fixture.day));assert.match(await readFile(await file.path(),'utf8'),pattern);}
  const originalFinance=await (await fetch(url+'/api/financeiro')).json();
  await page.locator('#home-day-date').fill('2020-01-01');await page.locator('#home-day-date').dispatchEvent('change');assert.equal(await page.locator('#home-day-present').innerText(),'0');assert.equal(await page.locator('#home-day-excel').isDisabled(),true);
  await page.locator('#home-day-date').fill(fixture.day);await page.locator('#home-day-date').dispatchEvent('change');
  for(const theme of ['light','dark']){await setTheme(page,theme);await page.locator('#home-day-panel').screenshot({path:path.join(output,`day-${name}-${width}-${theme}.png`),animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));}
  await page.locator('#home-day-list button').first().click();await page.locator('#order-detail-dialog').waitFor();assert.match(await page.locator('#order-detail-dialog').innerText(),/Pessoa fictícia supervisor/);await page.locator('#order-detail-close').click();
  assert.deepEqual(await (await fetch(url+'/api/financeiro')).json(),originalFinance,'Consulta e exportação não alteram o financeiro');
  await page.evaluate(()=>{window.directRemote={role:'consulta'};window.DirectHub.renderDay();});assert.equal(await page.locator('#home-day-panel').isVisible(),false);await page.evaluate(()=>window.dispatchEvent(new Event('direct:signed-out')));assert.equal(await page.locator('#home-day-list').innerText(),'');assert.deepEqual(errors,[]);
  console.log(`${name} ${width}: cards ${Math.round(before||geometry.height)}→${Math.round(geometry.height)}px; escala, filtros, CSV/Excel/PDF, pedido, perfil e temas OK`);await context.close();
 }}finally{await browser.close();}}
}finally{await writeFile(path.join(output,'cards-metrics.json'),JSON.stringify(metrics,null,2));child.kill();await new Promise(r=>child.once('exit',r));await rm(work,{recursive:true,force:true});}
