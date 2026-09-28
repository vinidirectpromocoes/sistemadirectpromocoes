const { test } = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../static/reading-parser.js');
const stores = [{ rede: 'Super do Povo', nome: 'Meireles' }];
const sectors = ['Repositor de FLV', 'Operador de caixa'];
const today = '2026-09-28';

test('separa texto misto em diaristas e pedidos', () => {
  const text = `Nome Completo: Maria da Silva
CPF: 529.982.247-25
Bairro: Aldeota
Loja: Meireles
Função: FLV
Horário: 07:00 as 15:20
Data de inicio: 29 á 05
Quantidade de dias: 7`;
  const items = parser.parse(text, { stores, sectors, today });
  assert.deepEqual(items.map(item => item.tipo), ['diarista', 'pedido']);
  assert.equal(items[1].dados.supermercado, 'Super do Povo');
  assert.equal(items[1].dados.setor, 'Repositor de FLV');
  assert.equal(items[1].dados.turnos.length, 7);
  assert.equal(items[1].dados.turnos[0].data, '2026-09-29');
  assert.equal(items[1].dados.turnos.at(-1).data, '2026-10-05');
  assert.equal(items[1].dados.quantidade_diaristas, 1);
  assert.deepEqual(items[1].faltando, []);
  assert.ok(items[0].faltando.includes('setor de experiência'));
});

test('não confunde sete dias com sete diaristas', () => {
  const text = `Loja: Meireles
Função: FLV
Horário: 07:00 as 15:20
Data de inicio: 29 á 05
Quantidade de dias: 7`;
  const item = parser.parse(text, { stores, sectors, today })[0];
  assert.equal(item.dados.quantidade_diaristas, 1);
  assert.equal(item.dados.turnos.length, 7);
  assert.match(item.avisos[0], /1 por dia/);
});

test('ambiguidade de loja mantém pedido como pendência', () => {
  const item = parser.parse('Loja: Centro\nFunção: Caixa\nHorário: 07:00 as 15:20\nData: 29/09/2026', {
    stores: [{ rede: 'Rede A', nome: 'Centro' }, { rede: 'Rede B', nome: 'Centro' }], sectors, today,
  })[0];
  assert.ok(item.faltando.includes('rede'));
  assert.equal(item.dados.turnos.length, 1);
});

test('cadastro completo fica pronto e CPF inválido não passa', () => {
  const text = `Nome Completo: Maria da Silva
CPF: 529.982.247-25
Setor: Operador de caixa
Bairro: Aldeota
Rua/Nº: Rua das Flores, 123
CEP: 60150-000
Trabalhando atualmente: Não
Meios de locomoção: Ônibus, posso ir para qualquer região
Disponibilidade: segunda a sexta, 07:00 às 15:20`;
  const item = parser.parse(text, { stores, sectors, today })[0];
  assert.deepEqual(item.faltando, []);
  assert.equal(item.dados.disponibilidade.length, 5);
  assert.equal(item.dados.logradouro, 'Rua das Flores');
  assert.equal(item.dados.numero, '123');
  assert.ok(parser.validCpf(item.dados.cpf));
  assert.equal(parser.validCpf('11111111111'), false);
});

test('registros repetidos têm a mesma chave', () => {
  const text = 'Loja: Meireles\nFunção: FLV\nHorário: 07:00 as 15:20\nData de inicio: 29 á 05';
  const [a] = parser.parse(text, { stores, sectors, today });
  const [b] = parser.parse(text, { stores, sectors, today });
  assert.equal(a.chave, b.chave);
});
