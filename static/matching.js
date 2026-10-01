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
      const slot = (order.turnos || []).find(item => item.data === shift.data);
      if (!slot || slot.inicio >= shift.fim || shift.inicio >= slot.fim) continue;
      if ((scales?.[order.id] || []).some(item => item.diarista_id === workerId && item.data === shift.data && !['falta','desistiu'].includes(item.status))) return true;
    }
    return false;
  }
  function rank(worker, shift, order, store, orders, scales) {
    if (worker.bloqueada) return { eligible: false, reason: 'Cadastro bloqueado' };
    const day = weekday[new Date(`${shift.data}T12:00:00`).getDay()];
    if (!(worker.disponibilidade || []).some(slot => slot.dia === day && slot.inicio <= shift.inicio && slot.fim >= shift.fim))
      return { eligible: false, reason: 'Fora da disponibilidade' };
    if (conflicts(worker.id, shift, orders, scales)) return { eligible: false, reason: 'Conflito de horário' };
    const sameArea = store?.bairro && normal(store.bairro) === normal(worker.bairro);
    if (store?.bairro && !sameArea && !worker.pode_se_deslocar) return { eligible: false, reason: 'Deslocamento limitado' };
    const reasons = [];
    let score = 0;
    if (matchesSector(worker, order.setor)) { score += 50; reasons.push('experiência no setor'); }
    if (sameArea) { score += 25; reasons.push('mesmo bairro'); }
    else if (worker.pode_se_deslocar) { score += 10; reasons.push('pode se deslocar'); }
    if (worker.trabalhando === false) { score += 5; reasons.push('disponível no cadastro'); }
    return { eligible: true, score, reasons };
  }
  return { rank, matchesSector, conflicts };
});
