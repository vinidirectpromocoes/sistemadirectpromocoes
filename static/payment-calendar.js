(function(root) {
  'use strict';
  function due(serviceDate, firstDay, secondDay, weeklyDay = null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '')) return null;
    const [year, month, day] = serviceDate.split('-').map(Number);
    const service = new Date(Date.UTC(year, month - 1, day));
    if (service.getUTCFullYear() !== year || service.getUTCMonth() !== month - 1 || service.getUTCDate() !== day) return null;
    if (weeklyDay !== null) {
      if (![5, 6].includes(weeklyDay)) return null;
      service.setUTCDate(day - ((service.getUTCDay() + 6) % 7) + 7 + weeklyDay - 1);
      return service.toISOString().slice(0, 10);
    }
    if (![firstDay, secondDay].every(day => Number.isInteger(day) && day >= 1 && day <= 31)) return null;
    const base = new Date(Date.UTC(year, month - 1 + (day > 15 ? 1 : 0), 1));
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(day > 15 ? secondDay : firstDay, lastDay));
    return base.toISOString().slice(0, 10);
  }
  function forNetwork(serviceDate, network, rates) {
    const rate = (rates || []).find(item => item.rede.toLocaleLowerCase('pt-BR') === network.toLocaleLowerCase('pt-BR'));
    return rate ? due(serviceDate, rate.pagamento_primeira_quinzena, rate.pagamento_segunda_quinzena, rate.pagamento_semanal_dia ?? null) : null;
  }
  const api = { due, forNetwork };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DirectPaymentCalendar = api;
})(typeof window === 'undefined' ? globalThis : window);
