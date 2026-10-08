"""Generate the shared, versioned business forms contract. No production access."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def field(name, label, type='text', required=False, **options):
    return dict(name=name, label=label, type=type, required=required, **options)

def ref(name, label, target, required=False):
    return field(name,label,'ref',required,target=target)

def choice(name,label,options,required=False):
    return field(name,label,'choice',required,options=options)

def number(name,label,required=False,**kwargs):
    return field(name,label,'integer',required,min=0,max=1000000,**kwargs)

def money(name,label,required=False):
    return field(name,label,'money',required,min=0,max=1000000000)

def day(name,label,required=False):
    return field(name,label,'date',required)

def text(name,label,required=False):
    return field(name,label,'textarea',required,maxLength=4000)

OP=['admin','operacao']; FI=['admin','financeiro']; ALL=['admin','operacao','financeiro','consulta']
specs={}
def entity(kind,label,area,fields,statuses=None,write=None,read=None,help='',**options):
    specs[kind]=dict(label=label,area=area,fields=fields,statuses=statuses or ['ativo','arquivado'],write=write or OP,read=read or (FI if area=='financeiro' else ALL),help=help,**options)

client=ref('cliente_id','Cliente contratante','cliente')
campaign=ref('campanha_id','Campanha','campanha')
order=ref('pedido_id','Pedido','pedido')
worker=ref('diarista_id','Diarista','diarista')
store=ref('loja_id','Loja/local cadastrado','loja')
date=day('data','Data',True)

entity('cliente','Cliente contratante','cadastros',[choice('segmento','Segmento',['supermercado','marca','agencia','eventos','terceirizacao','outro'],True),field('documento','CNPJ/documento'),field('responsavel','Responsável'),field('telefone','Telefone'),field('email','E-mail','email'),text('observacoes','Observações')],help='Quem contrata e paga. O local de execução pode pertencer a outra rede.')
entity('rede','Rede ou grupo de locais','cadastros',[client,choice('tipo','Tipo',['supermercado','shopping','evento','outro'],True),text('observacoes','Observações')],help='As redes já cadastradas continuam disponíveis e preservam seus links.')
entity('campanha','Campanha','campanhas',[ref('cliente_id','Cliente contratante','cliente',True),day('inicio','Início',True),day('fim','Fim',True),field('responsavel','Responsável',required=True),text('objetivo','Objetivo',True),text('briefing','Orientações gerais')],['planejada','em_execucao','concluida','cancelada'],help='Reúna pedidos, equipe, despesas e resultados de vários locais.')
entity('orcamento','Orçamento da campanha','financeiro',[ref('campanha_id','Campanha','campanha',True),money('orcamento_receita_centavos','Receita prevista',True),money('orcamento_custo_centavos','Orçamento de custo direto',True),text('premissas','Premissas e abrangência',True)],['rascunho','aprovado'],write=FI,read=FI,help='Valores da campanha inteira; compare com o realizado do período, sem tratar orçamento como recebimento.')
entity('movimento_caixa','Aporte ou retirada','financeiro',[ref('conta_id','Conta','conta',True),date,choice('tipo','Movimento',['aporte','retirada'],True),money('valor_centavos','Valor',True),field('responsavel','Responsável',required=True),text('justificativa','Justificativa',True)],['registrado'],write=FI,read=FI,help='Capital da empresa. Não integra a receita dos serviços nem a margem de contribuição.')
entity('cobranca_acompanhamento','Acompanhamento de cobrança','financeiro',[ref('cobranca_id','Cobrança','cobranca',True),date,choice('tipo','Acompanhamento',['contato','promessa','contestacao','resolucao'],True),day('promessa','Data prometida'),day('retorno','Próximo contato',True),field('responsavel','Responsável',required=True),text('registro','Registro e próxima ação',True)],['aberto','resolvido'],write=FI,read=FI)
entity('vinculo','Pedido da campanha','campanhas',[ref('pedido_id','Pedido','pedido',True),ref('campanha_id','Campanha','campanha',True)],['ativo'],help='Vincula um pedido existente sem recriar a equipe ou modificar valores antigos.',unique=['pedido_id'])
entity('tarefa','Tarefa e prazo','operacao',[order,client,campaign,field('responsavel','Responsável',required=True),field('supervisor','Supervisor para escalonamento'),field('prazo','Prazo','datetime',True),choice('prioridade','Prioridade',['alta','normal','baixa'],True),text('proxima_acao','Próxima ação',True),text('resolucao','Resolução')],['aberta','em_andamento','aguardando','concluida','cancelada'],help='Prazos vencidos aparecem destacados; concluir exige registrar a resolução.')
entity('fechamento','Fechamento diário','operacao',[date,client,campaign,order,field('responsavel','Conferido por',required=True),text('justificativa','Justificativa para pendências'),text('observacoes','Observações')],['rascunho','fechado'],help='Confira presenças, ocorrências e valores; pendências exigem justificativa.',unique=['data','pedido_id','cliente_id','campanha_id'])
entity('briefing','Orientações do serviço','operacao',[ref('pedido_id','Pedido','pedido',True),text('orientacoes','Orientações',True),field('uniforme','Uniforme'),field('entrada','Entrada/ponto de encontro'),ref('anterior_id','Versão anterior','briefing')],['rascunho','publicado'],help='Uma versão publicada fica preservada. Mudanças geram uma nova versão.')
entity('ciencia','Confirmação de leitura','operacao',[ref('briefing_id','Versão das orientações','briefing',True),ref('diarista_id','Diarista','diarista',True),field('confirmado_por','Quem registrou a confirmação',required=True),field('confirmado_em','Quando a pessoa confirmou','datetime',True)],['confirmado'],help='Registre a ciência efetivamente recebida da pessoa; não é confirmação automática.',unique=['briefing_id','diarista_id'])
entity('qualificacao','Qualificação / integração','cadastros',[ref('diarista_id','Diarista','diarista',True),choice('tipo','Tipo',['experiencia','treinamento','documento','integracao'],True),date,day('validade','Validade, se aplicável'),field('conferido_por','Conferido por'),text('observacoes','Observações')],['informada','conferida','revogada'],help='Diferencie a informação declarada da qualificação conferida.')
entity('checklist_modelo','Modelo de checklist','configuracoes',[field('funcao','Função/setor',required=True),field('perguntas','Perguntas, uma por linha; * indica obrigatória','lines',True),text('orientacoes','Quando utilizar')],write=OP,read=ALL,help='Use perguntas curtas. Para uma condição, escreva: Pergunta? [se campo=valor].')
entity('checklist','Checklist de execução','operacao',[ref('pedido_id','Pedido','pedido',True),date,ref('modelo_id','Modelo','checklist_modelo',True),worker,field('responsavel','Preenchido por',required=True),field('respostas','Respostas','answers',True),text('observacoes','Observações')],['rascunho','concluido'],help='As perguntas utilizadas ficam preservadas com as respostas.')
entity('visita','Visita de supervisão','operacao',[ref('loja_id','Loja/local','loja',True),day('data','Data prevista',True),field('responsavel','Supervisor',required=True),field('regiao','Região'),order,text('resultado','Resultado da visita'),text('proxima_acao','Próxima ação')],['planejada','realizada','cancelada'])
entity('observacao','Registro na loja','operacao',[ref('loja_id','Loja/local','loja',True),order,date,choice('tipo','Tipo',['ruptura','preco','exposicao','validade','outro'],True),field('produto','Produto/item',required=True),money('preco_centavos','Preço observado'),text('observacao','Observação',True)],['registrado','resolvido'],help='Registra o que foi observado no serviço; não substitui o estoque da loja.')
entity('feedback','Avaliação do atendimento','operacao',[order,client,store,date,number('nota','Nota de 1 a 5',True),field('responsavel','Quem avaliou',required=True),text('comentario','Comentário',True),text('retorno','Retorno ou contestação')],['recebido','respondido'],help='Registre contexto e resposta; avaliações não geram punição automática.')
entity('relatorio','Relatório para o cliente','operacao',[ref('cliente_id','Cliente destinatário','cliente',True),campaign,order,day('inicio','Início',True),day('fim','Fim',True),text('resumo','Resumo revisado',True),text('resultado','Resultado/entregas',True),field('aprovado_por','Revisado por')],['rascunho','aprovado'],help='Somente a versão aprovada é compartilhada; informações financeiras internas ficam de fora.')
entity('cronograma','Etapa do evento','campanhas',[ref('campanha_id','Campanha','campanha',True),store,choice('etapa','Etapa',['preparacao','montagem','atendimento','desmontagem'],True),field('inicio','Início','datetime',True),field('fim','Fim','datetime',True),field('responsavel','Responsável',required=True),text('orientacoes','Orientações')],['planejada','em_andamento','concluida','cancelada'])
entity('amostra','Resultado de degustação','campanhas',[ref('campanha_id','Campanha','campanha',True),store,order,date,field('produto','Produto',required=True),field('unidade','Unidade do produto',required=True),number('saldo_inicial','Unidades iniciais',True),number('recebidas','Unidades recebidas',True),number('distribuidas','Unidades utilizadas/distribuídas',True),number('perdas','Unidades perdidas',True),number('devolvidas','Unidades devolvidas',True),number('abordagens','Pessoas abordadas',True),number('porcoes','Porções servidas',True),number('vendas','Vendas observadas'),field('fonte_vendas','Origem da informação de vendas'),text('feedback','Feedback dos consumidores')],['registrado','conferido'],help='Unidades e porções são medidas diferentes. Vendas só entram com fonte identificada.')
entity('material','Material / kit / insumo','materiais',[choice('tipo','Tipo',['equipamento','uniforme','insumo'],True),field('unidade','Unidade',required=True),number('quantidade_inicial','Saldo inicial',True),field('local','Local de guarda'),text('observacoes','Observações')],help='Saídas e devoluções ficam em Movimentações, preservando o histórico.')
entity('lote','Lote e validade','materiais',[ref('material_id','Material','material',True),field('codigo','Código do lote',required=True),day('validade','Validade',True),number('antecedencia_dias','Antecedência do alerta',True)],help='Identifica o lote utilizado na movimentação; alerta por validade.')
entity('movimento','Movimentação de material','materiais',[ref('material_id','Material','material',True),ref('lote_id','Lote','lote'),campaign,worker,date,choice('tipo','Movimento',['entrada','entrega','devolucao','consumo','perda'],True),number('quantidade','Quantidade',True),field('responsavel','Responsável',required=True),text('condicao','Condição/observação')],['registrado'],help='O saldo é validado antes de registrar. Movimentos são preservados.')
entity('categoria','Categoria financeira','financeiro',[choice('tipo','Aplicação',['receita','despesa','aporte','retirada'],True),field('centro_custo','Centro de custo')],write=FI,read=['admin','financeiro','operacao'])
entity('despesa','Despesa do serviço','financeiro',[client,campaign,order,ref('categoria_id','Categoria','categoria',True),date,day('vencimento','Vencimento',True),money('valor_centavos','Valor',True),field('contraparte','Fornecedor/beneficiário',required=True),field('responsavel','Solicitado por',required=True),text('justificativa','Justificativa',True),day('data_pagamento','Data do pagamento'),field('forma','Forma do pagamento'),text('motivo','Motivo de recusa/correção')],['rascunho','enviada','aprovada','recusada','paga'],write=['admin','operacao','financeiro'],read=['admin','operacao','financeiro'],help='Operação solicita; Financeiro/Admin aprova. Aprovação cria um único lançamento vinculado.')
entity('conta','Conta bancária / caixa','financeiro',[field('instituicao','Banco/instituição',required=True),field('identificacao','Identificação sem senha',required=True),day('data_saldo','Data do saldo inicial',True),money('saldo_inicial_centavos','Saldo inicial',True)],write=FI,help='Não conecta ao banco nem movimenta dinheiro. Extratos são importados por arquivo.')
entity('pagamento_revisao','Conferência de pagamento','financeiro',[ref('diarista_id','Diarista','diarista',True),field('diaria_ids','Diárias pendentes a conferir','ids',True),day('data','Data prevista',True),field('responsavel','Preparado por',required=True),text('observacoes','Conferência/observações')],['preparado','aprovado','recusado','registrado'],write=FI,help='Confere beneficiário e diárias; registra os valores conferidos sem transferir dinheiro.')
entity('oportunidade','Oportunidade comercial','comercial',[ref('cliente_id','Cliente','cliente',True),field('responsavel','Responsável',required=True),day('retorno','Próximo retorno',True),text('necessidade','Necessidade do cliente',True),text('motivo','Motivo do resultado')],['interessado','levantamento','proposta','negociacao','ganha','perdida'],write=['admin','operacao'],read=['admin','operacao','financeiro'])
entity('proposta','Proposta comercial','comercial',[ref('cliente_id','Cliente','cliente',True),ref('oportunidade_id','Oportunidade','oportunidade'),campaign,ref('loja_id','Loja/local','loja',True),field('setor','Função/setor',required=True),day('inicio','Data inicial',True),number('dias','Quantidade de dias',True),number('pessoas','Pessoas por dia',True),field('hora_inicio','Horário inicial','time',True),field('hora_fim','Horário final','time',True),money('valor_unitario_centavos','Preço por diária',True),money('custo_unitario_centavos','Custo direto por diária',True),money('extras_centavos','Custos extras previstos',True),text('condicoes','Condições',True),ref('anterior_id','Versão anterior','proposta')],['rascunho','enviada','aprovada','perdida','convertida'],write=FI,read=FI,help='Versões enviadas são preservadas. Converter cria um único pedido com os valores contratados.')
entity('contato','Contato e relacionamento','comercial',[ref('cliente_id','Cliente','cliente',True),campaign,order,date,field('responsavel','Responsável',required=True),text('registro','Registro do contato',True),day('retorno','Próximo retorno')],['registrado'],read=['admin','operacao','financeiro'])
entity('frase','Vocabulário revisado','assistente',[text('entrada','Forma de falar',True),text('comando','Forma reconhecida/canônica',True),text('motivo','Correção revisada',True)],['rascunho','aprovada','arquivada'],write=['admin'],read=ALL,help='Exemplos aprovados ampliam o vocabulário; conversa não altera regras sozinha.')
entity('aviso','Aviso e confirmação de leitura','operacao',[client,order,choice('perfil','Destinatários',['todos','operacao','financeiro','consulta'],True),field('email','Destinatário específico','email'),text('mensagem','Mensagem',True),day('validade','Validade')],['publicado','arquivado'],write=['admin'],read=ALL)
entity('leitura_aviso','Leitura de aviso','operacao',[ref('aviso_id','Aviso','aviso',True)],['lido'],write=ALL,read=ALL,unique=['aviso_id','autor'])
entity('acesso','Escopo do funcionário','configuracoes',[field('email','E-mail do funcionário','email',True),ref('cliente_id','Cliente permitido','cliente',True),text('observacoes','Observações')],write=['admin'],read=['admin'],help='Quando houver escopos ativos, os novos módulos ficam restritos aos clientes permitidos. Não amplia o perfil existente.')
entity('regra','Regra de acompanhamento','configuracoes',[choice('tipo','Acompanhar',['tarefa_vencida','qualificacao_vencida','lote_vencido','cobranca_atrasada'],True),number('antecedencia_dias','Antecedência, em dias',True),field('responsavel','Responsável',required=True),text('acao','Ação sugerida',True)],write=['admin'],read=ALL,help='Gera alertas internos com base nos registros; não envia WhatsApp automaticamente.')

payload=dict(version=1,areas={'operacao':'Execução','financeiro':'Controle financeiro','campanhas':'Campanhas','comercial':'Comercial','materiais':'Materiais','cadastros':'Clientes e equipe','assistente':'Assistente','configuracoes':'Regras e acessos'},entities=specs)

def main():
    data=json.dumps(payload,ensure_ascii=False,indent=2)
    (ROOT/'static/enterprise-schema.json').write_text(data+'\n')
    (ROOT/'static/enterprise-contract.js').write_text('/* Generated by scripts/build_enterprise_schema.py. */\n(function(r){const schema='+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';if(typeof module!=="undefined"&&module.exports)module.exports=schema;else r.DirectEnterpriseSchema=schema;})(globalThis);\n')
    print(f'{len(specs)} typed business forms generated')

if __name__=='__main__':main()
