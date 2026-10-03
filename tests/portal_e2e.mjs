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
 const context=await browser.newContext({viewport:{width,height:850}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let registered=false,accepted=false,saves=0,accepts=0,lists=0,lastData;
 const ctx=()=>({cadastrado:registered,bloqueado:false,setores:['Operador de caixa','Repositor de FLV'],redes:['Hipermarket'],whatsapp:'',grupo_url:'',vagas_token:registered?vagas:null});
 await page.route('https://jxthqgtzybcyediyciqc.supabase.co/**',async route=>{const p=new URL(route.request().url()).pathname,args=route.request().postDataJSON();let data;
 if(p.endsWith('/direct_portal_context')){assert.equal(args.p_convite,args.p_tipo==='cadastro'?cadastro:vagas);data=ctx();}
 else if(p.endsWith('/direct_portal_orders')){assert.equal(args.p_convite,vagas);lists++;data=accepted?[]:jobs;}
 else if(p.endsWith('/direct_portal_submit')){assert.equal(args.p_convite,cadastro);lastData=args.p_dados;registered=true;saves++;data=ctx();}
 else if(p.endsWith('/direct_portal_take_order')){assert.ok(registered);assert.deepEqual(args,{p_pedido_id:1,p_convite:vagas,p_cpf:'52998224725'});accepted=true;accepts++;data={dias:2,mensagem:'Escala confirmada.'};}
 else throw Error('Endpoint não previsto (nenhuma conta permitida): '+p);
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.route('https://viacep.com.br/**',async route=>{const p=route.request().url();await route.fulfill({contentType:'application/json',body:JSON.stringify(p.includes('00000000')?{erro:true}:{logradouro:'Rua sintética',bairro:'Centro',localidade:'Caucaia',uf:'CE'})});});
 await page.goto(url+'/cadastro.html');await page.getByText('Acesso somente pelo link privado').waitFor();assert.ok(await page.locator('#registration-form').isHidden());assert.equal(saves,0);
 await page.goto(url+'/vagas.html');await page.getByText('Acesso somente pelo link privado').waitFor();assert.equal(lists,0);
 await page.goto(url+'/vagas.html#convite='+vagas);await page.getByRole('button',{name:'Quero pegar essa vaga'}).click({timeout:6000}).catch(async e=>{console.log(await page.locator('body').innerText(),errors);throw e;});await page.getByText(/precisa estar cadastrado e liberado/).waitFor();assert.equal(accepts,0);
 assert.equal(await page.locator('input[type=password],input[type=email],#search,#refresh-button,nav,input[type=checkbox]').count(),0);
 await page.goto(url+'/cadastro.html#convite='+cadastro);await page.locator('#registration-form').waitFor({state:'visible'});assert.equal(await page.locator('input[type=password],input[type=email],#login-button').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.ok(await page.locator('[name=nome]').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=16);
 await page.locator('[name=nome]').fill('Pessoa sintética');await page.locator('[name=cpf]').fill('11111111111');await page.locator('[name=data_nascimento]').fill('1990-04-10');
 await page.locator('[name=cep]').fill('00000000');await page.locator('[name=numero]').fill('12');await page.getByText('Não foi possível consultar este CEP.').waitFor();assert.equal(await page.locator('[name=cidade]').getAttribute('readonly'),null);
 await page.locator('[name=cep]').fill('61600000');await page.getByText('Endereço encontrado.').waitFor();assert.equal(await page.locator('[name=cidade]').inputValue(),'Caucaia');assert.ok(await page.locator('[name=cidade]').evaluate(e=>e.readOnly));
 await page.locator('[name=setores]').first().check();await page.locator('[name=setores]').last().check();await page.locator('[name=dias]').first().check();await page.locator('[name=dias]').last().check();
 await page.locator('[name=pode_se_deslocar]').selectOption('false');await page.locator('[name=observacoes_locomocao]').fill('Centro e proximidades');await page.locator('[name=transportes]').first().check();await page.locator('[name=transportes]').last().check();
 await page.locator('[name=trabalhando]').selectOption('true');await page.locator('[name=rede_trabalho]').selectOption('Outra');await page.locator('[name=local_trabalho]').fill('Empresa sintética');await page.locator('[name=consentimento]').check();
 await page.getByRole('button',{name:'CADASTRAR',exact:true}).click();await page.getByText('Confira o CPF:').waitFor();assert.equal(saves,0);
 await page.locator('[name=cpf]').fill('52998224725');await page.locator('[name=horario_tipo]').selectOption('especifico');await page.locator('[name=inicio]').fill('15:00');await page.locator('[name=fim]').fill('07:00');await page.getByRole('button',{name:'CADASTRAR',exact:true}).click();await page.getByText('O horário final deve ser depois do inicial.').waitFor();assert.equal(saves,0);
 await page.locator('[name=horario_tipo]').selectOption('turno');await page.locator('[name=turno]').selectOption('06:00/18:00');await page.getByRole('button',{name:'CADASTRAR',exact:true}).click();await page.getByRole('heading',{name:'Cadastro concluído!'}).waitFor();assert.equal(saves,1);assert.equal(lastData.cidade,'Caucaia');assert.equal(lastData.data_nascimento,'1990-04-10');assert.equal(lastData.trabalhando,true);assert.equal(lastData.pode_se_deslocar,false);assert.equal(lastData.transporte,'Ônibus, Uber');assert.equal(lastData.setores.length,2);assert.equal(lastData.disponibilidade.length,2);assert.equal(lastData.disponibilidade[0].fim,'18:00');assert.equal(lastData.consentimento,true);
 assert.equal(await page.locator('#registered a[aria-disabled=true]').count(),2);await page.getByRole('link',{name:'Ver diárias disponíveis',exact:true}).click();
 await page.getByRole('button',{name:'Quero pegar essa vaga'}).click();await page.locator('#confirm-dialog').waitFor({state:'visible'});assert.ok((await page.locator('#confirm-summary').textContent()).includes('2 dia(s)'));assert.equal(accepts,0);
 await page.getByRole('button',{name:'Confirmo que vou',exact:true}).click();await page.getByText('Confira seu CPF.').waitFor();assert.equal(accepts,0);await page.locator('#confirm-cpf').fill('52998224725');await page.getByRole('button',{name:'Voltar',exact:true}).click();assert.equal(accepts,0);
 await page.getByRole('button',{name:'Quero pegar essa vaga'}).click();await page.locator('#confirm-cpf').fill('52998224725');await page.getByRole('button',{name:'Confirmo que vou',exact:true}).click();await page.getByText('Escala confirmada.').waitFor();assert.equal(accepts,1);await page.getByText('Nenhuma escala completa disponível no momento.').waitFor();
 await page.goto(url+'/cadastro.html#convite='+cadastro);await page.getByRole('heading',{name:'Cadastro concluído!'}).waitFor();assert.equal(saves,1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 assert.deepEqual(errors,[]);console.log(`${name} ${width}: cadastro sem conta, CEP/fallback, campos, conclusão e escala completa OK`);await context.close();
 }}finally{await browser.close();}}}finally{server.close();}
