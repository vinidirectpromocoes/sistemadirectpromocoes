import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=http.createServer(async(req,res)=>{try{const file=path.join(root,'static',req.url.split('?')[0]);const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const cadastro='a'.repeat(64),vagas='b'.repeat(64),days=[1,2].map(n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10));
const jobs=[{id:1,rede:'Hipermarket',loja:'Vila União',setor:'FLV',endereco:'Endereço sintético de teste',valor_centavos:8500,turnos:days.map(data=>({data,inicio:'07:00',fim:'15:20',vagas:1}))}];
try{for(const [engine,name] of [[chromium,'Chromium'],[webkit,'WebKit']]){const browser=await engine.launch();try{for(const width of [1280,390,320]){
 const context=await browser.newContext({viewport:{width,height:850}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let logged=false,registered=false,accepted=false,signup=0,accepts=0,lists=0;
 const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'teste@example.invalid',email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{direct_convite:cadastro,direct_cadastro:{nome:'Pessoa sintética',cpf:'52998224725',setores:[]}}};
 const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString('base64url'),'synthetic'].join('.');
 await page.route('https://jxthqgtzybcyediyciqc.supabase.co/**',async route=>{const p=new URL(route.request().url()).pathname;const args=route.request().postDataJSON();let data;
 if(p.endsWith('/direct_portal_invite_status')){assert.equal(args.p_token,args.p_tipo==='cadastro'?cadastro:vagas);data=true;}
 else if(p.endsWith('/direct_portal_orders')){assert.equal(args.p_convite,vagas);lists++;data=accepted?[]:jobs;}
 else if(p.endsWith('/direct_portal_me'))data=registered?{status:'ativo',nome:'Pessoa sintética',escalas:[]}:{status:'sem_cadastro'};
 else if(p.endsWith('/direct_portal_register')){assert.equal(args.p_convite,cadastro);registered=true;data={status:'ativo',nome:'Pessoa sintética'};}
 else if(p.endsWith('/direct_portal_accept')){assert.ok(logged&&registered);assert.deepEqual(args,{p_pedido_id:1,p_convite:vagas});accepted=true;accepts++;data={dias:2,mensagem:'Escala confirmada.'};}
 else if(p==='/auth/v1/signup'){signup++;assert.equal(args.data.direct_cadastro.cpf,'52998224725');assert.equal(args.data.direct_convite,cadastro);data={...user,identities:[]};}
 else if(p==='/auth/v1/token'){logged=true;data={access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,user};}
 else if(p==='/auth/v1/logout'){logged=false;data={};}else if(p==='/auth/v1/user')data=user;else throw Error('Endpoint não previsto: '+p);
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(url+'/cadastro.html');await page.getByText('Acesso somente pelo link privado').waitFor();assert.ok(await page.locator('#registration-form').isHidden());assert.equal(signup,0);
 await page.goto(url+'/vagas.html');await page.getByText('Acesso somente pelo link privado').waitFor();assert.equal(lists,0);assert.equal(await page.locator('#jobs-list button').count(),0);
 await page.goto(url+'/cadastro.html#convite='+cadastro);await page.locator('[name=nome]').fill('Pessoa sintética');await page.locator('[name=cpf]').fill('11111111111');await page.locator('[name=email]').fill('teste@example.invalid');await page.locator('[name=senha]').fill('SyntheticTest123!');await page.locator('[name=confirmar]').fill('SyntheticTest123!');await page.locator('[name=consentimento]').check();await page.getByRole('button',{name:'Salvar meu cadastro'}).click();await page.getByText('Confira o CPF:').waitFor();assert.equal(signup,0);
 await page.locator('[name=cpf]').fill('52998224725');await page.locator('[name=confirmar]').fill('OutraSenha123!');await page.getByRole('button',{name:'Salvar meu cadastro'}).click();await page.getByText('As senhas precisam ser iguais.').waitFor();assert.equal(signup,0);
 await page.locator('[name=confirmar]').fill('SyntheticTest123!');await page.getByRole('button',{name:'Salvar meu cadastro'}).click();await page.getByText(/Enviamos a confirmação/).waitFor();assert.equal(signup,1);assert.equal(registered,false,'Sem confirmação de e-mail não grava');assert.equal(await page.locator('a[href="/vagas.html"]').count(),0);
 await page.goto(url+'/vagas.html#convite='+vagas);await page.getByRole('button',{name:'Quero pegar essa vaga'}).waitFor();assert.equal(await page.locator('#search,#refresh-button,#login-button,input[type=checkbox],nav,a[href="/cadastro.html"]').count(),0);assert.equal(await page.locator('.shift-choice').count(),2);
 await page.getByRole('button',{name:'Quero pegar essa vaga'}).click();await page.locator('#access-dialog').waitFor({state:'visible'});assert.equal(accepts,0);
 await page.locator('#access-email').fill('teste@example.invalid');await page.locator('#access-password').fill('SyntheticTest123!');await page.locator('#access-form button[type=submit]').click();await page.locator('#access-dialog').waitFor({state:'hidden'});await page.getByText(/precisa ter um cadastro ativo/).waitFor();assert.equal(registered,false,'Login isolado não cadastra por outro link');assert.equal(accepts,0);
 await page.goto(url+'/cadastro.html#convite='+cadastro);await page.getByText(/Seu cadastro está ativo/).waitFor();assert.ok(registered);
 await page.goto(url+'/vagas.html#convite='+vagas);await page.getByRole('button',{name:'Quero pegar essa vaga'}).click();await page.locator('#confirm-dialog').waitFor({state:'visible'});assert.ok((await page.locator('#confirm-summary').textContent()).includes('2 dia(s)'));assert.equal(accepts,0);await page.getByRole('button',{name:'Voltar',exact:true}).click();assert.equal(accepts,0);
 await page.getByRole('button',{name:'Quero pegar essa vaga'}).click();await page.getByRole('button',{name:'Confirmo que vou',exact:true}).click();await page.getByText(/Escala confirmada/).waitFor();assert.equal(accepts,1);await page.getByText('Nenhuma escala completa disponível no momento.').waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.ok(await page.locator('#access-email').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=16);assert.deepEqual(errors,[]);
 console.log(`${name} ${width}: convites separados, CPF/senha/e-mail, conta sem cadastro bloqueada, tela simples, revisão e escala completa OK`);await context.close();
 }}finally{await browser.close();}}}finally{server.close();}
