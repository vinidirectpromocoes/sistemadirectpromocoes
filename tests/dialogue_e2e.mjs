import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import net from 'node:net';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {chromium,webkit} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(path.join(os.tmpdir(),'direct-dialogue-'));
const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
const url=`http://127.0.0.1:${port}`,child=spawn(process.env.PYTHON||'python3',['server.py'],{cwd:root,env:{...process.env,DIARISTAS_DB_PATH:path.join(work,'qa.db'),DIARISTAS_PORT:String(port)},stdio:['ignore','ignore','pipe']});let output='';child.stderr.on('data',c=>{output+=c;});
const api=async(method,route,data)=>{const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),json=await r.json();assert.ok(r.ok,JSON.stringify(json));return json;};
const cpfFor=n=>{let s=String(n).padStart(9,'0');for(const size of [9,10]){const digit=([...s].reduce((v,d,i)=>v+Number(d)*(size+1-i),0)*10)%11;s+=digit===10?0:digit;}return s;};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());let serial=820010;
try{
 for(let i=0;i<50;i++){try{await api('GET','/api/diaristas');break;}catch{if(i===49)throw Error(output);await new Promise(r=>setTimeout(r,100));}}
 for(const [engine,name]of [[chromium,'Chromium'],[webkit,'WebKit']]){
  const browser=await engine.launch({headless:true});try{for(const width of [1280,390,320]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500}),page=await context.newPage(),errors=[],writes=[],external=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith(url+'/api/')&&r.method()!=='GET')writes.push(r.url());if(!r.url().startsWith(url)&&/^https?:/.test(r.url()))external.push(r.url());});
   const first=`Dialogo${serial}`,worker=await api('POST','/api/diaristas',{nome:first+' Silva',cpf:cpfFor(++serial)}),other=await api('POST','/api/diaristas',{nome:first+' Santos',cpf:cpfFor(++serial)});
   const order=await api('POST','/api/pedidos',{supermercado:'Super Lagoa',unidade:'CD Super Lagoa',setor:'FLV',quantidade_diaristas:1,turnos:[{data:today,inicio:'07:00',fim:'15:20'}]});
   const [scale]=await api('POST',`/api/pedidos/${order.id}/escalas`,{diarista_id:worker.id,datas:[today],disponibilidade_confirmada:true});
   await page.goto(url+'/#leitura');await page.locator('#reading-submit').waitFor();
   const send=async text=>{await page.locator('#reading-text').fill(text);await page.locator('#reading-submit').click();await page.waitForFunction(()=>document.querySelector('#reading-text').value===''&&!document.querySelector('#reading-submit').disabled);assert.doesNotMatch(await page.locator('#reading-feedback').innerText(),/Não consegui interpretar/);};
   const confirm=async()=>{await page.locator('#reading-confirm').click();await page.locator('.reading-item.saved').waitFor();await page.waitForFunction(()=>!document.querySelector('#reading-submit').disabled);};
   const check=async()=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sem rolagem horizontal');};
   await send(`Marcar presença de ${first} hoje`);assert.equal(await page.locator('.reading-choice').count(),2);assert.equal(await page.locator('#reading-confirm').isEnabled(),false);assert.equal(writes.length,0);await check();
   await send(worker.cpf);assert.equal(await page.locator('#reading-confirm').isEnabled(),true);assert.equal(writes.length,0);await confirm();assert.equal((await api('GET','/api/escalas')).find(s=>s.id===scale.id).status,'presente');
   const [daily]=await api('GET',`/api/diaristas/${worker.id}/diarias`);
   let before=writes.length;await send(`Registrar pagamento\nCPF: ${worker.cpf}\nDiária: ${daily.id}`);assert.match(await page.locator('.reading-preview').innerText(),/valor correto|data o pagamento/);assert.equal(writes.length,before);
   await send('Valor: 100\nData do pagamento: hoje\nForma: Pix');assert.equal(await page.locator('#reading-confirm').isEnabled(),false,'Baixa requer conferência explícita');await page.locator('.reading-availability input').check();await check();await page.screenshot({path:`/tmp/direct-reading-dialogue-${name}-${width}.png`,fullPage:true});await confirm();assert.equal((await api('GET',`/api/diaristas/${worker.id}/diarias`))[0].valor_centavos,10000);
   before=writes.length;await send(`Consultar pagamentos\nCPF: ${worker.cpf}`);assert.match(await page.locator('#reading-chat').innerText(),/1 diária\(s\) paga/);assert.equal(writes.length,before);
   await send(`Reabrir pagamento\nCPF: ${worker.cpf}\nDiária: ${daily.id}`);await send('Pagamento informado por engano no teste');await page.locator('.reading-availability input').check();await confirm();assert.equal((await api('GET',`/api/diaristas/${worker.id}/diarias`))[0].data_pagamento,null);
   await send(`Marcar falta\nCPF: ${worker.cpf}\nData: hoje`);assert.equal(await page.locator('#reading-confirm').isEnabled(),false);await send('Avisou que estava doente');await confirm();assert.equal((await api('GET',`/api/diaristas/${worker.id}/diarias`)).length,0);
   await send(`Substituir\nCPF: ${worker.cpf}\nSubstituto: ${other.nome}\nData: hoje\nMotivo: Pessoa indisponível para trabalhar`);assert.equal(await page.locator('#reading-confirm').isEnabled(),false);await page.locator('.reading-availability input').check();await confirm();const replaced=(await api('GET','/api/escalas')).filter(s=>s.pedido_id===order.id);assert.equal(replaced.length,2);assert.ok(replaced.find(s=>s.id===scale.id).substituida_por_escala_id);
   await send(`Alterar cadastro\nCPF: ${other.cpf}\nTelefone: 85999990000`);await confirm();assert.equal((await api('GET','/api/diaristas')).find(w=>w.id===other.id).telefone,'85999990000');
   await send(`Bloquear cadastro\nCPF: ${other.cpf}`);let updated=(await api('GET','/api/diaristas')).find(w=>w.id===other.id);await api('PUT',`/api/diaristas/${other.id}`,{...updated,bairro:'Centro'});before=writes.length;await page.locator('#reading-confirm').click();await page.locator('.reading-item.error').waitFor();assert.match(await page.locator('.reading-item.error').innerText(),/mudou depois/);assert.equal(writes.length,before,'Registro alterado não é sobrescrito');
   await send(`Bloquear cadastro\nCPF: ${other.cpf}`);await confirm();assert.ok((await api('GET','/api/diaristas')).find(w=>w.id===other.id).bloqueada);await send(`Desbloquear cadastro\nCPF: ${other.cpf}`);await confirm();
   await send(`Remover escala\nCPF: ${other.cpf}\nPedido: ${order.id}\nData: hoje`);assert.equal(await page.locator('#reading-confirm').isEnabled(),false,'Substituição não pode ser apagada');await send('cancelar');assert.equal(await page.locator('#reading-result').isVisible(),false);
   const storeName='Loja Diálogo '+serial;await send(`Cadastrar loja\nRede: Super Lagoa\nLoja: ${storeName}`);await send('Av. Exemplo, 10');await send('Fortaleza');await confirm();const store=(await api('GET','/api/lojas')).find(s=>s.nome===storeName);assert.ok(store);
   await send(`Alterar loja\nRede: Super Lagoa\nLoja: ${storeName}\nOrientações: Apresentar-se à gerência`);await confirm();assert.equal((await api('GET','/api/lojas')).find(s=>s.id===store.id).orientacoes,'Apresentar-se à gerência');
   await send(`Alterar pedido ${order.id}\nObservações: Conferir recebimento da substituição`);await confirm();assert.match((await api('GET','/api/pedidos')).find(o=>o.id===order.id).observacoes,/Conferir/);
   await send('Excluir todos os diaristas');assert.equal(await page.locator('#reading-confirm').isEnabled(),false);assert.equal(await page.locator('.reading-preview .text-button').count(),0);
   before=writes.length;await send(`Alterar cadastro\nCPF: ${other.cpf}\nTelefone: 85999991111`);await page.evaluate(()=>window.dispatchEvent(new Event('direct:signed-out')));assert.equal(await page.locator('#reading-result').isVisible(),false);assert.equal(await page.locator('#reading-chat').innerText(),'');assert.equal(writes.length,before);
   if(width===1280){
    await page.evaluate(()=>{window.directRemote={role:'operacao',request:async(url,options={})=>{const r=await fetch(url,options),d=await r.json();if(!r.ok)throw Error(d.erro);return d;}};});
    const financeReads=[];page.on('request',r=>{if(r.url().endsWith('/api/financeiro'))financeReads.push(r.url());});
    await send(`Registrar pagamento\nCPF: ${worker.cpf}`);assert.match(await page.locator('.reading-preview').innerText(),/perfil não tem permissão/);assert.equal(financeReads.length,0);
    await page.evaluate(()=>{window.directRemote.role='financeiro';});await send(`Alterar cadastro\nCPF: ${other.cpf}\nTelefone: 85999992222`);assert.equal(await page.locator('#reading-confirm').isEnabled(),false);assert.match(await page.locator('.reading-preview').innerText(),/perfil não tem permissão/);
    await page.evaluate(()=>{window.directRemote.role='consulta';});await send(`Consultar cadastro\nCPF: ${other.cpf}`);assert.match(await page.locator('#reading-chat').innerText(),/perfil não tem permissão/);assert.equal(financeReads.length,0);
   }
   await check();assert.deepEqual(errors,[]);assert.deepEqual(external,[],'Conversa digitada não chama IA ou serviços externos');console.log(`${name} ${width}: perguntas, homônimos, baixa/reabertura, falta, substituição, correções, bloqueio, histórico, sessão e permissões OK`);await context.close();
  }}finally{await browser.close();}
 }
}finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(work,{recursive:true,force:true});}
