(() => {
  const get=id=>document.getElementById(id);let context=null,sequence=0;
  const dialog=get('messages-dialog'),preview=get('messages-preview'),feedback=get('messages-feedback');
  function generate(){get('messages-person-wrap').hidden=!!context?.payment||['team','address','vacancy','replacement'].includes(get('messages-kind').value);feedback.hidden=true;try{preview.value=context.payment?DirectMessagesModel.payment(context.payment):DirectMessagesModel.compose(get('messages-kind').value,{...context,personId:get('messages-person').value||null,today:homeToday(),time:new Intl.DateTimeFormat('en-GB',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date())});get('messages-copy').disabled=false;}catch(e){preview.value='';feedback.textContent=e.message;feedback.hidden=false;get('messages-copy').disabled=true;}}
  function show(){get('messages-person-wrap').hidden=!!context.payment;get('messages-kind-wrap').hidden=!!context.payment;get('messages-title').textContent=context.payment?'Resumo de pagamento':`Mensagens · Pedido #${context.order.id}`;generate();if(!dialog.open)dialog.showModal();}
  async function order(id,kind='team',personId=null){
    const current=++sequence;
    const [orders,scales,stores]=await Promise.all([request('/api/pedidos'),request(`/api/pedidos/${id}/escalas`),request('/api/lojas')]);
    if(current!==sequence)return;const selected=orders.find(o=>o.id===id);if(!selected)throw Error('Pedido excluído ou indisponível. Atualize a lista.');
    context={order:selected,scales,stores};get('messages-kind').value=kind;
    const people=new Map(scales.filter(s=>['escalada','presente'].includes(s.status)&&s.confirmacao!=='recusou').map(s=>[String(s.diarista_id),s.diarista_nome]));
    get('messages-person').replaceChildren(new Option('Toda a equipe',''),...Array.from(people,([id,name])=>new Option(name,id)));get('messages-person').value=people.has(String(personId))?String(personId):'';show();
  }
  function payment(items){++sequence;context={payment:items};show();}
  get('order-messages').onclick=async()=>{const b=get('order-messages');b.disabled=true;try{await order(orderDetailId);}catch(e){orderDetailError(e.message);}finally{b.disabled=false;}};
  get('messages-kind').onchange=get('messages-person').onchange=generate;get('messages-reset').onclick=generate;
  preview.oninput=()=>{feedback.hidden=true;get('messages-copy').disabled=!preview.value.trim();};
  get('messages-copy').onclick=async()=>{try{await navigator.clipboard.writeText(preview.value);feedback.textContent='Mensagem copiada. Cole no WhatsApp.';}catch{preview.focus();preview.select();feedback.textContent='O navegador bloqueou a cópia. O texto está selecionado para você copiar manualmente.';}feedback.hidden=false;};
  for(const id of ['messages-close','messages-dismiss'])get(id).onclick=()=>dialog.close();dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();});
  function clear(){++sequence;context=null;preview.value='';feedback.hidden=true;if(dialog.open)dialog.close();}window.addEventListener('direct:authorized',clear);window.addEventListener('direct:signed-out',clear);
  window.DirectMessages={order,payment};
})();
