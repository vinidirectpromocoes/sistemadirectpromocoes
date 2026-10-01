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
  assert.ok(items[0].completar.includes('setor de experiência'));
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
  assert.match(item.avisos[0], /1 diarista por dia/);
});

test('intervalo abreviado termina no mesmo mês quando a data final é posterior', () => {
  const item = parser.parse('Loja: Meireles\nFunção: FLV\nHorário: 07:00 as 15:20\nData de inicio: 29 a 30', { stores, sectors, today })[0];
  assert.deepEqual(item.dados.turnos.map(shift => shift.data), ['2026-09-29', '2026-09-30']);
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

test('preserva registros incompletos separados e revisões posteriores', () => {
  const pieces = parser.parse('Nome Completo: Maria\nNome Completo: Joana', { stores, sectors, today });
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].dados.nome, 'Maria');
  assert.equal(pieces[1].dados.nome, 'Joana');
  assert.notEqual(parser.textKey('CPF: 52998224725\nBairro: Centro'), parser.textKey('CPF: 52998224725\nBairro: Aldeota'));
});

test('Cambeba: reconhece a função e as seis datas; pede a rede ambígua', () => {
  const message = 'Loja: Cambeba\\\nFunção: op. caixa\\\nHorário: 13:40 as 22:00\\\nData de inicio : 29 a 04\\\nQuantidade de dias : 6';
  const catalog = [{ rede: 'Super do Povo', nome: 'Cambeba' }, { rede: 'Pinheiro', nome: 'Cambeba' }];
  const [item] = parser.parse(message, { stores: catalog, sectors, today });
  assert.equal(item.tipo, 'pedido');
  assert.equal(item.dados.unidade, 'Cambeba');
  assert.equal(item.dados.setor, 'Operador de caixa');
  assert.equal(item.dados.turnos.length, 6);
  assert.equal(item.dados.turnos[0].data, '2026-09-29');
  assert.equal(item.dados.turnos.at(-1).data, '2026-10-04');
  assert.deepEqual(item.faltando, ['rede']);
  assert.match(item.avisos[0], /Super do Povo ou Pinheiro/);
  const [complete] = parser.parse(`Rede: Pinheiro\n${message}`, { stores: catalog, sectors, today });
  assert.deepEqual(complete.faltando, []);
});

test('nome e CPF válido permitem cadastro parcial sem inventar disponibilidade ou locomoção',()=>{const [r]=parser.parse('Nome Completo: Pessoa Parcial\nCPF: 529.982.247-25');assert.deepEqual(r.faltando,[]);assert.deepEqual(r.dados.disponibilidade,[]);assert.equal(r.dados.pode_se_deslocar,null);assert.equal(r.dados.trabalhando,null);assert.ok(r.completar.includes('setor de experiência'));const [bad]=parser.parse('Nome Completo: Pessoa\nCPF: 529.982.247-25\nCEP: 123');assert.deepEqual(bad.faltando,['CEP válido']);});

test('pedido com pessoa escalada reconhece formato WhatsApp, loja e dois dias consecutivos',()=>{
  const message=`Rede: Hipermarket\n*Loja:* LOJA VILA UNIÃO\n*Função:* Repositor de mercearia\n*Horário:* 6:00 às 14:20\n*Data de início:* 03/10\n*Quantidade de dias:* 2 dias\n\n*nome: Fernando Ferreira Grangeiro*\nCPF: 04068775303`;
  const items=parser.parse(message,{stores:[{rede:'Hipermarket',nome:'Vila União'}],sectors,today:'2026-10-01'});
  assert.equal(items.length,1);const [item]=items;
  assert.equal(item.tipo,'pedido');assert.equal(item.dados.unidade,'Vila União');
  assert.deepEqual(item.dados.diarista_escalado,{nome:'Fernando Ferreira Grangeiro',cpf:'04068775303'});
  assert.deepEqual(item.dados.turnos,[{data:'2026-10-03',inicio:'06:00',fim:'14:20'},{data:'2026-10-04',inicio:'06:00',fim:'14:20'}]);
  assert.deepEqual(item.faltando,[]);
});

test('vários pedidos mantêm suas pessoas separadas e datas atravessam o mês',()=>{
  const message=`Rede: Super do Povo\nLoja: Meireles\nFunção: FLV\nHorário: 07:00 às 15:20\nData: 31/10\nQuantidade de dias: 2\nNome Completo: Pessoa A\nCPF: 52998224725\n\nRede: Hipermarket\nLoja: Vila União\nFunção: ASG\nHorário: 06:00 às 14:20\nData: 03/10\nNome: Pessoa B\nCPF: 04068775303`;
  const items=parser.parse(message,{stores:[...stores,{rede:'Hipermarket',nome:'Vila União'}],today:'2026-10-01'});
  assert.equal(items.length,2);assert.equal(items[0].dados.diarista_escalado.nome,'Pessoa A');assert.equal(items[1].dados.diarista_escalado.nome,'Pessoa B');
  assert.deepEqual(items[0].dados.turnos.map(t=>t.data),['2026-10-31','2026-11-01']);
});

test('CPF inválido, dois nomes e diferença entre intervalo e quantidade exigem revisão',()=>{
  const base='Loja: Meireles\nFunção: FLV\nHorário: 07:00 às 15:20\nData: 03/10 a 04/10\nQuantidade de dias: 3\nNome: Pessoa A\nCPF: 11111111111\nNome: Pessoa B';
  const [item]=parser.parse(base,{stores,today:'2026-10-01'});
  assert.ok(item.faltando.includes('CPF válido do diarista escalado'));assert.ok(item.faltando.includes('revisar mais de um diarista informado no mesmo pedido'));assert.ok(item.faltando.includes('confirmar quantidade de dias'));
});

test('nome sem CPF só usa um cadastro existente com correspondência única',()=>{
  const message='Loja: Meireles\nFunção: FLV\nHorário: 07:00 às 15:20\nData: 03/10\nNome: Pessoa Conhecida';
  const context={stores,today:'2026-10-01',workers:[{nome:'Pessoa Conhecida',cpf:'52998224725'}]};
  assert.equal(parser.parse(message,context)[0].dados.diarista_escalado.cpf,'52998224725');
  context.workers.push({nome:'Pessoa Conhecida',cpf:'04068775303'});
  assert.ok(parser.parse(message,context)[0].faltando.includes('CPF válido do diarista escalado'));
});

test('mensagens WhatsApp em lote mantêm rede e loja juntas mesmo sem diarista', () => {
  const a='*Rede:* Hipermarket\n*Loja:* LOJA VILA UNIÃO\n*Função:* ASG\n*Horário:* 06:00 às 14:20\n*Data:* 03/10';
  const b='*Rede:* Super do Povo\n*Loja:* Meireles\n*Função:* FLV\n*Horário:* 07:00 às 15:20\n*Data:* 04/10';
  const parts=parser.split(a+'\n\n'+b);
  assert.equal(parts.length,2);assert.match(parts[0],/Hipermarket/);assert.match(parts[0],/VILA UNIÃO/);assert.match(parts[1],/Super do Povo/);
});
