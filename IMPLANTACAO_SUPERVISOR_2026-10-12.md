# Central do supervisor — implantação de 12/10/2026

O fluxo da Direct foi organizado em quatro espaços no menu Central do supervisor: Minha rotina, Extrato do diarista, Levantamento e faturamento, Atendimento e resultados.

## Uso

1. Minha rotina: escolha hoje, amanhã ou outra data; filtre rede/loja/setor. Acompanhar pedido abre as presenças, faltas, desistências e substituições existentes. Copiar equipe confirmada prepara texto com nome e CPF; não envia mensagens.
2. Extrato: escolha pessoa e pedido. Adiantamento registra pagamento já realizado e ainda não abatido; passagem registra reembolso real ainda não lançado em outra despesa. Não importe pagamentos antigos novamente. Conferir acerto mostra valores originais, passagens, crédito abatido e saldo. Confirmar registra a quitação realizada, sem transferência bancária.
3. Levantamento: escolha explicitamente o período acordado e a rede. O dia 15 é a data de entrega da empresa, não uma suposição de período 1–15. A prévia aponta valores incompletos, presenças pendentes e dias futuros. Concluir guarda uma cópia imutável. Baixe CSV para a revisão do financeiro; a nota fiscal continua a cargo do financeiro, fora deste fluxo. A ação não cria cobrança nem recebimento.
4. Indicadores: solicitadas, presenças, faltas, desistências e taxa dos dias encerrados. Falta coberta por substituição com presença não reduz o atendimento recomposto. Dia atual e dias futuros não entram na taxa dos dias encerrados. Os resultados financeiros usam receita de serviços, diárias, passagens e despesas registradas; receita realizada não significa dinheiro recebido.

## Preservação e exatidão

- Uma tabela separada, supervisor_registros, mantém movimentos e cópias. A migração não cadastra diaristas/pedidos/lojas nem reescreve pagamentos ou recebimentos antigos.
- A própria migração compara o conteúdo integral de dez tabelas essenciais antes/depois e interrompe se houver qualquer diferença.
- Valores originais de diárias permanecem intactos mesmo nos novos acertos. Caixa usa somente o saldo pago no acerto, mais o adiantamento já pago: não conta os dois novamente como custo.
- Créditos ficam vinculados ao pedido. Um crédito excedente não paga silenciosamente outro pedido. Continua visível para conferência.
- A prévia do acerto é revalidada na confirmação; alterações intermediárias exigem nova revisão. Chaves de operação impedem duplicação por repetição do envio.
- Uma quitação com adiantamento/passagem deve passar pelo extrato; os caminhos antigos recusam ignorar esses movimentos. Acertos ficam protegidos contra reabertura por outra tela.
- Anular registro incorreto acrescenta motivo e mantém a informação original. Movimentos já usados em acerto ficam preservados. Anulação de registro não equivale a estorno bancário.
- Backup v11 inclui a nova tabela. Cópias anteriores v10 continuam aceitas e não são apagadas.

## Verificação

Cenários: presença ligada à diária; adiantamento de R$30 + passagens de R$20 + duas diárias de R$100 → saldo R$190 e saída acumulada R$220. Os valores originais das diárias e receita foram comparados antes/depois. Também são exercitados crédito excedente, pedido diferente, anulação, repetição, prévia desatualizada, autenticação/perfis, fechamento congelado, ausência de cobrança automática, CSV, temas e larguras 1280/390/320 em Chromium e WebKit.

O banco real é testado em PostgreSQL isolado pela verificação contínua, antes da aplicação da migração na produção. O ambiente PostgreSQL empacotado deste Mac não contém pgcrypto; não foram usados substitutos para simular a validação financeira. O banco do sistema recebe somente a migração aditiva aprovada; testes fictícios ficam em bases separadas.

Os recebimentos históricos, valores pagos, cadastros e dados de redes/lojas não são alterados por esta implantação. A rotina nova é adotada mediante registros e confirmações futuras do usuário. Nenhum funcionário foi autorizado nem nenhum dado foi enviado para os grupos ou para destinatários externos.
