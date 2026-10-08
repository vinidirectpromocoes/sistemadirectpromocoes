/* Sugestões determinísticas, sem custo de IA nem geolocalização externa. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DirectMatching = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const weekday = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  function matchesSector(worker, sector) {
    const target = normal(sector).replace(/^(repositor|balconista|operador|operadora|auxiliar) de /, '');
    return (worker.setores || []).some(value => {
      const known = normal(value).replace(/^(repositor|balconista|operador|operadora|auxiliar) de /, '');
      return Boolean(target && known && (known === target || known.includes(target) || target.includes(known)));
    });
  }
  function conflicts(workerId, shift, orders, scales) {
    for (const order of orders || []) {
      if(order.situacao==='cancelado')continue;
      const slot = (order.turnos || []).find(item => item.data === shift.data);
      if (!slot || slot.inicio >= shift.fim || shift.inicio >= slot.fim) continue;
      if ((scales?.[order.id] || []).some(item => item.diarista_id === workerId && item.data === shift.data && !['falta','desistiu'].includes(item.status))) return true;
    }
    return false;
  }
  function rank(worker, shift, order, store, orders, scales) {
    if (worker.bloqueada) return { eligible: false, reason: 'Cadastro bloqueado' };
    const day = weekday[new Date(`${shift.data}T12:00:00`).getDay()];
    const available = (worker.disponibilidade || []).some(slot => slot.dia === day && slot.inicio <= shift.inicio && slot.fim >= shift.fim);
    const sameArea = store?.bairro && normal(store.bairro) === normal(worker.bairro);
    if (store?.bairro && !sameArea && !worker.pode_se_deslocar) return { eligible: false, reason: 'Deslocamento limitado' };
    const reasons = [];
    let score = 0;
    if (available) { score += 15; reasons.push('horário informado no cadastro'); }
    if (matchesSector(worker, order.setor)) { score += 50; reasons.push('experiência no setor'); }
    if (sameArea) { score += 25; reasons.push('mesmo bairro'); }
    else if (worker.pode_se_deslocar) { score += 10; reasons.push('pode se deslocar'); }
    if (worker.trabalhando === false) { score += 5; reasons.push('disponível no cadastro'); }
    return { eligible: true, score, reasons };
  }
  function rankOrder(worker, order, store, orders, scales) {
    if (!matchesSector(worker, order.setor)) return {eligible:false,reason:'Sem experiência informada no setor'};
    if (worker.trabalhando && normal(worker.rede_trabalho) && normal(worker.rede_trabalho)===normal(order.supermercado)) return {eligible:false,reason:'Trabalha nesta rede'};
    const shifts=order.turnos||[];if(!shifts.length)return {eligible:false,reason:'Sem datas'};
    const otherOrders=(orders||[]).filter(o=>o.id!==order.id), own=scales?.[order.id]||[], dates=[];let score=0,reasons=[];
    for(const shift of shifts){
      const rows=own.filter(s=>s.data===shift.data&&!['falta','desistiu'].includes(s.status));
      if(rows.some(s=>s.diarista_id===worker.id))continue;
      if(rows.length>=order.quantidade_diaristas)return {eligible:false,reason:'Um dos dias já está preenchido'};
      const r=rank(worker,shift,order,store,otherOrders,scales);if(!r.eligible)return {...r,reason:shift.data+' · '+r.reason};dates.push(shift.data);score=r.score;reasons=r.reasons;
    }
    if(!dates.length)return {eligible:false,reason:'Já escalado em todos os dias'};
    return {eligible:true,score,dates,reasons:[...reasons,'todos os '+shifts.length+' dias verificados']};
  }
  return { rank, rankOrder, matchesSector, conflicts };
});
