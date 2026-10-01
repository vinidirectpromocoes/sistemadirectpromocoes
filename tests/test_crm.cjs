const {test}=require('node:test');const assert=require('node:assert/strict');const {build,filter,counts,networkNames}=require('../static/crm-model.js');
const order={id:1,supermercado:'Super do Povo',unidade:'Meireles',setor:'FLV',situacao:'confirmado',quantidade_diaristas:2,turnos:[{data:'2026-09-30',inicio:'07:00',fim:'15:20'}]};
const scale={id:2,pedido_id:1,diarista_id:3,diarista_nome:'Pessoa Teste',data:'2026-09-30',status:'escalada',confirmacao:'confirmou'};
test('pedido confirmado mantém vagas e presença pendente como etapas abertas, sem inventar presença',()=>{const r=build({orders:[order],scales:[scale]},'2026-09-30');assert.equal(r.find(x=>x.key==='pedido:1').stage,'confirmado');assert.equal(r.find(x=>x.key==='escala:2').stage,'aberto');assert.ok(r.some(x=>x.key==='vaga:1:2026-09-30'));assert.equal(counts(r).aberto,2);assert.equal(new Set(r.map(x=>x.key)).size,r.length);});
test('disponibilidade futura, presença, validação e falta possuem estados distintos',()=>{const input={orders:[order],scales:[scale]};assert.equal(build(input,'2026-09-29').find(x=>x.key==='escala:2').stage,'confirmado');input.scales=[{...scale,status:'presente',loja_validacao:'pendente'}];assert.equal(build(input,'2026-09-30').find(x=>x.key==='escala:2').stage,'confirmado');input.scales[0].loja_validacao='validado';assert.equal(build(input,'2026-09-30').find(x=>x.key==='escala:2').stage,'concluido');input.scales=[{...scale,status:'falta'}];assert.equal(build(input,'2026-09-30').find(x=>x.key==='escala:2').stage,'aberto');assert.match(build(input,'2026-09-30').find(x=>x.kind==='escala'&&x.key.startsWith('vaga')).title,/2 vaga/);});
test('recebimento parcial, conferência, pagamento, cancelamento e exclusão são derivados dos registros',()=>{const invoice={id:4,rede:'Super do Povo',status:'aberta',valor_centavos:26800,valor_recebido_centavos:10000,vencimento:'2026-09-20',itens:[{diaria_id:5}],conferencia:'conferida'};const f={id:5,origem:'diaria',pedido_escala_id:2,valor_centavos:9000,valor_recebido_centavos:13400,tipo:'despesa',contraparte:'Pessoa Teste',descricao:'Diária',vencimento:'2026-09-30'};let r=build({orders:[order],scales:[{...scale,status:'presente'}],finance:[f],invoices:[invoice]},'2026-09-30');assert.equal(r.find(x=>x.key==='cobranca:4').amount,16800);assert.equal(r.find(x=>x.key==='cobranca:4').overdue,true);assert.equal(r.find(x=>x.key==='cobranca:4').stage,'confirmado');assert.equal(r.some(x=>x.key==='faturar:5'),false);r=build({orders:[order],scales:[scale],finance:[{...f,data_pagamento:'2026-09-30'}],invoices:[{...invoice,valor_recebido_centavos:26800}]},'2026-09-30');assert.equal(r.find(x=>x.key==='cobranca:4').stage,'concluido');assert.equal(r.find(x=>x.kind==='pagamento').stage,'concluido');r=build({orders:[{...order,situacao:'cancelado'}],scales:[scale]},'2026-09-30');assert.equal(r.some(x=>x.key.startsWith('vaga')),false);assert.equal(r.find(x=>x.key==='escala:2').stage,'cancelado');assert.deepEqual(build({},'2026-09-30'),[]);});
test('busca sem acentos, tipos, redes, prazo vencido e datas filtram corretamente',()=>{const r=build({orders:[order],scales:[{...scale,data:'2026-09-29'}],workers:[{id:3,nome:'João',telefone:'',bloqueada:false}]},'2026-09-30');assert.equal(filter(r,{search:'joao'})[0].kind,'cadastro');assert.ok(filter(r,{network:'super do povo'}).every(x=>x.network==='Super do Povo'));assert.ok(filter(r,{start:'2026-09-30',end:'2026-09-30'}).every(x=>x.date==='2026-09-30'));assert.ok(filter(r,{overdue:true}).every(x=>x.overdue));assert.equal(filter(r,{kind:'pagamento'}).length,0);});
test('leituras, ocorrências, cadastros e contratos só refletem informações reais',()=>{const r=build({readings:[{id:1,status:'pendente',tipo:'pedido',faltando:['rede']},{id:2,status:'resolvido'}],occurrences:[{id:1,pedido_id:1,estado:'resolvida',tipo:'atraso',descricao:'Resolvido'}],workers:[{id:1,nome:'Bloqueada',bloqueada:true},{id:2,nome:'Atual',telefone:'85999999999',disponibilidade_confirmada_em:'2026-09-30',setores:['FLV'],cep:'60000000',logradouro:'Rua',numero:'1',bairro:'Centro',disponibilidade:[{dia:'quarta',inicio:'07:00',fim:'15:20'}],trabalhando:false,pode_se_deslocar:false}],contracts:[{id:1,rede:'Super do Povo',fim:'2026-10-10'}]},'2026-09-30');assert.equal(r.filter(x=>x.kind==='cadastro').length,0);assert.equal(r.find(x=>x.key==='leitura:1').stage,'aberto');assert.equal(r.find(x=>x.key==='leitura:2').stage,'concluido');assert.equal(r.find(x=>x.kind==='contrato').stage,'aberto');assert.equal(r.find(x=>x.kind==='ocorrencia').stage,'concluido');});

assert.deepEqual(networkNames([{network:'Super do povo'},{network:'Super do Povo'}],[{rede:'Super do Povo'}]),['Super do Povo']);
assert.equal(build({finance:[{id:1,origem:'manual',referencia:'2026-09-30',vencimento:null,descricao:'Teste'}]},'2026-09-30')[0].date,'2026-09-30');

assert.match(build({workers:[{id:3,nome:'Parcial',telefone:'85999999999',disponibilidade_confirmada_em:'2026-09-30',setores:[],disponibilidade:[]}]},'2026-09-30')[0].detail,/Completar setores, endereço, dias e horários/);

const {simplify,pendingFilter}=require('../static/crm-model.js');
test('pendências agrupam sete dias do pedido e preservam cada motivo e ação',()=>{
  const days=Array.from({length:7},(_,i)=>({data:`2026-10-0${i+1}`,inicio:'07:00',fim:'15:20'}));
  const input={orders:[{...order,turnos:days,quantidade_diaristas:1}]};
  let items=simplify(input,'2026-10-01');assert.equal(items.length,1);assert.equal(items[0].issues.length,7);assert.equal(items[0].label,'Escalar diarista');assert.equal(items[0].today,true);
  input.scales=[{...scale,data:'2026-10-01',status:'presente',loja_validacao:'validado'}];
  items=simplify(input,'2026-10-01');assert.equal(items.length,1);assert.equal(items[0].issues.length,6);assert.equal(items[0].today,false);
  input.scales[0].status='falta';items=simplify(input,'2026-10-01');assert.equal(items[0].today,true);assert.ok(items[0].issues.some(i=>i.label==='Substituir diarista'));assert.ok(items[0].issues.some(i=>i.label==='Escalar diarista'));
  assert.deepEqual(simplify({},'2026-10-01'),[]);
});
test('retorno futuro não vira presença; validação pendente e atraso continuam visíveis',()=>{
  const o={...order,quantidade_diaristas:1};const input={orders:[o],scales:[scale]};
  assert.deepEqual(simplify(input,'2026-09-29'),[],'Escala futura já confirmada não exige ação e não é histórico concluído');
  input.scales=[{...scale,confirmacao:'pendente'}];let entry=simplify(input,'2026-09-29')[0];assert.equal(entry.waiting,true);assert.equal(entry.label,'Conferir resposta');assert.equal(entry.view,'pending');
  input.scales=[scale];
  entry=simplify(input,'2026-09-30')[0];assert.equal(entry.waiting,false);assert.equal(entry.label,'Conferir presença');assert.equal(entry.today,true);
  input.scales[0]={...scale,status:'presente',loja_validacao:'pendente'};entry=simplify(input,'2026-10-01')[0];assert.equal(entry.overdue,true);assert.equal(entry.label,'Conferir atendimento');
  input.scales[0].loja_validacao='validado';assert.equal(simplify(input,'2026-10-01')[0].view,'history');
  input.orders[0]={...o,situacao:'cancelado'};entry=simplify(input,'2026-10-01')[0];assert.equal(entry.view,'history');assert.equal(entry.issues.length,0);
});
test('financeiro agrupa diárias sem juntar pessoas de mesmo nome e separa pagos do saldo',()=>{
  const input={orders:[order],scales:[scale,{...scale,id:3,diarista_id:4}],finance:[{id:1,origem:'diaria',pedido_escala_id:2,tipo:'despesa',contraparte:'Pessoa',descricao:'Diária',valor_centavos:9000,referencia:'2026-09-30'},{id:2,origem:'diaria',pedido_escala_id:2,tipo:'despesa',contraparte:'Pessoa',descricao:'Diária',valor_centavos:8500,referencia:'2026-10-01'},{id:3,origem:'diaria',pedido_escala_id:3,tipo:'despesa',contraparte:'Pessoa',descricao:'Diária',valor_centavos:null,referencia:'2026-10-01'},{id:4,origem:'diaria',pedido_escala_id:2,tipo:'despesa',contraparte:'Pessoa',descricao:'Diária',valor_centavos:9000,data_pagamento:'2026-09-30',referencia:'2026-09-29'}]};
  const entries=simplify(input,'2026-10-01'),pending=pendingFilter(entries,{area:'financeiro'},'2026-10-01');assert.equal(pending.length,2);assert.equal(pending.find(e=>e.key==='pagamentos:3').amount,17500);assert.equal(pending.find(e=>e.key==='pagamentos:4').missingAmounts,1);
  assert.equal(pendingFilter(entries,{area:'financeiro',start:'2026-10-01',end:'2026-10-01'},'2026-10-01').find(e=>e.key==='pagamentos:3').amount,8500);
  assert.equal(pendingFilter(entries,{area:'financeiro',view:'history'},'2026-10-01')[0].amount,9000);
});
test('filtros usam qualquer dia do pedido e pesquisa encontra pessoas nos detalhes',()=>{
  const input={orders:[{...order,turnos:[...order.turnos,{data:'2026-10-01',inicio:'07:00',fim:'15:20'}]}],scales:[scale]};const entries=simplify(input,'2026-10-01');
  assert.equal(pendingFilter(entries,{start:'2026-10-01',end:'2026-10-01'},'2026-10-01').length,1);
  assert.equal(pendingFilter(entries,{search:'pessoa teste'},'2026-10-01').length,1);
  assert.equal(pendingFilter(entries,{scope:'overdue'},'2026-10-01').length,1);
  assert.equal(pendingFilter(entries,{scope:'waiting'},'2026-10-01').length,0);
  assert.equal(pendingFilter(entries,{start:'2030-01-01'},'2026-10-01').length,0);
});
test('cobrança conferida ainda a receber aparece em retorno, sem omitir atrasadas',()=>{
  const invoice={id:9,rede:'Super do Povo',status:'aberta',valor_centavos:26800,valor_recebido_centavos:10000,vencimento:'2026-09-30',itens:[{diaria_id:5}],conferencia:'conferida'};
  let e=simplify({invoices:[invoice]},'2026-10-01')[0];assert.equal(e.waiting,true);assert.equal(e.overdue,true);assert.equal(e.amount,16800);assert.equal(e.label,'Conferir recebimento');
  e=simplify({invoices:[{...invoice,conferencia:'contestada'}]},'2026-10-01')[0];assert.equal(e.waiting,false);assert.equal(e.label,'Revisar contestação');
});
