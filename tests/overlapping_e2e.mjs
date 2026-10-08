import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {chromium,webkit} from 'playwright';
const folder=await mkdtemp(path.join(os.tmpdir(),'direct-overlap-')),socket=net.createServer();
await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const url='http://127.0.0.1:'+port,child=spawn(process.env.PYTHON||'python3',['server.py'],{env:{...process.env,DIARISTAS_DB_PATH:path.join(folder,'test.db'),DIARISTAS_PORT:String(port)},stdio:'ignore'});
const api=async(method,route,body)=>{const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
try {
 for(let i=0;i<80;i++){try{await api('GET','/api/lojas');break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const [engine,name] of [[chromium,'Chromium'],[webkit,'WebKit']]) for(const width of [1280,390,320]) {
  const browser=await engine.launch(),context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/#leitura');
  for(const time of ['13:40 as 22:00','07:00 as 15:20']) {
   const message=`Rede: Super do Povo\nLoja: Meireles\nFunção: Balcao de Frios\nHorário: ${time}\nData de inicio: 06/10/2026 a 12/10/2026\nQuantidade de dias: 7\nNome: Paulo Roberto Porfirio\nCPF: 64865592334`;
   await page.locator('#reading-text').fill(message);await page.locator('#reading-submit').click();await page.locator('.reading-preview').waitFor();
   await page.locator('#reading-confirm').click();await page.locator('#reading-result-items .reading-item.saved').waitFor();
  }
  const workers=await api('GET','/api/diaristas');assert.equal(workers.length,1);const worker=workers[0];assert.equal(worker.cpf,'64865592334');
  let orders=await api('GET','/api/pedidos'),scales=await api('GET','/api/escalas');assert.equal(orders.length,2);assert.equal(scales.length,14);assert.ok(orders.every(o=>o.situacao==='confirmado'));assert.ok(scales.every(s=>s.diarista_id===worker.id));
  const third=await api('POST','/api/pedidos',{supermercado:'Super do Povo',unidade:'Meireles',setor:'frios ( dois)',quantidade_diaristas:1,turnos:orders[0].turnos});
  await page.locator('#nav-pedidos').click();await page.evaluate(id=>openOrderDetail(id),third.id);
  await page.getByLabel('Escolher diarista para 06/10/2026',{exact:true}).selectOption(String(worker.id));await page.getByRole('button',{name:'Todos os dias possíveis (7)',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#order-detail-success')?.textContent.includes('7 dias'));
  const beforeEdit=await api('GET',`/api/pedidos/${third.id}/escalas`);assert.equal(beforeEdit.length,7);
  await page.locator('#order-edit-button').click();await page.locator('#order-sector').fill('Balconista de frios');await page.locator('#order-save-button').click();await page.locator('#order-dialog').waitFor({state:'hidden'});
  const corrected=(await api('GET','/api/pedidos')).find(o=>o.id===third.id);assert.equal(corrected.setor,'Balconista de frios');assert.deepEqual(corrected.turnos,third.turnos);assert.deepEqual(await api('GET',`/api/pedidos/${third.id}/escalas`),beforeEdit);
  await page.waitForLoadState('networkidle');await page.waitForFunction(()=>activeRequests===0);await page.reload();await page.evaluate(id=>openOrderDetail(id),third.id);await page.waitForFunction(()=>document.querySelectorAll('#order-detail-shifts [data-scale-id]').length===7);
  assert.equal((await api('GET','/api/escalas')).length,21);assert.equal((await api('GET','/api/financeiro')).length,0);
  const expected=async()=>page.evaluate(async()=>{const orders=await request('/api/pedidos'),scales=await request('/api/escalas'),tariffs=await request('/api/tarifas'),byOrder={};for(const s of scales)(byOrder[s.pedido_id]||=[]).push(s);return DirectForecast.calculate(orders,byOrder,tariffs,'').expected;});
  const forecastBefore=await expected();page.once('dialog',dialog=>dialog.dismiss());await page.locator('#order-delete-button').click();assert.equal((await api('GET','/api/pedidos')).length,3);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#order-delete-button').click();await page.locator('#order-detail-dialog').waitFor({state:'hidden'});
  assert.equal((await api('GET','/api/pedidos')).length,2);assert.equal((await api('GET','/api/escalas')).length,14);assert.equal((await api('GET','/api/diaristas')).length,1);
  const forecastAfter=await expected();assert.equal(forecastBefore.revenue-forecastAfter.revenue,7*13400);assert.equal(forecastBefore.cost-forecastAfter.cost,7*9000);assert.equal(forecastBefore.net-forecastAfter.net,7*4400);
  await page.waitForFunction(()=>!document.querySelector('#order-delete-button').disabled && activeRequests===0);await page.waitForLoadState('networkidle');await page.reload();await page.waitForLoadState('networkidle');assert.equal((await api('GET','/api/pedidos')).length,2);assert.equal((await api('GET','/api/escalas')).length,14);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[]);
  await browser.close();
  for(const s of await api('GET','/api/escalas'))await api('DELETE',`/api/pedidos/${s.pedido_id}/escalas/${s.id}`);
  for(const o of await api('GET','/api/pedidos'))await api('DELETE',`/api/pedidos/${o.id}`);
  await api('DELETE',`/api/diaristas/${worker.id}`);
  console.log(`${name} ${width}: edição preserva 7 escalas; cancelar/excluir pelo botão, cadastro e outro pedido preservados; previsão -938/-630/-308 e recarga OK`);
 }
} finally {child.kill();await rm(folder,{recursive:true,force:true});}
