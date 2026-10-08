const assert = require('node:assert/strict');
const test = require('node:test');
const matching = require('../static/matching.js');

const order = { id: 1, setor: 'Operador de caixa', turnos: [{ data: '2026-09-28', inicio: '07:00', fim: '15:20' }] };
const shift = order.turnos[0];
const worker = { id: 5, nome: 'Maria', setores: ['Operador de caixa'], bairro: 'Meireles',
  bloqueada: false, pode_se_deslocar: false, trabalhando: false,
  disponibilidade: [{ dia: 'segunda', inicio: '06:00', fim: '17:00' }] };

test('prioriza experiência e bairro e recusa deslocamento limitado', () => {
  const store = { bairro: 'Meireles' };
  const ideal = matching.rank(worker, shift, order, store, [order], {});
  assert.equal(ideal.eligible, true);
  assert.ok(ideal.reasons.includes('experiência no setor'));
  assert.ok(ideal.reasons.includes('mesmo bairro'));
  assert.equal(matching.rank(worker, shift, order, { bairro: 'Cambeba' }, [order], {}).reason, 'Deslocamento limitado');
});

test('sobreposição e disponibilidade não impedem recomendação', () => {
  const another = { id: 2, turnos: [{ data: '2026-09-28', inicio: '10:00', fim: '18:00' }] };
  const scales = { 2: [{ diarista_id: 5, data: '2026-09-28', status: 'escalada' }] };
  assert.equal(matching.rank(worker, shift, order, { bairro: 'Meireles' }, [order, another], scales).eligible, true);
  scales[2][0].status = 'falta';
  assert.equal(matching.rank(worker, shift, order, { bairro: 'Meireles' }, [order, another], scales).eligible, true);
});

test('cadastro básico sem horários pode ser selecionado em qualquer dia',()=>{assert.equal(matching.rank({...worker,disponibilidade:[]},shift,order,{bairro:'Meireles'},[],{}).eligible,true);});
