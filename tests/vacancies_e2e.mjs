import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=http.createServer(async(req,res)=>{try{const file=path.join(root,'static',req.url==='/'?'/index.html':req.url.split('?')[0]);const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const local=`http://127.0.0.1:${server.address().port}`;
const mock=`const shifts=[{data:'2026-12-10',inicio:'07:00',fim:'15:20',vagas:1},{data:'2026-12-11',inicio:'07:00',fim:'15:20',vagas:1}];
const order={id:70001,supermercado:'Hipermarket',unidade:'Vila União',setor:'FLV',situacao:'novo',turnos:shifts,quantidade_diaristas:1,quantidade_dias:2,total_diarias:2,contato:'',observacoes:'',criado_em:'2026-10-03T15:00:00Z'};
const worker={id:90001,nome:'Diarista sintético',cpf:'52998224725',setores:['FLV'],disponibilidade:[],bairro:'Centro',cidade:'Caucaia',uf:'CE',trabalhando:false,pode_se_deslocar:true,transporte:'Ônibus',bloqueada:false};
window.vacancyTest={orders:[{id:order.id,rede:order.supermercado,loja:order.unidade,setor:order.setor,turnos:shifts}],copies:[],calls:[],fail:false};
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{email:'qa@example.invalid'}}}}),onAuthStateChange:()=>{},signOut:async()=>({error:null})},
from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:table==='diaristas'?[worker]:table==='pedidos'?[order]:[]}),maybeSingle:async()=>({data:table==='direct_admins'?{email:'qa@example.invalid'}:null}),then:r=>r({data:[]})};return q;},
rpc:async(name,args)=>{vacancyTest.calls.push({name,args});if(name==='direct_portal_vacancies')return vacancyTest.fail?{error:{message:'Falha sintética'}}:{data:vacancyTest.orders};
if(name==='direct_portal_vacancies_invite'){if(args.p_diarista_id!==90001)throw Error('Diarista não vinculado');return{data:{vagas_token:'b'.repeat(64),cadastro_token:'a'.repeat(64),expira_em:'2026-11-02T15:00:00Z'}};}
return{data:name==='direct_portal_registrations'?{total:0,items:[]}:{whatsapp:'',grupo_url:''}};}})};`;
try{for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){const browser=await engine.launch();try{for(const width of [1280,390,320]){
 const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'});
 await context.route('https://direct.test/**',async route=>{const response=await route.fetch({url:route.request().url().replace('https://direct.test',local)});await route.fulfill({response});});
 await context.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'application/javascript',body:mock}));
 await context.route('https://jxthqgtzybcyediyciqc.supabase.co/**',r=>r.abort());
 await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>vacancyTest.copies.push(text)}}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
 await page.goto('https://direct.test/#vagas');await page.locator('#vacancy-list .portal-registration-row').waitFor();assert.equal(await page.locator('#vacancy-count').textContent(),'1');
 await page.getByRole('button',{name:'Ver pedido Hipermarket Vila União FLV',exact:true}).click();await page.locator('#order-detail-dialog').waitFor({state:'visible'});await page.locator('#order-detail-close').click();
 await page.getByText('Enviar link privado de vagas',{exact:true}).click();await page.locator('#vacancy-worker').selectOption('90001');await page.getByRole('button',{name:'Gerar link de vagas',exact:true}).click();await page.locator('#vacancy-share-result').waitFor({state:'visible'});await page.getByRole('button',{name:'Copiar link das vagas',exact:true}).click();
 assert.equal(new URL(await page.evaluate(()=>vacancyTest.copies[0])).pathname,'/vagas.html');assert.equal(await page.locator('#vacancy-share-form input[type=password],#vacancy-share-form input[type=email]').count(),0);
 const originals=await page.evaluate(()=>vacancyTest.orders);
 await page.evaluate(()=>{vacancyTest.orders=[];window.dispatchEvent(new Event('direct:data-changed'));});await page.getByText('Nenhuma escala completa disponível. Cadastre um pedido na Leitura IA ou na aba Pedidos.').waitFor();assert.ok(await page.evaluate(()=>orderRecords.some(o=>o.id===70001)));
 await page.evaluate(o=>{vacancyTest.orders=o},originals);await page.clock.fastForward(15001);await page.locator('#vacancy-list .portal-registration-row').waitFor();
 await page.evaluate(()=>{vacancyTest.orders=[];window.dispatchEvent(new Event('focus'));});await page.getByText('Nenhuma escala completa disponível. Cadastre um pedido na Leitura IA ou na aba Pedidos.').waitFor();
 for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));}
 await page.evaluate(()=>{vacancyTest.fail=true});await page.locator('#vacancy-refresh').click();await page.getByText(/Não foi possível carregar as vagas/).waitFor();assert.equal(await page.locator('#vacancy-count').textContent(),'—');
 await page.evaluate(()=>window.dispatchEvent(new Event('direct:signed-out')));assert.equal(await page.locator('#vacancy-share-url').inputValue(),'');assert.equal(await page.locator('#vacancy-list .portal-registration-row').count(),0);
 assert.deepEqual(errors,[]);console.log(name+' '+width+': plataforma, pedido preservado, escala inteira, convite vinculado, cópia, atualização automática e temas OK');await context.close();
 }}finally{await browser.close();}}}finally{server.close();}
