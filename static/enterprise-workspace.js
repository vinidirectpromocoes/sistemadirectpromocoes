/* Navigation and guidance only: existing data contracts and permissions stay authoritative. */
(function(root,factory){const value=factory();if(typeof module==='object')module.exports=value;else root.DirectEnterpriseWorkspace=value;})(globalThis,()=>{
 'use strict';
 const areas={
  cadastros:{label:'Clientes e equipe',description:'Cadastre quem contrata a Direct e acompanhe a qualificação dos diaristas.',steps:'Comece pelo cliente contratante. As fichas dos diaristas ficam em Diaristas e as lojas em Redes e lojas.',kinds:['cliente','rede','qualificacao']},
  comercial:{label:'Comercial',description:'Acompanhe oportunidades, contatos e propostas até gerar um pedido aprovado.',steps:'Cliente → oportunidade → proposta → aprovação → gerar pedido. A proposta enviada mantém seu conteúdo preservado.',kinds:['oportunidade','contato','proposta']},
  campanhas:{label:'Campanhas e eventos',description:'Reúna pedidos, etapas, degustações e relatórios de uma ação para o cliente.',steps:'Cliente → campanha → vincular pedidos existentes → registrar resultados → revisar o relatório para o cliente.',kinds:['campanha','vinculo','cronograma','amostra','relatorio','feedback']},
  operacao:{label:'Execução e supervisão',description:'Organize tarefas, orientações, visitas e conferências do serviço.',steps:'Pedidos e presenças continuam em Pedidos. Use esta área para acompanhar a execução e registrar o que foi conferido.',kinds:['tarefa','briefing','checklist','visita','fechamento','observacao','ciencia','checklist_modelo']},
  materiais:{label:'Materiais e estoque',description:'Controle kits, insumos, lotes, validade, saídas e devoluções.',steps:'Material → lote, quando necessário → entrada → saída ou devolução. O saldo vem das movimentações registradas.',kinds:['material','lote','movimento']},
  financeiro:{label:'Despesas e caixa',description:'Solicite e confira despesas, pagamentos, aportes e extratos.',steps:'Cadastre as categorias antes de solicitar despesas. Financeiro/Admin aprova; os lançamentos e cobranças ficam no Financeiro.',kinds:['despesa','pagamento_revisao','movimento_caixa','orcamento','cobranca_acompanhamento','conta','categoria']},
  equipe:{label:'Comunicados',description:'Publique avisos internos e acompanhe quem confirmou a leitura.',steps:'Publique o aviso para o perfil ou e-mail correto. Cada pessoa confirma sua própria leitura.',kinds:['aviso','leitura_aviso']},
  assistente:{label:'Assistente e consultas',description:'Consulte os dados da operação e mantenha expressões revisadas para a Leitura IA.',steps:'Faça uma pergunta sobre os indicadores do período. Para cadastrar ou alterar dados, abra Leitura IA e revise a ação.',kinds:['frase']},
  configuracoes:{label:'Regras e acessos',description:'Defina alertas e o acesso de funcionários aos clientes dos novos módulos.',steps:'As permissões gerais são autorizadas em Configurações. O escopo por cliente restringe esse acesso; não cria uma nova conta.',kinds:['regra','acesso']}
 };
 const guides={
 cliente:['Cadastrar cliente','Identifica quem contrata e paga pelo serviço. O nome da rede ou loja de execução pode ser diferente.','Ex.: Marca contratante'],
 rede:['Cadastrar grupo de locais','Agrupa locais de execução. Consulte Redes e lojas antes de criar para evitar grupos repetidos.','Ex.: Rede de supermercados'],
 qualificacao:['Registrar qualificação','Registra experiência, integração e validade das qualificações de um diarista já cadastrado.','Ex.: Integração para reposição'],
 oportunidade:['Nova oportunidade','Registra a necessidade do cliente, responsável e próxima data de contato.','Ex.: Ação de fim de semana'],
 contato:['Registrar contato','Guarda o histórico da conversa e o próximo retorno ao cliente.','Ex.: Reunião de alinhamento'],
 proposta:['Criar proposta','Calcula receita e custo previstos. Depois de enviada, altere por Nova versão; uma proposta aprovada pode gerar um pedido.','Ex.: Proposta para degustação'],
 campanha:['Criar campanha','Agrupa serviços de uma ação para acompanhar prazos, pedidos, despesas e resultados.','Ex.: Campanha de lançamento'],
 vinculo:['Vincular pedido','Associa um pedido já existente à campanha sem duplicar equipe, diárias ou valores.','Ex.: Pedido da unidade Centro'],
 cronograma:['Adicionar etapa','Planeja horário, local e responsável de uma etapa do evento.','Ex.: Montagem do espaço'],
 amostra:['Registrar degustação','Confere saldo inicial, recebimento, distribuição, perdas e devoluções. Vendas observadas precisam de fonte.','Ex.: Degustação na unidade Centro'],
 relatorio:['Criar relatório','Prepara uma entrega revisada para o cliente. Apenas a versão aprovada recebe link de compartilhamento.','Ex.: Resultado do atendimento'],
 feedback:['Registrar avaliação','Registra avaliação, contexto e resposta para melhorar o atendimento.','Ex.: Retorno do responsável da loja'],
 tarefa:['Criar tarefa','Define responsável, prioridade, prazo e próxima ação. Para concluir, registre a resolução.','Ex.: Confirmar equipe da manhã'],
 briefing:['Criar orientações','Publica orientações de um pedido. Versões publicadas ficam preservadas e correções criam uma nova versão.','Ex.: Orientações para a equipe'],
 checklist:['Preencher checklist','Registra respostas de execução usando um modelo já cadastrado.','Ex.: Conferência de início do serviço'],
 visita:['Registrar visita','Registra a supervisão de uma loja e permite abrir seu endereço.','Ex.: Visita de supervisão'],
 fechamento:['Conferir fechamento','Confere o dia, as presenças e ocorrências; pendências exigem justificativa antes de fechar.','Ex.: Fechamento do dia'],
 observacao:['Registrar observação','Guarda informações observadas na loja sem alterar o estoque do supermercado.','Ex.: Ocorrência na exposição'],
 ciencia:['Registrar ciência','Registra a confirmação de leitura das orientações efetivamente recebida de um diarista.','Ex.: Ciência das orientações'],
 checklist_modelo:['Criar modelo','Define as perguntas de uma conferência; o checklist preenchido preserva as perguntas e respostas utilizadas.','Ex.: Conferência de uniforme e entrada'],
 material:['Cadastrar material','Identifica um kit ou insumo. O saldo é calculado pelas entradas, saídas e devoluções.','Ex.: Kit de degustação'],
 lote:['Cadastrar lote','Identifica lote e validade de um material para rastrear o uso e acompanhar vencimentos.','Ex.: Lote de amostras'],
 movimento:['Registrar movimentação','Registra entradas, saídas e devoluções. O sistema confere saldo antes de salvar e preserva o histórico.','Ex.: Entrega de kit para a equipe'],
 despesa:['Solicitar despesa','Registra custo do serviço. Financeiro/Admin aprova e cria um único lançamento; solicitar não significa pagar.','Ex.: Transporte da equipe'],
 pagamento_revisao:['Conferir pagamento','Seleciona diárias pendentes do diarista. Depois de conferir e aprovar, registre a quitação já realizada; não transfere dinheiro.','Ex.: Conferência de diárias da semana'],
 movimento_caixa:['Registrar aporte ou retirada','Registra capital colocado ou retirado da empresa. Não trata aporte como faturamento do serviço.','Ex.: Aporte no caixa'],
 orcamento:['Criar orçamento','Define receita e custo previstos da campanha inteira para comparação com os valores realizados.','Ex.: Orçamento da campanha'],
 cobranca_acompanhamento:['Registrar acompanhamento','Guarda contato, promessa de pagamento, contestação e próximo retorno de uma cobrança já criada no Financeiro.','Ex.: Retorno sobre cobrança'],
 conta:['Cadastrar conta ou caixa','Identifica onde conferir movimentos. Não conecta ao banco; importe o extrato por CSV ou OFX e revise os vínculos.','Ex.: Caixa da empresa'],
 categoria:['Criar categoria','Organiza despesas por finalidade e permite solicitar custos com uma classificação consistente.','Ex.: Transporte'],
 aviso:['Publicar aviso','Publica uma orientação para perfis ou uma pessoa; a leitura é confirmada pelo próprio destinatário.','Ex.: Orientação para supervisores'],
 leitura_aviso:['Confirmar leitura','Registra sua leitura de um aviso existente. Você também pode usar Confirmar minha leitura no próprio aviso.','Ex.: Aviso lido'],
 frase:['Adicionar expressão','Relaciona uma forma de falar a um comando reconhecido. Só expressões aprovadas pelo administrador são usadas.','Ex.: Forma de pedir uma presença'],
 regra:['Criar regra de alerta','Define alertas internos de prazo, qualificação, lote ou cobrança. Não envia mensagens automaticamente.','Ex.: Acompanhar tarefas vencidas'],
 acesso:['Definir escopo por cliente','Restringe um funcionário já autorizado aos clientes permitidos nos novos módulos. A permissão geral continua valendo.','Ex.: Atendimento de um cliente']
 };
 const areaFor=kind=>Object.keys(areas).find(k=>areas[k].kinds.includes(kind));
 const readable=(key,schema,role)=>areas[key]?.kinds.filter(k=>schema.entities[k]?.read.includes(role))||[];
 return {areas,guides,areaFor,readable};
});
