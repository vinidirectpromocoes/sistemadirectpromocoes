const {test}=require('node:test');const assert=require('node:assert/strict');
const {calculate,contract}=require('../static/insights.js');const forecast=require('../static/forecast.js');
const order={id:1,supermercado:'Super do Povo',unidade:'Meireles',setor:'Operador de caixa',situacao:'confirmado',quantidade_diaristas:2,turnos:[{data:'2026-09-29',inicio:'07:00',fim:'15:20'},{data:'2026-10-01',inicio:'07:00',fim:'15:20'}]};
test('indicadores não inferem horários; faltas e substituição usam registros reais',()=>{
 const scales=[{id:1,pedido_id:1,diarista_id:1,diarista_nome:'A',data:'2026-09-29',status:'falta',falta_confirmada_em:'2026-09-29T10:00:00Z',substituida_por_escala_id:2},
 {id:2,pedido_id:1,diarista_id:2,diarista_nome:'B',data:'2026-09-29',status:'presente',criado_em:'2026-09-29T10:15:00Z',chegada_em:'2026-09-29T10:30:00Z',loja_validacao:'validado'},
 {id:3,pedido_id:1,diarista_id:3,diarista_nome:'C',data:'2026-09-29',status:'presente',confirmacao:'confirmou',confirmacao_em:'2026-09-28T12:00:00Z'}];
 const d=calculate([order],scales,[{telefone:''}], [{escala_id:2,tipo:'elogio',estado:'aberta'}],[],{today:'2026-09-30'});
 assert.equal(d.coverage,100);assert.equal(d.punctuality,0);assert.equal(d.arrivalUnknown,1);assert.equal(d.replacementMinutes,15);assert.equal(d.validated,1);assert.equal(d.profiles.find(x=>x.id===2).praise,1);
});
test('cobrança vencida considera saldo parcial e contestação não duplica receitas',()=>{
 const d=calculate([],[],[],[],[{id:1,rede:'Rede',status:'emitida',vencimento:'2026-09-25',valor_centavos:13400,valor_recebido_centavos:3400,conferencia:'contestada'},{id:2,status:'cancelada',vencimento:'2026-09-25',valor_centavos:999}],{today:'2026-09-30'});
 assert.equal(d.overdue[0].balance,10000);assert.equal(d.overdue[0].days,5);assert.equal(d.contested,10000);assert.equal(d.coverage,null);assert.equal(d.punctuality,null);
});
test('contrato mais específico e vigência; presença mantém snapshot anterior',()=>{
 const contracts=[{id:1,rede:order.supermercado,loja:'',setor:'',inicio:'2026-09-01',fim:null,valor_recebido_centavos:14000,valor_pago_centavos:9000},{id:2,rede:order.supermercado,loja:'Meireles',setor:'Operador de caixa',inicio:'2026-10-01',fim:null,valor_recebido_centavos:15000,valor_pago_centavos:9500}];
 assert.equal(contract(contracts,order,'2026-09-29').id,1);assert.equal(contract(contracts,order,'2026-10-01').id,2);
 const d=forecast.calculate([order],{1:[{data:'2026-09-29',status:'presente',diaria:{valor_centavos:8500,valor_recebido_centavos:13400}}]},{redes:[],setores:[],contratos:contracts});
 assert.equal(d.expected.revenue,57400);assert.equal(d.expected.cost,36500);assert.equal(d.confirmed.revenue,13400);
});
test('desistência é separada de falta e só substituição ativa recompõe a previsão',()=>{
 const o={...order,quantidade_diaristas:1,turnos:[order.turnos[0]]};
 const scales=[{id:1,pedido_id:1,diarista_id:1,diarista_nome:'A',data:o.turnos[0].data,status:'desistiu',confirmacao:'confirmou'}];
 const d=calculate([o],scales,[],[],[],{today:'2026-10-01'});
 assert.equal(d.assigned,0);assert.equal(d.absent,0);assert.equal(d.profiles[0].withdrawn,1);assert.equal(d.profiles[0].absent,0);
 const tarifs={redes:[{rede:o.supermercado,valor_recebido_centavos:13400,valor_padrao_centavos:9000}]};
 let f=forecast.calculate([o],{1:scales},tarifs);assert.equal(f.expected.revenue,0);assert.equal(f.absent,0);
 scales.push({id:2,pedido_id:1,diarista_id:2,data:o.turnos[0].data,status:'escalada'});f=forecast.calculate([o],{1:scales},tarifs);assert.equal(f.expected.revenue,13400);assert.equal(f.expected.cost,9000);assert.equal(f.confirmed.revenue,0);
});
