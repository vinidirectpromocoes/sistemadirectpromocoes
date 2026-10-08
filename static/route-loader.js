/* Optional modules load once, in dependency order. Failures can be retried. */
(()=>{
 const modules=new Map(),groups={leitura:['reading-parser','reading-assistant','reading-dialogue','reading'],configuracoes:['backup-model','backup','portal-admin'],convites:['portal-admin'],vagas:['vacancies-admin']};
 function script(name){if(modules.has(name))return modules.get(name);const pending=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/'+name+'.js';s.onload=resolve;s.onerror=()=>{modules.delete(name);s.remove();reject(Error('Não foi possível carregar esta função. Confira a conexão e tente novamente.'));};document.head.append(s);});modules.set(name,pending);return pending;}
 const pages=new Map();
 window.DirectPager={slice(key,items,target,render,size=25){
  const signature=items.map(x=>x.chave||x.id||x.kind+':'+x.diarista_id).join('|');let state=pages.get(key);
  if(!state||state.signature!==signature){state={signature,page:0};pages.set(key,state);}
  const count=Math.ceil(items.length/size);state.page=Math.min(state.page,Math.max(0,count-1));
  let nav=document.getElementById(key+'-pagination');if(!nav){nav=document.createElement('nav');nav.id=key+'-pagination';nav.className='list-pagination';nav.setAttribute('aria-label','Páginas da lista');target.after(nav);}nav.hidden=count<=1;nav.replaceChildren();
  if(count>1){const prev=document.createElement('button'),next=document.createElement('button'),info=document.createElement('span');prev.type=next.type='button';prev.className=next.className='button button-outline';prev.textContent='← Anterior';next.textContent='Próxima →';prev.disabled=state.page===0;next.disabled=state.page===count-1;info.textContent=(state.page*size+1)+'–'+Math.min((state.page+1)*size,items.length)+' de '+items.length;info.setAttribute('aria-live','polite');prev.onclick=()=>{state.page--;render();};next.onclick=()=>{state.page++;render();};nav.append(prev,info,next);}
  return items.slice(state.page*size,(state.page+1)*size);
 }};
 window.DirectModules={async ensure(page){for(const name of groups[page]||[])await script(name);}};
})();
