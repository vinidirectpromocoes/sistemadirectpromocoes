# Correção da seleção e salvamento da escala

Data: 30/09/2026.

O nome e as recomendações do diarista alargavam a coluna do seletor. O botão **Escalar** saía da largura do card e era recortado. Selecionar uma pessoa e salvar a edição do pedido não concluía a confirmação da escala.

## Alterações

- Coluna e seletor limitados à largura disponível; botão visível em computador e celular.
- Selecionar a pessoa abre a confirmação de um dia ou de todos os dias disponíveis do pedido.
- Cancelar limpa a seleção; a gravação tem aviso de sucesso visível.
- Falha ao atualizar a tela após uma gravação confirmada informa que a escala foi salva.
- Respostas de um pedido anterior não substituem as escalas de outro pedido aberto.
- Cache offline atualizado para receber a correção.

## Verificação

- Teste real na produção com o cadastro indicado e o pedido de FLV das 07h às 15h20, de 29/09 a 05/10: um dia salvo, depois seis dias em lote; sete registros conferidos no banco e mantidos após recarregar e reabrir.
- Nenhuma presença, falta, diária financeira ou pagamento foi lançado nesse teste real.
- Testes automatizados Chromium/WebKit em 1280, 390 e 320 pixels: botão dentro do card, confirmação, cancelamento, um dia, lote e persistência de sete dias.
- Falha simulada na consulta após gravar: mensagem correta e registro mantido após recarregar.
- Regressões de navegação, perfis, leitura, financeiro, operação, backup e offline verificadas pela suíte de navegador. Quinze testes de regras aprovados.
