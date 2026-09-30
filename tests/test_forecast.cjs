const assert = require('node:assert/strict');
const { calculate, periodRange, includesDate } = require('../static/forecast.js');

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

// Dia e semana usam datas do serviço, inclusive semanas entre dois meses/anos.
assert.deepEqual(periodRange('day', '2026-09-30'), {start:'2026-09-30', end:'2026-09-30'});
assert.deepEqual(periodRange('week', '2026-09-30'), {start:'2026-09-28', end:'2026-10-04'});
assert.deepEqual(periodRange('week', '2026-10-04'), {start:'2026-09-28', end:'2026-10-04'});
assert.deepEqual(periodRange('week', '2027-01-01'), {start:'2026-12-28', end:'2027-01-03'});
assert.equal(includesDate('2026-10-05', periodRange('week','2026-09-30')), false);
const confirmedOrder = {...firstOrder, id:20};
const confirmedRates = {redes:[{rede:'Super do Povo',valor_recebido_centavos:13400,valor_padrao_centavos:9000}]};
const confirmedScales = {20:['2026-09-29','2026-09-30'].map((data,index)=>scale(index+1,data,'presente',{valor_recebido_centavos:13400,valor_centavos:9000}))};
result = calculate([confirmedOrder],confirmedScales,confirmedRates);
assert.deepEqual(result.confirmed,{revenue:26800,cost:18000,extras:0,margin:8800,net:8800});
result = calculate([confirmedOrder],confirmedScales,confirmedRates,periodRange('day','2026-09-30'));
assert.deepEqual(result.confirmed,{revenue:13400,cost:9000,extras:0,margin:4400,net:4400});
assert.equal(result.expected.revenue,13400);
result = calculate([confirmedOrder],confirmedScales,confirmedRates,periodRange('week','2026-09-30'));
assert.equal(result.demand,6);
assert.equal(result.confirmed.net,8800);
assert.equal(result.expected.revenue,80400);
const absentScales={20:[confirmedScales[20][0],scale(2,'2026-09-30','falta')]};
result=calculate([confirmedOrder],absentScales,confirmedRates,periodRange('week','2026-09-30'));
assert.equal(result.confirmed.net,4400);
assert.equal(result.expected.revenue,67000);
assert.equal(calculate([],confirmedScales,confirmedRates).confirmed.revenue,0);
result=calculate([confirmedOrder],{20:[scale(1,'2026-09-30','presente')]},{},periodRange('day','2026-09-30'));
assert.equal(result.confirmedMissingRevenue,1);
assert.equal(result.confirmedMissingCost,1);
console.log('Cards confirmados e períodos dia/semana: OK');
