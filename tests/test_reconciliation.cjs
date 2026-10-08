const assert = require('node:assert/strict');
const { build } = require('../static/reconciliation.js');
const { calculate } = require('../static/forecast.js');

const order = { id: 7, supermercado: 'Super do Povo', unidade: 'Meireles', setor: 'FLV',
  situacao: 'confirmado', quantidade_diaristas: 1, turnos: [{ data: '2026-09-29' }, { data: '2026-09-30' }] };
const rates = { redes: [{ rede: 'Super do Povo', valor_recebido_centavos: 13400, valor_padrao_centavos: 9000 }],
  setores: [], extras: [{ rede: 'Super do Povo', transporte_centavos: 500, taxas_centavos: 200, outros_centavos: 100 }] };
const shifts = { 7: [
  { id: 1, pedido_id: 7, data: '2026-09-29', status: 'falta', diarista_nome: 'Maria',
    falta_motivo: 'Não compareceu', substituida_por_escala_id: 2 },
  { id: 2, pedido_id: 7, data: '2026-09-29', status: 'presente', diarista_nome: 'Ana', diaria: { id: 9 } },
] };
const forecast = calculate([order], shifts, rates);
assert.equal(forecast.expected.revenue, 26800);
assert.equal(forecast.expected.cost, 18000);
assert.equal(forecast.expected.extras, 1600);
assert.equal(forecast.expected.net, 7200);
assert.equal(forecast.byOrder[0].net, 7200);

const finance = [{ origem: 'diaria', id: 9, pedido_escala_id: 2, valor_centavos: 9000,
  valor_recebido_centavos: 13400, vencimento: '2026-09-29', data_pagamento: null }];
let result = build([order], shifts, finance, [], '', '2026-09-30');
assert.equal(result.summary.requested, 2);
assert.equal(result.summary.present, 1);
assert.ok(result.issues.some(item => /ainda não cobrada/.test(item.message)));
assert.ok(!result.issues.some(item => /sem substituta/.test(item.message)));
const invoice = { id: 5, status: 'aberta', valor_centavos: 13400, valor_recebido_centavos: 5000,
  itens: [{ diaria_id: 9 }] };
result = build([order], shifts, finance, [invoice], '2026-09', '2026-09-30');
assert.equal(result.summary.billed, 1);
assert.equal(result.summary.collected, 0, 'recebimento parcial não quita item individual');
assert.ok(result.issues.some(item => /cobrança parcial/.test(item.message)));
invoice.valor_recebido_centavos = 13400;
finance[0].data_pagamento = '2026-09-30';
result = build([order], shifts, finance, [invoice], '', '2026-09-30');
assert.equal(result.summary.collected, 1);
assert.equal(result.summary.paid, 1);
console.log('Conciliação, substituição, recebimento parcial e líquido: OK');

result = build([order], shifts, finance, [invoice], {start:'2026-09-30',end:'2026-09-30'}, '2026-09-30');
assert.equal(result.rows.length,1);
assert.equal(result.summary.present,0);
result = build([order], shifts, finance, [invoice], {start:'2026-09-28',end:'2026-10-04'}, '2026-09-30');
assert.equal(result.summary.present,1);
assert.equal(result.summary.paid,1);
