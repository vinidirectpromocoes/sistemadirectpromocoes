import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {chromium, webkit} from 'playwright';

const root=process.cwd(),work=await mkdtemp(path.join(os.tmpdir(),'direct-mobile-nav-'));
const output=path.join(root,'.design-qa','sidebar');await mkdir(output,{recursive:true});
const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const url='http://127.0.0.1:'+port;
const child=spawn(process.env.PYTHON||'python3',['server.py'],{
  cwd:root,env:{...process.env,DIARISTAS_DB_PATH:path.join(work,'test.db'),DIARISTAS_PORT:String(port)},stdio:'ignore'
});
const metrics=[];
const adminControls=page=>page.evaluate(()=>{
  document.getElementById('logout-button').hidden=false;
  document.getElementById('backup-health-alert').hidden=false;
});
const ready=page=>page.waitForFunction(()=>{
  const main=document.querySelector('main.main-content:not([hidden])');
  return main&&!main.hasAttribute('aria-busy');
});
const dimensions=page=>page.evaluate(()=>{
  const sidebar=document.querySelector('.sidebar'),nav=sidebar.querySelector('nav');
  return {height:sidebar.getBoundingClientRect().height,width:sidebar.getBoundingClientRect().width,
    viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,
    navHeight:nav.getBoundingClientRect().height,navWidth:nav.clientWidth,navContent:nav.scrollWidth};
});

try{
  let started=false;
  for(let i=0;i<80;i++){
    try{if((await fetch(url+'/api/lojas')).ok){started=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(started,'Servidor isolado disponível');
  for(const [engine,name] of [[chromium,'Chromium'],[webkit,'WebKit']]){
    const browser=await engine.launch();
    try{
      for(const [width,height,mobile] of [[390,844,true],[320,740,true],[844,390,true],[1280,900,false]]){
        const context=await browser.newContext({viewport:{width,height},hasTouch:mobile,isMobile:mobile,serviceWorkers:'block'});
        const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        let before=null;
        if(width===390){
          await page.route('**/mobile-navigation.css',route=>route.abort());
          await page.goto(url+'/#inicio');await ready(page);await adminControls(page);
          await page.locator('.mobile-nav-hint').evaluate(element=>element.remove());
          before=await dimensions(page);
          await page.screenshot({path:path.join(output,`before-${name}-${width}.png`)});
          await page.unroute('**/mobile-navigation.css');
        }
        await page.goto(url+'/#inicio');await ready(page);await adminControls(page);
        const after=await dimensions(page);
        metrics.push({browser:name,width,height,before,after});
        await page.screenshot({path:path.join(output,`after-${name}-${width}-initial.png`)});
        assert.ok(after.pageWidth<=width+2,`${name} ${width}: sem rolagem horizontal na página`);
        if(mobile){
          assert.ok(after.height<=(width===844?116:140),`${name} ${width}: cabeçalho compacto (${after.height}px)`);
          assert.ok(after.navHeight<=60,`${name} ${width}: atalhos em uma única linha`);
          assert.ok(after.navContent>after.navWidth,`${name} ${width}: todos os atalhos acessíveis por rolagem`);
          assert.equal(await page.locator('#enterprise-sidebar').isVisible(),false);
          if(before)assert.ok(before.height-after.height>=60,'Reduz pelo menos 60px do cabeçalho anterior');
          const ids=width===390
            ?['inicio','pedidos','diaristas','crm','financeiro','supervisor','redes','leitura','vagas','pedidos-links','convites','empresa','configuracoes']
            :['inicio','pedidos','diaristas','crm','financeiro','empresa','configuracoes'];
          for(const id of ids){
            await page.locator('#nav-'+id).click();await ready(page);
            assert.equal(await page.locator('#nav-'+id).getAttribute('aria-current'),'page');
            assert.equal(await page.locator('#'+id+'-page').isVisible(),true);
            assert.ok((await dimensions(page)).height<=140,'Trocar de página não expande o menu');
          }
          await page.locator('#nav-empresa').click();await ready(page);
          await page.locator('#enterprise-area-cards a').last().waitFor();
          assert.equal(await page.locator('#enterprise-area-cards a').count(),9,'Todas as áreas continuam na página da empresa');
          await page.locator('#enterprise-area-cards a[href="#empresa?area=financeiro"]').click();
          await page.getByLabel('Mudar área da empresa').waitFor();
          assert.equal(await page.getByLabel('Mudar área da empresa').inputValue(),'financeiro');
          assert.equal(await page.locator('#nav-empresa').getAttribute('aria-current'),'page','A seção Empresa continua identificada dentro das áreas');
          await page.locator('#global-search-button').click();
          await page.locator('#global-search-dialog').waitFor();
          await page.locator('#global-search-close').click();
          await page.locator('#nav-inicio').click();await ready(page);
          for(const id of ['global-search-button','theme-toggle','logout-button','backup-health-alert']){
            const box=await page.locator('#'+id).boundingBox();assert.ok(box&&box.width>=32&&box.height>=36,id+' acessível');
          }
        }else{
          assert.ok(after.width<=210&&after.height>=800,'Sidebar de desktop preservada');
          assert.equal(await page.locator('#enterprise-sidebar').isVisible(),true);
        }
        for(const theme of ['light','dark']){
          if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();
          assert.ok((await dimensions(page)).pageWidth<=width+2);
          await page.screenshot({path:path.join(output,`after-${name}-${width}-${theme}.png`)});
        }
        assert.deepEqual(errors,[]);
        console.log(`${name} ${width}x${height}: sidebar ${after.height}px, atalhos, áreas, busca e temas OK`);
        await context.close();
      }
    }finally{await browser.close();}
  }
}finally{
  await writeFile(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2));
  if(child.exitCode===null){child.kill();await once(child,'exit');}
  await rm(work,{recursive:true,force:true});
}
