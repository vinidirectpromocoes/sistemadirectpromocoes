const assert = require('node:assert/strict');
const { calculate } = require('../static/forecast.js');

const tariffs = { redes: [{ rede: 'Super do Povo', valor_recebido_centavos: 13400, valor_padrao_centavos: 9000 }],
  setores: [{ rede: 'Super do Povo', setor: 'FLV', valor_pago_centavos: 9500 }] };
const order = { id: 1, supermercado: 'Super do Povo', setor: 'FLV', quantidade_diaristas: 2, situacao: 'confirmado',
  turnos: [{ data: '2026-09-29' }, { data: '2026-10-01' }] };
const scale = (id, data, status, diaria = null) => ({ id, data, status, diaria });

let result = calculate([order], {}, tariffs, '2026-09');
assert.equal(result.ideal.revenue, 26800);
assert.equal(result.expected.cost, 19000);
assert.equal(result.expected.margin, 7800);
assert.equal(result.expectedDays, 2);

result = calculate([order], { 1: [scale(1, '2026-09-29', 'falta'), scale(2, '2026-09-29', 'escalada')] }, tariffs, '2026-09');
assert.equal(result.expectedDays, 1);
assert.equal(result.expected.revenue, 13400);
assert.equal(result.expected.cost, 9500);
assert.equal(result.absent, 1);

result = calculate([order], { 1: [scale(1, '2026-09-29', 'falta'), scale(2, '2026-09-29', 'escalada'), scale(3, '2026-09-29', 'escalada')] }, tariffs, '2026-09');
assert.equal(result.expectedDays, 2, 'uma substituta recompõe a vaga');

result = calculate([order], { 1: [scale(1, '2026-09-29', 'presente', { valor_centavos: 8500, valor_recebido_centavos: 12400 })] }, tariffs, '2026-09');
assert.equal(result.confirmed.revenue, 12400, 'usa faturamento congelado no dia');
assert.equal(result.confirmed.cost, 8500, 'usa pagamento congelado no dia');
assert.equal(result.expected.revenue, 25800, 'presença confirmada preserva o faturamento original');
assert.equal(result.expected.cost, 18000, 'presença confirmada preserva o custo original');

result = calculate([order], {}, tariffs, '2026-10');
assert.equal(result.demand, 2, 'não mistura meses');

result = calculate([{ ...order, situacao: 'cancelado' }], {}, tariffs, '2026-09');
assert.equal(result.demand, 0, 'pedido cancelado não entra na previsão');
result = calculate([{ ...order, situacao: 'cancelado' }], { 1: [scale(1, '2026-09-29', 'presente', { valor_centavos: 8500, valor_recebido_centavos: 12400 })] }, tariffs, '2026-09');
assert.equal(result.expected.revenue, 12400, 'pedido cancelado preserva faturamento de presença realizada');
assert.equal(result.expected.cost, 8500, 'pedido cancelado preserva custo de presença realizada');
assert.equal(result.expectedDays, 1, 'pedido cancelado não projeta vagas restantes');
assert.equal(result.ideal.revenue, 0, 'pedido cancelado sai do cenário ideal');

result = calculate([{ ...order, supermercado: 'super do povo' }, order], {}, tariffs, '2026-09');
assert.equal(result.byNetwork.length, 1, 'variações de maiúsculas não duplicam a rede');

const firstOrder = { ...order, id: 10, quantidade_diaristas: 1, situacao: 'novo',
  turnos: ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(data => ({ data })) };
const secondOrder = { ...order, id: 11, unidade: 'Outra loja', quantidade_diaristas: 2, situacao: 'em_selecao',
  turnos: Array.from({ length: 24 }, (_, index) => ({ data: `2026-10-${String(index + 1).padStart(2, '0')}` })) };
const allOrders = [firstOrder, secondOrder];
result = calculate(allOrders, {}, tariffs);
assert.equal(result.demand, 55, 'soma todas as diárias dos pedidos registrados');
assert.equal(result.expectedDays, 55, 'prevê atendimento integral antes das faltas');
assert.equal(result.byOrder.length, 2, 'mantém cada pedido no detalhamento');
assert.equal(result.byOrder.reduce((sum, item) => sum + item.revenue, 0), result.expected.revenue);
assert.equal(calculate(allOrders, {}, tariffs, '2026-09').demand, 2, 'filtro mensal é opcional');
result = calculate(allOrders, { 11: [scale(1, '2026-10-01', 'falta')] }, tariffs);
assert.equal(result.expectedDays, 54, 'uma falta reduz a previsão em uma diária');
assert.equal(result.expected.revenue, 54 * 13400, 'falta reduz o faturamento previsto');
assert.equal(calculate([secondOrder], { 11: [scale(1, '2026-10-01', 'falta')] }, tariffs).demand, 48, 'pedido excluído sai do total');
assert.equal(calculate([{ ...secondOrder, situacao: 'cancelado' }], {}, tariffs).demand, 0, 'pedido cancelado sai do total');
console.log('Forecast: cenários de pedidos, exclusão, falta e período passaram.');
