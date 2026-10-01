# Filtros da aba Pedidos — 01/10/2026

## Uso

No topo de Pedidos, use a busca por rede, loja, setor, contato ou número do pedido. Clique em **Filtros** para combinar rede, loja, setor, situação e datas das diárias. **Limpar** remove todas as seleções.

As lojas disponíveis acompanham a rede escolhida; setores acompanham rede/loja. Mudar a rede remove uma loja incompatível. Fechar o painel de filtros mantém a seleção; filtros permanecem ao navegar entre abas e atualizar os dados durante a sessão, mas são reiniciados ao recarregar o site.

## Visão integrada

- Lista, cards e escala respondem à mesma seleção.
- O período considera as datas de trabalho, incluindo os limites inicial/final, e não a data de cadastro do pedido.
- Pedidos que atravessam o intervalo mostram apenas as datas e diárias correspondentes no resumo filtrado. A ficha continua mostrando o pedido completo.
- Contagem de pedidos não duplica um pedido por cada dia. Diárias são quantidade de pessoas por dia multiplicada pelos dias dentro do intervalo.
- O filtro aceita apenas início, apenas fim ou os dois. Um intervalo invertido mostra aviso e pode ser corrigido ou limpo.
- Escala mantém somente dias com diárias e sua paginação. Pedidos cancelados aparecem na lista quando selecionados e não geram escala ativa.
- As informações originais do pedido são preservadas: os filtros alteram a consulta na tela.

## Verificação

Fluxo novo aprovado em Chromium e WebKit, em 1280, 390 e 320 pixels: combinações de filtros, resultados vazios, intervalo válido/inválido, somente início/fim, quantidade de diárias no período, cards, escala, troca de rede, limpeza e fechamento do painel sem perder seleção.

Temas claro/escuro e largura móvel verificados. Campos dos filtros em telas pequenas usam fonte de 16px para evitar zoom automático ao focar; zoom de acessibilidade permanece disponível.

A suíte completa de navegação local também passou: abas e perfis, cadastro parcial, leitura, escala, pendências, financeiro, calendário e restauração. Testes usaram registros sintéticos em uma base isolada. Não houve alteração de pedidos reais em produção para testar os filtros.

Não houve migração do banco, alteração de permissões ou inclusão de serviço pago. Esta entrega verificou telas móveis emuladas, sem novo teste em aparelho físico.
