/* Pure business helpers; no network, credentials or persistence. */
(function(root,factory){const schema=typeof module==='object'?require('./enterprise-contract.js'):root.DirectEnterpriseSchema;const model=factory(schema);if(typeof module==='object')module.exports=model;else root.DirectEnterpriseModel=model;})(globalThis,schema=>{
 'use strict';
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 function cents(raw,allowNegative=false){
  let s=String(raw??'').trim().replace(/^R\$\s*/,'').replace(/\s/g,'');
  if(/^\([\d.,]+\)$/.test(s))s='-'+s.slice(1,-1);
  if(!/^[+-]?\d+(?:[.,]\d+)*$/.test(s))throw Error('Informe um valor válido.');
  const sign=s.startsWith('-')?-1:1;s=s.replace(/^[+-]/,'');
  if(s.includes(',')){if(!/^\d+(?:\.\d{3})*,\d{1,2}$/.test(s))throw Error('Use até duas casas decimais.');s=s.replace(/\./g,'').replace(',','.');}
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Use até duas casas decimais.');
  const [a,b='']=s.split('.'),value=sign*(Number(a)*100+Number(b.padEnd(2,'0')));
  if(!Number.isSafeInteger(value)||Math.abs(value)>1000000000||!allowNegative&&value<0)throw Error('Valor fora do limite permitido.');
  return value;
 }
 function isoDay(value){let s=String(value??'').trim();if(/^\d{8}/.test(s))s=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);else if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))s=s.split('/').reverse().join('-');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Data inválida no arquivo.');return s;}
 function csv(text){
  text=String(text).replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0],sep=first.includes(';')?';':first.includes('\t')?'\t':',';let rows=[],row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw Error('Há aspas sem fechamento no CSV.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
 }
 function statement(text,name='',mapping=null){
  if(String(text).length>5000000)throw Error('Use um extrato com até 5 MB.');
  let lines=[];
  if(/\.ofx$/i.test(name)||/<OFX[>\s]/i.test(text)){
   const blocks=String(text).split(/<STMTTRN>/i).slice(1);
   const field=(b,k)=>new RegExp('<'+k+'>([^<\r\n]+)','i').exec(b)?.[1]?.trim()||'';
   lines=blocks.map(b=>({data:isoDay(field(b,'DTPOSTED')),valor_centavos:cents(field(b,'TRNAMT'),true),descricao:field(b,'MEMO')||field(b,'NAME'),identificador:field(b,'FITID')}));
  }else{
   const rows=csv(text);if(rows.length<2)throw Error('O arquivo precisa de cabeçalho e linhas.');
   const headings=rows.shift().map(norm),find=names=>headings.findIndex(h=>names.includes(h));
   const indexes=mapping||{data:find(['data','date','data movimento','data lancamento']),valor:find(['valor','amount','valor r$','valor (r$)']),descricao:find(['descricao','historico','description','memo']),identificador:find(['identificador','id','fitid','documento','referencia'])};
   if(indexes.data<0||indexes.valor<0||indexes.descricao<0)throw Object.assign(Error('Selecione as colunas de data, valor e descrição para revisar o CSV.'),{columns:headings});
   lines=rows.map((r,i)=>{try{return {data:isoDay(r[indexes.data]),valor_centavos:cents(r[indexes.valor],true),descricao:String(r[indexes.descricao]||'').trim(),identificador:indexes.identificador>=0?String(r[indexes.identificador]||'').trim():''};}catch(e){throw Error('Linha '+(i+2)+': '+e.message);}});
  }
  if(!lines.length||lines.length>500)throw Error('Importe de 1 a 500 linhas por arquivo. Divida um extrato maior.');
  if(lines.some(l=>!l.valor_centavos||l.descricao.length>500||l.identificador.length>180))throw Error('Confira linhas sem valor ou textos acima do limite.');
  return lines;
 }
 function canRead(kind,role){return Boolean(schema.entities[kind]?.read.includes(role));}
 function canWrite(kind,role){return Boolean(schema.entities[kind]?.write.includes(role));}
 function sampleBalance(d){return d.saldo_inicial+d.recebidas-d.distribuidas-d.perdas-d.devolvidas;}
 function budget(d){const revenue=d.dias*d.pessoas*d.valor_unitario_centavos,cost=d.dias*d.pessoas*d.custo_unitario_centavos+d.extras_centavos;return {revenue,cost,margin:revenue-cost,percent:revenue?(revenue-cost)/revenue*100:null};}
 function aging(invoices,today){const buckets=[{label:'A vencer',min:-Infinity,max:0,total:0,count:0},{label:'1–7 dias',min:1,max:7,total:0,count:0},{label:'8–30 dias',min:8,max:30,total:0,count:0},{label:'31–60 dias',min:31,max:60,total:0,count:0},{label:'Mais de 60 dias',min:61,max:Infinity,total:0,count:0}];for(const c of invoices){if(c.status==='cancelada')continue;const balance=c.valor_centavos-(c.valor_recebido_centavos||0);if(balance<=0)continue;const days=Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(c.vencimento+'T12:00:00Z'))/86400000),b=buckets.find(b=>days>=b.min&&days<=b.max);if(b){b.total+=balance;b.count++;}}return buckets;}
 function simulate({opening,receipts,payments,extra=0,delayed=0}){for(const v of [opening,receipts,payments,extra,delayed])if(!Number.isSafeInteger(v))throw Error('Valores inválidos para simulação.');return {base:opening+receipts-payments,scenario:opening+receipts-delayed-payments-extra};}
 function assistant(question,panel){
  const q=norm(question),finance=/financeir|custo|receita|margem|resultado|cobranc|atrasad|transporte|dinheiro/.test(q);
  if(finance&&panel.receita_real_centavos===undefined)return {message:'Seu perfil não tem acesso aos valores financeiros.',items:[]};
  const items=[];const brl=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
  if(/vag|descobert|cobertura/.test(q))items.push(['Vagas a preencher',String(Math.max(0,panel.demanda-panel.preenchidas))]);
  if(/presenc|falta|atend|penden/.test(q))items.push(['Presenças registradas',String(panel.presencas)],['Faltas',String(panel.faltas)],['Presenças a conferir',String(panel.presencas_pendentes)]);
  if(finance)items.push(['Receita de serviços realizados',brl(panel.receita_real_centavos)],['Custo das diárias',brl(panel.diarias_custo_centavos)],['Despesas diretas aprovadas',brl(panel.despesas_aprovadas_centavos)],['Margem de contribuição',brl(panel.margem_contribuicao_centavos)]);
  if(/cobranc|atrasad/.test(q))items.push(['Saldo de cobranças vencidas',brl(panel.saldo_atrasado_centavos)]);
  if(!items.length)items.push(['Diárias solicitadas no período',String(panel.demanda)],['Presenças registradas',String(panel.presencas)],['Presenças a conferir',String(panel.presencas_pendentes)]);
  return {message:`Consulta de ${panel.inicio} a ${panel.fim}. ${panel.registros_considerados} escala(s) consideradas. Valores ausentes continuam pendentes de conferência.`,items,sources:panel.fontes,updatedAt:panel.gerado_em};
 }
 return {schema,norm,cents,isoDay,csv,statement,canRead,canWrite,sampleBalance,budget,aging,simulate,assistant};
});
