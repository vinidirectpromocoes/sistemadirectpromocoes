/* Cálculos puros: pedidos, escalas e tarifas. Valores sempre em centavos. */
(() => {
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  function calculate(orders, scalesByOrder, tariffs, month = '') {
    const result = {
      ideal: { revenue: 0, cost: 0, margin: 0 },
      expected: { revenue: 0, cost: 0, margin: 0 },
      confirmed: { revenue: 0, cost: 0, margin: 0 },
      demand: 0, expectedDays: 0, present: 0, absent: 0, open: 0,
      missingRevenue: 0, missingCost: 0, byNetwork: [], byOrder: [],
    };
    const networks = new Map();
    for (const order of orders || []) {
      const cancelled = order.situacao === 'cancelado';
      const network = (tariffs?.redes || []).find(rate => norm(rate.rede) === norm(order.supermercado));
      const sectorRates = (tariffs?.setores || []).filter(rate => norm(rate.setor) === norm(order.setor) && rate.valor_pago_centavos != null);
      const sectorRate = sectorRates.find(rate => norm(rate.rede) === norm(order.supermercado)) || sectorRates.find(rate => !rate.rede);
      const currentRevenue = network?.valor_recebido_centavos ?? null;
      const currentCost = sectorRate?.valor_pago_centavos ?? network?.valor_padrao_centavos ?? null;
      const networkName = network?.rede || order.supermercado;
      const networkKey = norm(networkName);
      const aggregate = networks.get(networkKey) || { name: networkName, revenue: 0, cost: 0, days: 0 };
      networks.set(networkKey, aggregate);
      const orderTotal = {
        id: order.id, network: networkName, unit: order.unidade || '', sector: order.setor || '',
        requested: 0, days: 0, present: 0, absent: 0, revenue: 0, cost: 0, margin: 0,
      };
      const scales = scalesByOrder?.[order.id] || [];
      for (const shift of order.turnos || []) {
        if (month && !shift.data.startsWith(month)) continue;
        const dayScales = scales.filter(scale => scale.data === shift.data);
        const active = dayScales.filter(scale => scale.status !== 'falta');
        const present = active.filter(scale => scale.status === 'presente');
        const requested = cancelled ? present.length : Number(order.quantidade_diaristas) || 0;
        const absent = cancelled ? 0 : dayScales.length - active.length;
        // Uma vaga ainda não escalada permanece na hipótese de atendimento integral.
        // A falta reduz a projeção; uma substituta escalada recompõe a vaga.
        // Pedido cancelado mantém apenas diárias realizadas, inclusive valores congelados.
        const expected = cancelled ? present.length : Math.min(requested, active.length + Math.max(0, requested - dayScales.length));
        result.demand += requested;
        result.expectedDays += expected;
        result.present += present.length;
        result.absent += absent;
        result.open += cancelled ? 0 : Math.max(0, requested - active.length);
        orderTotal.requested += requested;
        orderTotal.days += expected;
        orderTotal.present += present.length;
        orderTotal.absent += absent;
        if (!cancelled && currentRevenue != null) result.ideal.revenue += currentRevenue * requested;
        if (!cancelled && currentCost != null) result.ideal.cost += currentCost * requested;
        const forecastPresent = present.slice(0, expected);
        const remaining = expected - forecastPresent.length;
        if (currentRevenue == null) result.missingRevenue += remaining;
        if (currentCost == null) result.missingCost += remaining;
        if (currentRevenue != null) {
          result.expected.revenue += currentRevenue * remaining;
          aggregate.revenue += currentRevenue * remaining;
          orderTotal.revenue += currentRevenue * remaining;
        }
        if (currentCost != null) {
          result.expected.cost += currentCost * remaining;
          aggregate.cost += currentCost * remaining;
          orderTotal.cost += currentCost * remaining;
        }
        aggregate.days += expected;
        for (const scale of present) {
          const revenue = scale.diaria?.valor_recebido_centavos ?? currentRevenue;
          const cost = scale.diaria?.valor_centavos ?? currentCost;
          if (revenue != null) result.confirmed.revenue += revenue;
          if (cost != null) result.confirmed.cost += cost;
        }
        for (const scale of forecastPresent) {
          const revenue = scale.diaria?.valor_recebido_centavos ?? currentRevenue;
          const cost = scale.diaria?.valor_centavos ?? currentCost;
          if (revenue == null) result.missingRevenue++;
          else { result.expected.revenue += revenue; aggregate.revenue += revenue; orderTotal.revenue += revenue; }
          if (cost == null) result.missingCost++;
          else { result.expected.cost += cost; aggregate.cost += cost; orderTotal.cost += cost; }
        }
      }
      if (orderTotal.requested) {
        orderTotal.margin = orderTotal.revenue - orderTotal.cost;
        result.byOrder.push(orderTotal);
      }
    }
    for (const target of [result.ideal, result.expected, result.confirmed]) target.margin = target.revenue - target.cost;
    result.byNetwork = [...networks.values()].map(item => ({ ...item, margin: item.revenue - item.cost })).sort((a, b) => b.revenue - a.revenue);
    return result;
  }
  if (typeof window !== 'undefined') window.DirectForecast = { calculate };
  if (typeof module !== 'undefined') module.exports = { calculate };
})();
