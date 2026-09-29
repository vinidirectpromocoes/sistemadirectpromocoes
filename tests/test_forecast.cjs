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

result = calculate([{ ...order, supermercado: 'super do povo' }, order], {}, tariffs, '2026-09');
assert.equal(result.byNetwork.length, 1, 'variações de maiúsculas não duplicam a rede');
console.log('Forecast: 7 cenários passaram.');
