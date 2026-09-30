# Início geral e CRM integrado — 30/09/2026

## Entrega

- Início com cards e gráficos de cadastros, lojas/redes, pedidos, presenças, faltas, cobertura, qualidade, pendências e previsão financeira. Listas de trabalho foram transferidas para o CRM.
- Filtro de previsão e atendimentos por dia, semana, mês ou todos os pedidos. Totais de cadastros e pendências continuam sendo totais atuais, conforme indicado no painel.
- CRM em quatro etapas: Em aberto, Confirmadas, Concluídas e Canceladas. Busca por nome, loja, rede ou setor; filtros por tipo, rede, período e prazo vencido.
- Cartões com acesso ao pedido, ficha, leitura, cobrança, lançamento, ocorrência ou contrato correspondente. Leituras permitem consultar o texto original e completar o formulário.
- Ferramentas recolhidas para próximas ações, plantão, reservas, qualidade e agenda/rascunhos do aparelho.
- Carregamento progressivo: quatro cartões por etapa em celular, oito no computador; botão Ver mais sem limitar o total de registros.

## Como os estados funcionam

O CRM deriva as etapas dos registros existentes, sem gravar um segundo status independente. Atualizar ou excluir o registro original atualiza o CRM ao voltar à aba, usar Atualizar ou retornar à janela.

Um pedido confirmado pode continuar com vagas ou presenças pendentes. A confirmação de disponibilidade não registra presença. Presença, validação da loja, cobrança e pagamento são etapas diferentes, apresentadas separadamente. Os contadores representam etapas, não pessoas nem pedidos únicos. Recebimentos parciais mostram o saldo restante; cobranças canceladas não duplicam lançamentos.

Cada perfil vê apenas as fontes permitidas. Valores financeiros, cobranças e contratos ficam restritos a admin/financeiro; leituras a admin/operação; consulta não recebe cadastros pessoais. As políticas existentes do banco continuam protegendo os dados.

## Verificações locais

- 27 testes Python: cadastros, pedidos, escala, presença/falta, tarifas, pagamentos, cobranças, contratos, ocorrências e recuperação de backup.
- 20 testes JavaScript: previsões, leitura, compatibilidade, conciliação, indicadores e novos estados/filtros do CRM.
- Navegação nas oito abas em Chromium e WebKit, larguras 1280, 390 e 320 pixels e paisagem 844 pixels.
- Perfis admin, operação, financeiro e consulta: visibilidade, ações e restrição das opções financeiras do CRM.
- Fluxos de revisão por OCR, registro/desfazer, cobrança parcial, pagamento agrupado, reservas, validação, contestação, repetição e rascunho offline.
- Persistência de escala em sete dias após salvar/recarregar, em computador e telas de celular nos dois motores.
- CRM: estados atualizados a partir do pedido, exclusão sem cartão residual, busca, filtros, Ver mais, abertura do pedido e abertura/complemento da leitura pendente.
- Início com dados: sem listas operacionais; quatro gráficos gerais; nenhuma rolagem horizontal indevida. Campos de filtro com pelo menos 16px no celular.

Os testes de gravação usam uma base SQLite isolada e dados fictícios. Chromium/WebKit com viewport de celular não substituem teste físico em iPhone/Android. Esta entrega não utiliza nova API paga nem altera presença, pagamento ou cadastro real para testar.

## Ajustes encontrados durante a implementação

- Novos arquivos JS/CSS adicionados à lista de recursos estáticos do servidor local e ao service worker.
- Correção do botão Atualizar que provocava transbordamento em WebKit móvel.
- Remoção do limite de 500 leituras no adaptador local; paginação integral no adaptador Supabase.
- Limpeza da visualização de CRM ao mudar de perfil e restrição imediata das ferramentas.
- Atualização dos testes que apontavam para listas antes localizadas no Início.

## Limites

O CRM acompanha atividades registradas no sistema. Não faz envio automático de WhatsApp, não inventa confirmação de disponibilidade, presença ou pagamento e não transforma confirmação de pedido em receita recebida. A atualização depende das alterações gravadas nos módulos de origem; também existe o botão Atualizar.
