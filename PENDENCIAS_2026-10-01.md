# Pendências simples — Direct Promoções

## Alterações

- O CRM passou a se chamar **Pendências** na navegação e no título. O endereço anterior `#crm` continua funcionando.
- Três prioridades clicáveis: **Para hoje**, **Atrasadas** e **Aguardando retorno**. Os números correspondem à área selecionada e aos filtros aplicados; um item pode ter pendências de hoje e atrasadas em dias diferentes.
- Três áreas: **Operação**, **Financeiro** e **Cadastros**. O perfil financeiro inicia em Financeiro. As áreas e os dados respeitam os perfis existentes.
- Lista compacta, sem quadro de colunas. Cada pedido aparece uma vez em Operação; **Ver detalhes** mostra os dias e os motivos, com ações diretas.
- Ações claras: escalar/substituir diarista, conferir presença, validar atendimento, revisar leitura, completar cadastro e conferir cobrança.
- Escalas futuras já confirmadas continuam em Pedidos e não geram uma ação desnecessária nem um atendimento concluído no Histórico.
- Financeiro agrupa as diárias do mesmo diarista, separando valores pendentes dos pagos. O botão **Conferir diárias** abre os registros daquele grupo, inclusive após filtro por datas. Pessoas de mesmo nome e IDs diferentes não são somadas.
- Cobranças com recebimento parcial mostram o saldo. Conferência não significa recebimento nem pagamento.
- Concluídos e cancelados ficam no **Histórico**, com acesso ao registro original. A tela é derivada dos dados atuais; o histórico de alterações continua nas funcionalidades de auditoria existentes.
- Busca, rede e datas ficam recolhidos em **Filtrar**. A lista tem **Ver mais**; ferramentas de plantão, reservas, qualidade e rascunhos ficam recolhidas em **Ferramentas de apoio**.
- O resumo e o gráfico de pendências no Início usam os mesmos agrupamentos.
- Layout claro/escuro e celular, com campos de 16px para evitar zoom automático no foco. Zoom de acessibilidade permanece disponível.
- Corrigida a ordem de navegação/carregamento das ações para evitar abrir detalhes antes da carga da aba de destino.

## Verificação

- 29 testes de backend/restauração aprovados em base SQLite temporária isolada.
- 26 testes de regras de negócio aprovados, incluindo novos cenários de agrupamento, falta, cancelamento, saldo parcial, nomes iguais, datas em dias posteriores e separação de pagamentos.
- Fluxos automatizados em Chromium e WebKit: abas em 1280, 390, 320 e 844px; formulários com altura reduzida; quatro perfis; leitura com confiança baixa/alta; cobranças; pagamentos; reservas; contratos; rascunhos offline; escala de sete dias; cadastro parcial.
- A nova tela foi verificada nos dois motores em 1280, 390 e 320px: prioridades, áreas, detalhes, paginação, filtros, Histórico, abertura do pedido, revisão de leitura, grupo de diárias, cancelamento e exclusão em base de teste, temas e ausência de transbordamento horizontal.
- Capturas locais de teste em `.design-qa/pendencias-*`. Os dados dessas capturas são fictícios.
- Os cenários móveis são testes de navegador com dimensões de celular; não equivalem a uma nova conferência em aparelho físico.

## Publicação

A atualização passa pela suíte automatizada do GitHub antes da integração e publicação automática na Vercel. Não foram criados serviços pagos nem alterados cadastros, presenças ou pagamentos reais para os testes.
