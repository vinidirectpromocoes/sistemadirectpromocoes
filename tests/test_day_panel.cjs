const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../static/day-panel-model.js');
const day='2026-10-24',shift={data:day,inicio:'07:00',fim:'15:20'};
test('A data escolhida usa presença registrada, inclui pedidos encerrados e exclui cancelados',()=>{
  const data={orders:[{id:1,supermercado:'Rede',unidade:'Loja',setor:'FLV',situacao:'concluido',turnos:[shift]},{id:2,supermercado:'Rede',unidade:'Outra',situacao:'cancelado',turnos:[shift]}],stores:[{rede:'REDE',nome:'Lója',cidade:'Eusébio'}],scales:[{id:1,pedido_id:1,data:day,diarista_nome:'Pessoa',status:'presente'},{id:2,pedido_id:1,data:day,diarista_nome:'Outra',status:'falta'},{id:3,pedido_id:1,data:day,diarista_nome:'Reserva',status:'escalada'},{id:4,pedido_id:1,data:day,diarista_nome:'Saiu',status:'desistiu'},{id:5,pedido_id:2,data:day,status:'presente'},{id:6,pedido_id:1,data:'2026-10-23',status:'presente'}]};
  const before=JSON.stringify(data),r=model.build(data,day);
  assert.equal(r.rows.length,4);assert.equal(r.assigned,2);assert.equal(r.present,1);assert.equal(r.awaiting,1);assert.equal(r.absent,1);assert.deepEqual(r.cities,[{city:'Eusébio',count:2}]);assert.equal(JSON.stringify(data),before);
});
test('Não presume cidade nem presença pela hora prevista',()=>{
  const r=model.build({orders:[{id:1,supermercado:'Rede',unidade:'Sem cidade',situacao:'novo',turnos:[shift]}],scales:[{pedido_id:1,data:day,status:'escalada',diarista_id:7,confirmacao:'confirmou'}]},day);
  assert.equal(r.present,0);assert.equal(r.awaiting,1);assert.equal(r.rows[0].label,'Presença a conferir');assert.equal(r.rows[0].city,'Cidade não informada');assert.deepEqual(model.build({},day).rows,[]);
});
test('Exporta somente as linhas recebidas e protege CSV/Excel sem executar fórmulas',()=>{
  const rows=[{day,worker:' =HYPERLINK("fake")',network:'A&B <Rede>',label:'Presença registrada'}],csv=model.csv(rows),xml=model.excel(rows);
  assert.match(csv,/"' =HYPERLINK/);assert.match(csv,/Data/);assert.match(xml,/ss:Type="String"/);assert.match(xml,/A&amp;B &lt;Rede&gt;/);assert.doesNotMatch(xml,/<Formula/);assert.equal(model.cells([]).length,1);
});
