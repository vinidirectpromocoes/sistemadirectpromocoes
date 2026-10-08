import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mock=`window.portalTest={count:21,fail:false,copies:[],calls:[],delay:false,inviteDelay:false};
const worker={id:90001,nome:'Diarista sintética para conferência',cpf:'52998224725',setores:['FLV'],disponibilidade:[],bairro:'Centro',cidade:'Caucaia',uf:'CE',trabalhando:false,pode_se_deslocar:true,transporte:'Ônibus',bloqueada:false};
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{email:'qa@example.invalid'}}}}),onAuthStateChange:()=>{},signOut:async()=>({error:null})},
from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:table==='diaristas'?[worker]:[]}),maybeSingle:async()=>({data:table==='direct_admins'?{email:'qa@example.invalid'}:null}),then:r=>r({data:[]})};return q;},
rpc:async(name,args)=>{portalTest.calls.push({name,args});if(name==='direct_portal_vacancies')return{data:[]};if(name==='direct_portal_settings')return{data:{whatsapp:'',grupo_url:''}};
if(name==='direct_portal_create_invite'){if(portalTest.inviteDelay)await new Promise(r=>portalTest.finishInvite=r);return{data:{cadastro_token:'a'.repeat(64),vagas_token:'b'.repeat(64),expira_em:'2026-11-02T15:00:00Z'}};}
if(name==='direct_portal_registrations'){if(portalTest.delay)await new Promise(r=>setTimeout(r,200));if(portalTest.fail)return{error:{message:'Falha sintética'}};return{data:{total:portalTest.count,items:Array.from({length:Math.min(20,Math.max(0,portalTest.count-args.p_offset))},(_,i)=>({...worker,id:90001+args.p_offset+i,nome:i===0&&args.p_offset===0?worker.nome:'Cadastro sintético '+(args.p_offset+i+1),registrado_em:'2026-10-03T15:30:00Z'}))}};}return{data:[]};}})};`;
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){const browser=await engine.launch();try{for(const width of [1280,390,320]){
 const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'});
 // Serve os arquivos reais na origem HTTPS do teste sem uma segunda conexão HTTP.
 await context.route('https://direct.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname,file=path.join(root,'static',pathname==='/'?'index.html':pathname);
   let body;try{body=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;await route.fulfill({status:404,body:''});return;}
   await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'});
 });
 await context.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'application/javascript',body:mock}));
 await context.route('https://jxthqgtzybcyediyciqc.supabase.co/**',r=>r.abort());
 await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.portalTest.copies.push(text)}}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://direct.test/#convites');await page.locator('.portal-registration-row').first().waitFor();
 assert.equal(await page.locator('.portal-registration-row').count(),20);assert.equal(await page.locator('#portal-registration-count').textContent(),'21');
 await page.locator('#portal-registration-next').click();await page.getByText('Cadastro sintético 21',{exact:true}).waitFor();assert.equal(await page.locator('.portal-registration-row').count(),1);
 await page.locator('#portal-registration-prev').click();await page.locator('#portal-registration-list').getByText(workerName(),{exact:true}).waitFor();
 await page.getByRole('button',{name:'Ver cadastro de '+workerName(),exact:true}).click();await page.locator('#detail-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#detail-title').textContent(),workerName());await page.locator('#detail-close-button').click();
 await page.locator('#portal-invite-cpf').fill('529.982.247-25');await page.getByRole('button',{name:'Gerar convite',exact:true}).click();await page.locator('#portal-invite-links').waitFor({state:'visible'});
 await page.getByRole('button',{name:'Copiar cadastro',exact:true}).click();await page.getByRole('button',{name:'Copiar vagas',exact:true}).click();
 const copies=await page.evaluate(()=>portalTest.copies);assert.equal(new URL(copies[0]).pathname,'/cadastro.html');assert.equal(new URL(copies[1]).pathname,'/vagas.html');assert.notEqual(new URL(copies[0]).hash,new URL(copies[1]).hash);
 assert.equal(await page.evaluate(()=>portalTest.calls.find(c=>c.name==='direct_portal_create_invite').args.p_cpf),'52998224725');
 for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));if(width<700)assert.equal(await page.locator('#portal-invite-cpf').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),16);}
 // Atualizar limpa apenas o convite exibido; a pessoa continua na lista recebida.
 await page.locator('#portal-refresh').click();await page.waitForFunction(()=>!document.querySelector('#portal-refresh').disabled);
 async function assertInviteCleared(){
   assert.ok(await page.locator('#portal-invite-links').isHidden());
   for(const id of ['portal-invite-cpf','portal-cadastro-url','portal-vagas-url'])assert.equal(await page.locator('#'+id).inputValue(),'');
   for(const id of ['portal-invite-expiry','portal-admin-feedback'])assert.equal(await page.locator('#'+id).textContent(),'');
 }
 await assertInviteCleared();assert.equal(await page.locator('.portal-registration-row').count(),20);assert.equal(await page.locator('#portal-registration-count').textContent(),'21');
 await page.locator('#portal-registration-list').getByText(workerName(),{exact:true}).waitFor();
 // Resposta tardia de geração não pode restaurar os links depois de Atualizar.
 await page.evaluate(()=>{portalTest.inviteDelay=true});await page.locator('#portal-invite-cpf').fill('529.982.247-25');await page.getByRole('button',{name:'Gerar convite',exact:true}).click();await page.waitForFunction(()=>typeof portalTest.finishInvite==='function');
 await page.locator('#portal-refresh').click();await page.waitForFunction(()=>!document.querySelector('#portal-refresh').disabled);
 await page.evaluate(()=>{portalTest.inviteDelay=false;portalTest.finishInvite()});await page.waitForTimeout(100);await assertInviteCleared();
 // É possível gerar o próximo convite normalmente após a limpeza.
 await page.getByRole('button',{name:'Gerar convite',exact:true}).click();await page.locator('#portal-invite-links').waitFor({state:'visible'});assert.equal(await page.locator('#portal-invite-cpf').inputValue(),'');
 await page.evaluate(()=>{portalTest.count=0});await page.locator('#portal-refresh').click();await page.getByText('Nenhum cadastro recebido pelo link ainda.').waitFor();assert.equal(await page.locator('.portal-registration-row').count(),0);
 await page.evaluate(()=>{portalTest.fail=true});await page.locator('#portal-refresh').click();await page.getByText(/Não foi possível carregar os cadastros/).waitFor();assert.equal(await page.locator('#portal-registration-count').textContent(),'—');
 await page.evaluate(()=>{portalTest.fail=false;portalTest.count=1});await page.locator('#portal-refresh').click();await page.locator('.portal-registration-row').waitFor();
 await page.evaluate(()=>{portalTest.delay=true;document.querySelector('#portal-refresh').click();window.dispatchEvent(new Event('direct:signed-out'));});await page.waitForTimeout(300);assert.equal(await page.locator('.portal-registration-row').count(),0);assert.equal(await page.locator('#portal-cadastro-url').inputValue(),'');
 assert.deepEqual(errors,[]);console.log(name+' '+width+': origem, paginação, ficha, links, cópia, limpeza ao atualizar, resposta tardia, temas, erros e saída OK');await context.close();
 }}finally{await browser.close();}}
function workerName(){return 'Diarista sintética para conferência';}
