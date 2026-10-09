# Auditoria e reorganização de Minha Empresa — 09/10/2026

A entrada foi transformada em um painel de navegação com nove áreas independentes. Cada área tem endereço próprio, título, instruções, categorias e ações específicas. O menu lateral reúne as áreas em um grupo que pode ser aberto ou recolhido. Os links antigos por tipo continuam funcionando.

## O que foi identificado e corrigido

1. **Busca e situação sem resposta:** o campo de busca e o seletor de situação não tinham eventos de filtragem. Agora consultam a categoria, voltam à primeira página e oferecem Limpar filtros.
2. **Tudo no mesmo espaço:** indicadores, formulários, extrato, caixa, treinamento e modelos experimentais apareciam juntos. Minha Empresa agora mostra os cards e os indicadores; cada área mostra seu próprio trabalho. Caixa tem página separada, extratos ficam com Contas, e recursos locais ficam em Assistente e consultas.
3. **Filtros com finalidade pouco clara:** período/rede/loja pertencem aos indicadores. Cliente e campanha dos cadastros passaram a ter filtros próprios. Trocar categoria limpa os filtros anteriores.
4. **Ações genéricas:** Novo registro foi substituído por Criar tarefa, Solicitar despesa, Cadastrar material, etc. Editar / atualizar situação explica a finalidade do formulário.
5. **Dependências e campos pouco claros:** cada categoria tem explicação e exemplo de título. Campos de referência têm rótulo independente da busca. Quando falta um cadastro obrigatório, o formulário explica o pré-requisito e oferece acesso à área correspondente.
6. **Exibição e exportação:** datas e horas são apresentadas no horário de Fortaleza; situações têm nomes legíveis. O CSV inclui os campos da categoria, apenas da página atual, com proteção contra fórmulas de planilha.
7. **Carregamento e concorrência:** respostas antigas não substituem a lista depois da troca de categoria ou filtro. O painel evita uma segunda consulta idêntica. Exportação fica indisponível durante a carga. Contas sem extrato limpam a paginação anterior.
8. **Guia da equipe:** atualizado com localização, benefício e uso dos 35 tipos de registro, além das responsabilidades de cada perfil.

## Evidências da navegação

Capturas desta execução, com base fictícia isolada, em `.design-qa/empresa-2026-10-09/`:

| Passo | Tela / ação | Antes | Depois | Evidência |
| --- | --- | --- | --- | --- |
| 1 | Entrada de Minha Empresa | Oito grupos de botões acima de um painel extenso; formulários abaixo | Nove cards com objetivo e acesso à área | 01-antes.png; 04-visao-geral-depois.png |
| 2 | Busca em Comercial | Texto inexistente manteve o registro visível | Busca, situação e limpeza exercitadas nos dois navegadores | 02-busca-sem-resposta.png; teste enterprise_workspace_e2e |
| 3 | Área financeira | Extrato e simulador apareciam até na categoria Orçamento | Despesas separadas de contas/extratos e de simulação | 03-financeiro-antes.png; teste enterprise_workspace_e2e |
| 4 | Execução | Tarefas misturadas com relatórios, avisos e indicadores | Página de execução com instruções e ações próprias | 05-execucao-depois.png |
| 6 | Materiais no celular | — | Navegação recolhida, categoria, filtros, ações e leitura em 390 px | 06-materiais-celular.png |
| 5 | Cadastro fictício de tarefa | — | Revisado, salvo e encontrado após atualizar, sem atingir a base real | Navegação manual e testes dos formulários |

## Inventário de categorias, ações e benefícios

| Área | Categoria | Botão principal | Para que serve / benefício | Verificação |
| --- | --- | --- | --- | --- |
| Clientes e equipe | Cliente contratante | Cadastrar cliente | Identifica quem contrata e paga pelo serviço. O nome da rede ou loja de execução pode ser diferente. | Detalhes e formulário verificados; gravação quando permitida. |
| Clientes e equipe | Rede ou grupo de locais | Cadastrar grupo de locais | Agrupa locais de execução. Consulte Redes e lojas antes de criar para evitar grupos repetidos. | Detalhes e formulário verificados; gravação quando permitida. |
| Clientes e equipe | Qualificação / integração | Registrar qualificação | Registra experiência, integração e validade das qualificações de um diarista já cadastrado. | Detalhes e formulário verificados; gravação quando permitida. |
| Comercial | Oportunidade comercial | Nova oportunidade | Registra a necessidade do cliente, responsável e próxima data de contato. | Detalhes e formulário verificados; gravação quando permitida. |
| Comercial | Contato e relacionamento | Registrar contato | Guarda o histórico da conversa e o próximo retorno ao cliente. | Detalhes e formulário verificados; gravação quando permitida. |
| Comercial | Proposta comercial | Criar proposta | Calcula receita e custo previstos. Depois de enviada, altere por Nova versão; uma proposta aprovada pode gerar um pedido. | Detalhes e formulário verificados; gravação quando permitida. |
| Campanhas e eventos | Campanha | Criar campanha | Agrupa serviços de uma ação para acompanhar prazos, pedidos, despesas e resultados. | Detalhes e formulário verificados; gravação quando permitida. |
| Campanhas e eventos | Pedido da campanha | Vincular pedido | Associa um pedido já existente à campanha sem duplicar equipe, diárias ou valores. | Detalhes e formulário verificados; gravação quando permitida. |
| Campanhas e eventos | Etapa do evento | Adicionar etapa | Planeja horário, local e responsável de uma etapa do evento. | Detalhes e formulário verificados; gravação quando permitida. |
| Campanhas e eventos | Resultado de degustação | Registrar degustação | Confere saldo inicial, recebimento, distribuição, perdas e devoluções. Vendas observadas precisam de fonte. | Detalhes e formulário verificados; gravação quando permitida. |
| Campanhas e eventos | Relatório para o cliente | Criar relatório | Prepara uma entrega revisada para o cliente. Apenas a versão aprovada recebe link de compartilhamento. | Detalhes e formulário verificados; gravação quando permitida. |
| Campanhas e eventos | Avaliação do atendimento | Registrar avaliação | Registra avaliação, contexto e resposta para melhorar o atendimento. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Tarefa e prazo | Criar tarefa | Define responsável, prioridade, prazo e próxima ação. Para concluir, registre a resolução. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Orientações do serviço | Criar orientações | Publica orientações de um pedido. Versões publicadas ficam preservadas e correções criam uma nova versão. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Checklist de execução | Preencher checklist | Registra respostas de execução usando um modelo já cadastrado. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Visita de supervisão | Registrar visita | Registra a supervisão de uma loja e permite abrir seu endereço. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Fechamento diário | Conferir fechamento | Confere o dia, as presenças e ocorrências; pendências exigem justificativa antes de fechar. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Registro na loja | Registrar observação | Guarda informações observadas na loja sem alterar o estoque do supermercado. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Confirmação de leitura | Registrar ciência | Registra a confirmação de leitura das orientações efetivamente recebida de um diarista. | Detalhes e formulário verificados; gravação quando permitida. |
| Execução e supervisão | Modelo de checklist | Criar modelo | Define as perguntas de uma conferência; o checklist preenchido preserva as perguntas e respostas utilizadas. | Detalhes e formulário verificados; gravação quando permitida. |
| Materiais e estoque | Material / kit / insumo | Cadastrar material | Identifica um kit ou insumo. O saldo é calculado pelas entradas, saídas e devoluções. | Detalhes e formulário verificados; gravação quando permitida. |
| Materiais e estoque | Lote e validade | Cadastrar lote | Identifica lote e validade de um material para rastrear o uso e acompanhar vencimentos. | Detalhes e formulário verificados; gravação quando permitida. |
| Materiais e estoque | Movimentação de material | Registrar movimentação | Registra entradas, saídas e devoluções. O sistema confere saldo antes de salvar e preserva o histórico. | Detalhes e formulário verificados; gravação quando permitida. |
| Despesas e caixa | Despesa do serviço | Solicitar despesa | Registra custo do serviço. Financeiro/Admin aprova e cria um único lançamento; solicitar não significa pagar. | Detalhes e formulário verificados; gravação quando permitida. |
| Despesas e caixa | Conferência de pagamento | Conferir pagamento | Seleciona diárias pendentes do diarista. Depois de conferir e aprovar, registre a quitação já realizada; não transfere dinheiro. | Detalhes e formulário verificados; gravação quando permitida. |
| Despesas e caixa | Aporte ou retirada | Registrar aporte ou retirada | Registra capital colocado ou retirado da empresa. Não trata aporte como faturamento do serviço. | Detalhes e formulário verificados; gravação quando permitida. |
| Despesas e caixa | Orçamento da campanha | Criar orçamento | Define receita e custo previstos da campanha inteira para comparação com os valores realizados. | Detalhes e formulário verificados; gravação quando permitida. |
| Despesas e caixa | Acompanhamento de cobrança | Registrar acompanhamento | Guarda contato, promessa de pagamento, contestação e próximo retorno de uma cobrança já criada no Financeiro. | Detalhes e formulário verificados; gravação quando permitida. |
| Despesas e caixa | Conta bancária / caixa | Cadastrar conta ou caixa | Identifica onde conferir movimentos. Não conecta ao banco; importe o extrato por CSV ou OFX e revise os vínculos. | Detalhes e formulário verificados; gravação quando permitida. |
| Despesas e caixa | Categoria financeira | Criar categoria | Organiza despesas por finalidade e permite solicitar custos com uma classificação consistente. | Detalhes e formulário verificados; gravação quando permitida. |
| Comunicados | Aviso e confirmação de leitura | Publicar aviso | Publica uma orientação para perfis ou uma pessoa; a leitura é confirmada pelo próprio destinatário. | Detalhes e formulário verificados; gravação quando permitida. |
| Comunicados | Leitura de aviso | Confirmar leitura | Registra sua leitura de um aviso existente. Você também pode usar Confirmar minha leitura no próprio aviso. | Detalhes e formulário verificados; gravação quando permitida. |
| Assistente e consultas | Vocabulário revisado | Adicionar expressão | Relaciona uma forma de falar a um comando reconhecido. Só expressões aprovadas pelo administrador são usadas. | Detalhes e formulário verificados; gravação quando permitida. |
| Regras e acessos | Regra de acompanhamento | Criar regra de alerta | Define alertas internos de prazo, qualificação, lote ou cobrança. Não envia mensagens automaticamente. | Detalhes e formulário verificados; gravação quando permitida. |
| Regras e acessos | Escopo do funcionário | Definir escopo por cliente | Restringe um funcionário já autorizado aos clientes permitidos nos novos módulos. A permissão geral continua valendo. | Detalhes e formulário verificados; gravação quando permitida. |

## Outros botões e fluxos conferidos

- **Atualizar, cards, menu lateral, mudar área, voltar, categorias:** navegação, títulos, conteúdo correspondente, links antigos e adaptação a celular.
- **Ver detalhes, editar, revisar, corrigir, fechar/cancelar, confirmar:** revisão antes da persistência e preservação de valores; versões de conteúdo publicado são preservadas.
- **Buscar, situação, limpar, cliente/campanha, anterior/próxima, exportar:** filtros reais, reinício da paginação, página com 25 registros e exportação da segunda página com cinco registros.
- **Histórico do cliente, resultados da campanha, preparar relatório:** consulta e preparo com vínculos existentes.
- **Gerar pedido:** proposta aprovada cria um pedido com valores contratados.
- **Conferir pagamento / registrar pagamento:** seleção de diárias pendentes, aprovação e registro em lote; é registro de quitação, não transferência bancária.
- **Fotos:** revisão, compressão, envio privado, metadados e leitura dos bytes persistidos.
- **Consultar saldo:** retorna saldo de material baseado no histórico.
- **Confirmar minha leitura:** registra ciência do próprio destinatário.
- **Extrato:** CSV, mapeamento de colunas, revisão, importação, paginação e conferência de vínculo. Importação não paga automaticamente.
- **Simular:** cenário calculado sem alterar os lançamentos.
- **Consultar dados:** resposta sobre o período com fontes e acesso ao pedido.
- **Treinamento:** exercício fictício sem salvar registros reais.
- **Recursos locais opcionais:** validação de entrada vazia/áudio ausente, parada e envio do texto para Leitura IA. O uso comum não inicia modelos.
- **Links do portal e relatório:** três serviços solicitados permanecem pendentes de aprovação; relatório público contém apenas conteúdo aprovado.

## Testes e limites

- 85 testes de backend e recuperação; 116 testes de regras de negócio aprovados.
- 35 categorias × dois navegadores × três larguras (1280, 390 e 320): detalhes e formulários; edição/revisão/gravação das categorias editáveis, cancelamento, treinamento, extrato e atualização.
- Testes adicionais das nove áreas, filtros, paginação/CSV, cores claras/escuras, permissões de Operação/Financeiro/Consulta e ferramentas contextuais.
- Integrações completas de foto, pagamento em lote, proposta → pedido, relatório aprovado, campanha, material e portal; regressão de desistência e substituição de diarista.
- Consulta com as permissões do administrador real confirmou acesso às 35 categorias na base publicada. Nenhum registro fictício foi criado na produção.
- A sessão do navegador isolado de produção pediu login. A navegação funcional foi exercitada na cópia local com o mesmo código; a base publicada foi consultada pela conexão administrativa existente.
- Inferência positiva dos modelos experimentais de voz/linguagem não foi certificada em todo aparelho. Depende do navegador, capacidade do dispositivo e disponibilidade dos arquivos externos; não equivale a um agente que executa todas as ações. Esses recursos são opcionais e sinalizados.
- Esta rodada não altera as regras de negócio, permissões gerais nem a estrutura do banco. Testes aprovados documentam os cenários exercitados, sem garantir ausência absoluta de erros futuros.

## Referências usadas na organização

A orientação de agrupar tarefas e permitir acesso pela finalidade foi apoiada pelo [GOV.UK: completar múltiplas tarefas](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/) e pelo [componente de lista de tarefas](https://design-system.service.gov.uk/components/task-list/). A organização por projetos, tarefas e etapas foi comparada à [documentação oficial do Odoo Project](https://www.odoo.com/documentation/18.0/applications/services/project.html). A separação de materiais e movimentações foi comparada à [documentação oficial de estoque do Odoo](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory.html). São referências de organização; não foi adicionada uma dependência desses sistemas.
