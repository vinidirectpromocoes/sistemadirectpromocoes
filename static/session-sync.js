/* Refresh visible data across employees, without broadcasting personal data. */
(()=>{
 let revision=null,running=false,timer;const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('direct-data'):null;
 function refresh(){clearRequestCache();window.dispatchEvent(new Event('direct:remote-changed'));if(document.hidden)return;showPage();}
 channel?.addEventListener('message',()=>refresh());
 window.addEventListener('direct:data-changed',()=>channel?.postMessage('changed'));
 async function poll(){if(running||document.hidden||!window.directRemote?.role)return;running=true;try{const next=await window.directRemote.revision();if(revision!==null&&next!==revision)refresh();revision=next;}catch{/* Keep current data while offline. Retry on next poll. */}finally{running=false;}}
 window.addEventListener('direct:authorized',()=>{revision=null;poll();clearInterval(timer);timer=setInterval(poll,20000);});
 window.addEventListener('direct:signed-out',()=>{clearInterval(timer);revision=null;});
 window.addEventListener('focus',()=>{clearRequestCache();poll();});document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearRequestCache();poll();}});
})();
