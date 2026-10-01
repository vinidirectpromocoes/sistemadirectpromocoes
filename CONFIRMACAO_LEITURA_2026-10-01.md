# Confirmação de pedidos com diarista — 01/10/2026

A leitura que inclui pedido, nome e CPF grava o vínculo do diarista em todas as datas do pedido e agora atualiza sua situação na mesma transação. Todas as vagas preenchidas: Confirmado. Se o pedido solicita mais pessoas e ainda há vagas: Em seleção. Cadastro desconhecido mantém a sugestão de cadastro básico antes da gravação.

A lista de Pedidos mostra o nome das pessoas escaladas, respeitando as datas dos filtros. A ficha mantém o detalhamento de cada dia. Confirmar a escala não registra presença nem pagamento; esses controles continuam ligados ao trabalho realizado.

## Correção de dados

Reconciliação restrita a pedidos importados pela leitura (chave de operação presente), em Novo/Em seleção, com todas as vagas preenchidas. Em produção, o pedido Hipermarket/Vila União de Enderson Lopes ficou Confirmado, com duas escalas preservadas. Nenhuma presença ou pagamento foi criado.

## Testes

- 37 testes Python aprovados, incluindo confirmação, releitura, identidade, bloqueio, conflitos, transação e pedido para duas pessoas que só confirma quando a segunda é escalada.
- 38 testes JavaScript aprovados.
- Suíte completa E2E local aprovada em Chromium e WebKit, incluindo o fluxo de leitura em 1280, 390 e 320 pixels, nome/situação na lista e persistência após recarregar.
- Função PostgreSQL verificada sob o papel authenticated em transação revertida: parcial Em seleção, completo Confirmado, releitura sem novas escalas e nenhuma diária financeira gerada.
- Nenhum registro sintético permaneceu em produção.
- Função continua SECURITY INVOKER, sem execução para anon e com as permissões existentes. Advisor sem novos avisos de banco; permanece o aviso já conhecido de proteção de senhas vazadas desativada.

Testes móveis desta entrega são emulados; não representam novo teste em aparelho físico. O GitHub CI é independente destes resultados locais.
