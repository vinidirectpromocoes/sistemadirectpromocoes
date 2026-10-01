const test = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../static/payment-calendar.js');
const CRM = require('../static/crm-model.js');

test('quinzenas, mês seguinte, fevereiro e virada de ano', () => {
  for (const [date, first, second, expected] of [
    ['2026-09-01',20,5,'2026-09-20'], ['2026-09-15',20,5,'2026-09-20'],
    ['2026-09-16',20,5,'2026-10-05'], ['2026-09-30',30,15,'2026-10-15'],
    ['2026-02-15',30,15,'2026-02-28'], ['2028-02-15',30,15,'2028-02-29'],
    ['2026-12-31',20,5,'2027-01-05'], ['2026-01-31',20,31,'2026-02-28'],
  ]) assert.equal(calendar.due(date, first, second), expected);
  assert.equal(calendar.due('2026-09-29',null,null),null);
  assert.equal(calendar.due('2026-02-31',30,15),null);
  assert.equal(calendar.forNetwork('2026-09-29','SUPER DO POVO',[{rede:'Super do Povo',pagamento_primeira_quinzena:30,pagamento_segunda_quinzena:15}]),'2026-10-15');
});

test('pendências respeitam o vencimento, com prazo de recebimento separado da data da diária', () => {
  const issues = CRM.build({today:'2026-10-01', workers:[], orders:[{id:1,supermercado:'Super do Povo',unidade:'Meireles'}], scales:[{id:1,pedido_id:1,status:'presente',data:'2026-09-29'}], finance:[{id:1,origem:'diaria',tipo:'despesa',pedido_escala_id:1,data:'2026-09-29',referencia:'2026-09-29',vencimento:'2026-10-15',vencimento_recebimento:'2026-10-15',valor_centavos:9000,valor_recebido_centavos:13400}], invoices:[]}, '2026-10-01');
  const finance = issues.filter(i => i.kind==='pagamento'||i.key.startsWith('faturar:'));
  assert.equal(finance.length,2);
  assert.ok(finance.every(i=>i.date==='2026-10-15'&&!i.overdue));
});
