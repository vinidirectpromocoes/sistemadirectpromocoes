import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import net from 'node:net';import os from 'node:os';import path from 'node:path';import {chromium,webkit} from 'playwright';
const root=process.cwd(),work=await mkdtemp(path.join(os.tmpdir(),'direct-automation-')),socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const url='http://127.0.0.1:'+port;
const child=spawn(process.env.PYTHON||'python3',['server.py'],{cwd:root,env:{...process.env,DIARISTAS_DB_PATH:path.join(work,'test.db'),DIARISTAS_PORT:String(port)},stdio:'ignore'});
const api=async(method,route,body)=>{const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.ok(r.ok,route+':'+JSON.stringify(d));return d;};
try{
 for(let i=0;i<80;i++){try{await api('GET','/api/lojas');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const stores=await api('GET','/api/lojas'),store=stores.find(s=>s.rede==='Super do Povo'&&s.nome==='Meireles');assert.ok(store);
 await api('PUT','/api/lojas/'+store.id,{...store,entrada:'Porta lateral de teste',responsavel:'Gerente de teste',uniforme:'Camisa azul',orientacoes:'FLV: procurar encarregado de teste'});
 const worker=await api('POST','/api/diaristas',{nome:'Diarista Automação Teste',cpf:'52998224725',setores:['Repositor de FLV'],pode_se_deslocar:true,trabalhando:false,disponibilidade:['segunda','terca','quarta','quinta','sexta','sabado','domingo'].map(dia=>({dia,inicio:'00:00',fim:'23:59'}))});
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);const tomorrow=next.toISOString().slice(0,10);
 const order=await api('POST','/api/pedidos',{supermercado:'Super do Povo',unidade:'Meireles',setor:'Repositor de FLV',quantidade_diaristas:1,situacao:'novo',turnos:[{data:date,inicio:'07:00',fim:'15:20'},{data:tomorrow,inicio:'07:00',fim:'15:20'}]});
 for(const [engine,name]of [[chromium,'Chromium'],[webkit,'WebKit']]){
 const browser=await engine.launch();try{for(const width of [1280,390,320]){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/#pedidos');await page.locator('#new-order-button').waitFor();
 await page.evaluate(id=>openOrderDetail(id),order.id);await page.locator('#order-suggestions').waitFor();await page.locator('#order-suggestions>summary').click();await page.locator('#order-suggestions-list').getByText(worker.nome,{exact:true}).waitFor();
 assert.match(await page.locator('#order-suggestions-list').innerText(),/todos os 2 dias/);
 await page.locator('#order-detail-fields').getByText('Orientações da loja',{exact:true}).click();assert.match(await page.locator('#order-detail-fields').innerText(),/Porta lateral de teste/);
 if(width===1280&&name==='Chromium'){
 page.once('dialog',d=>d.accept());await page.locator('#order-suggestions-list').getByRole('button',{name:'Escalar 2 dias'}).click();await page.waitForFunction(()=>document.querySelector('#order-detail-success').hidden===false||!document.querySelector('#order-detail-error').hidden);assert.equal(await page.locator('#order-detail-error').isVisible(),false,await page.locator('#order-detail-error').innerText());
 const s=await api('GET','/api/pedidos/'+order.id+'/escalas');assert.equal(s.length,2);await page.reload();await page.evaluate(id=>openOrderDetail(id),order.id);await page.locator('#order-detail-shifts').getByText('Diarista Automação Teste',{exact:true}).first().waitFor();
 // Reset this test-only assignment to verify subsequent screen sizes.
 for(const row of s)await api('DELETE','/api/pedidos/'+order.id+'/escalas/'+row.id);
 }
 await page.locator('#order-detail-close').click();await page.locator('#new-order-button').click();
 await page.locator('#order-market').fill('Super do Povo');await page.locator('#order-unit').fill('Meireles');await page.locator('#order-sector').fill('Repositor de FLV');
 page.once('dialog',d=>d.accept('Modelo '+name+' '+width));await page.locator('#order-save-model').click();await page.locator('#order-model-feedback').waitFor();
 await page.locator('#order-close-button').click();await page.locator('#order-models-button').click();await page.locator('#order-model-list').getByText('Modelo '+name+' '+width,{exact:true}).waitFor();
 await page.locator('#order-model-start').fill('');await page.locator('#order-model-list .automation-row').filter({hasText:'Modelo '+name+' '+width}).getByRole('button',{name:'Usar modelo'}).click();await page.locator('#order-model-error').waitFor();assert.match(await page.locator('#order-model-error').innerText(),/data de início válida/);await page.locator('#order-model-start').fill('2030-12-31');await page.locator('#order-model-list .automation-row').filter({hasText:'Modelo '+name+' '+width}).getByRole('button',{name:'Usar modelo'}).click();
 assert.equal(await page.locator('.order-shift-date').first().inputValue(),'2030-12-31');assert.equal((await api('GET','/api/pedidos')).length,1,'Rascunho não publica pedido');
 const over=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(over<=2,name+' '+width+' overflow '+over);
 if(width<500)assert.ok(await page.evaluate(()=>[...document.querySelectorAll('input,textarea,select')].filter(x=>x.getClientRects().length&&!['checkbox','radio'].includes(x.type)).every(x=>parseFloat(getComputedStyle(x).fontSize)>=16)));
 await page.locator('#order-close-button').click();await page.locator('#order-models-button').click();await page.locator('#order-model-list').getByText('Modelo '+name+' '+width,{exact:true}).waitFor();page.once('dialog',d=>d.accept());await page.locator('#order-model-list .automation-row').filter({hasText:'Modelo '+name+' '+width}).getByRole('button',{name:'Excluir'}).click();await page.locator('#order-model-list').getByText('Modelo '+name+' '+width,{exact:true}).waitFor({state:'detached'});await page.locator('#order-model-close').click();await page.locator('#nav-crm').click();await page.locator('#deadline-alerts').waitFor();await page.locator('#deadline-alerts>summary').click();assert.match(await page.locator('#deadline-alerts').innerText(),/vaga\(s\) sem diarista/);assert.deepEqual(errors,[]);console.log(name+' '+width+': sugestões, persistência, orientações, modelos, prazos e layout OK');await page.close();
 }}finally{await browser.close();}}
}finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(work,{recursive:true,force:true});}
