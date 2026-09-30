# Financeiro — dashboards e períodos

Atualização de 30/09/2026.

## Implementado

- Todos os gráficos ficam antes das listas de pedidos, cobranças, pagamentos, conciliação e lançamentos.
- Cards de faturamento, custo das diárias e lucro das presenças confirmadas.
- Previsão de faturamento, custo, lucro bruto e lucro após extras estimados.
- Períodos: todos os pedidos, dia, semana (segunda a domingo) e mês do caixa. Atalhos Hoje e Esta semana; data editável para consultar outro dia ou semana.
- O mesmo período operacional filtra os cards, gráficos de previsão, pedidos incluídos, resultado por loja/setor e conciliação.
- Caixa e lançamentos continuam usando datas financeiras e seu filtro mensal próprio, identificado na tela.
- Presença registrada não significa valor recebido ou diária paga. Lucro confirmado desconta diárias e extras estimados; não inclui despesas gerais não cadastradas. Tarifas faltantes exibem aviso.
- Novas presenças, faltas, substituições e exclusões usam o cálculo existente e a atualização de dados do sistema. Valores congelados nas diárias realizadas permanecem preservados.
- Layout responsivo e temas claro/escuro; campos de data e seleção com tamanho adequado para evitar zoom automático no celular.

## Verificação concluída antes da publicação

- 15 testes de regras JavaScript: aprovação integral, incluindo totais confirmados, falta, exclusão, tarifas congeladas, dia e semanas entre meses/anos, conciliação e custos extras.
- 27 testes Python: aprovação integral.
- Suíte de navegação: Chromium e WebKit em 1280, 390, 320 e 844 pixels; sete abas, formulários, quatro perfis, leitura automática e backup.
- Financeiro em navegador com dados isolados: duas diárias, filtros de dia/semana/mês/todos, período vazio, posição dos gráficos, largura em 320 pixels, temas, cobrança, recebimento parcial e pagamento em lote.
- O teste de recarga aguarda requisições auxiliares antes da navegação, evitando interrupções de fetch no WebKit/Linux; a verificação de erros JavaScript segue ativa.
- Regressão de escala: um dia/todos os dias, cancelamento, botão visível com nome longo e persistência após recarregar em Chromium/WebKit, desktop e celular.
- Inspeção visual de screenshots do financeiro no desktop e celular em tema escuro.

Os testes de gravação usaram banco temporário isolado. Não criaram pagamentos, faltas ou presenças na produção. Chromium/WebKit emulados não substituem teste físico em Android/iPhone.

## Referência conferida no banco de produção

As duas presenças registradas em 29 e 30/09/2026 tinham R$ 268,00 de faturamento, R$ 180,00 de diárias e R$ 88,00 de lucro bruto, sem extras cadastrados. São valores de referência; a tela recalcula a partir dos registros reais, sem valores fixos no código.
