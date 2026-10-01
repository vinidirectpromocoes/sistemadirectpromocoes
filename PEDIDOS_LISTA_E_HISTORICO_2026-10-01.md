# Pedidos em lista, desistência e substituição

## Entrega

- Removido o quadro semanal de cartões. A lista de pedidos mantém busca, filtros, resumo de datas e abertura dos detalhes.
- Adicionado botão de edição com caneta e nome acessível por pedido.
- Indicadores com brilho e pulsação lenta: vermelho para vaga não atendida, amarelo para turno em andamento com vaga, verde para equipe completa nas datas exibidas. Pedidos cancelados usam indicador neutro. Com redução de movimento ativada, os indicadores ficam estáticos.
- A ficha mantém presença e falta e oferece **Confirmou que vai**, **Desistência** e **Substituir**. Confirmar que vai registra a intenção para aquele dia; não registra presença nem gera pagamento.
- Desistência exige motivo e preserva pessoa, confirmação anterior, data, responsável e vínculo com a substituta. Uma desistência não é contada como falta.
- Substituição é uma operação atômica: se a nova escala falhar, a anterior permanece intacta. A disponibilidade para aquele dia e horário pode ser confirmada expressamente na substituição, sem alterar a disponibilidade geral da pessoa.
- O pedido atualiza sua situação conforme o preenchimento de todos os dias. A nova pessoa começa aguardando confirmação de ida; a presença continua sendo registrada separadamente.
- Previsões financeiras, pendências, conciliação, conflitos de horário, plantão e resumos consideram desistências como vagas sem atendimento até haver substituição. Somente presença gera diária a pagar.
- Os indicadores de pessoas distinguem faltas, desistências e desistências depois de confirmar que iria. Os registros ficam disponíveis para acompanhamento, sem bloqueio automático de pessoas.

## Verificação

- 41 testes Python aprovados: API, migração do SQLite com preservação de dados, desistência futura, proteção do histórico, substituição, repetição da requisição e reversão integral em erro.
- 39 testes JavaScript aprovados: cálculos, leitura, conciliação, disponibilidade, pendências, calendário de pagamentos e indicadores.
- Suíte completa de navegação aprovada em Chromium e WebKit, com telas de desktop e celulares emulados. O novo fluxo foi executado em 1280, 390 e 320 pixels nos dois motores, incluindo persistência após recarga, temas, largura e redução de movimento.
- Migração aplicada no Supabase. Teste com papel autenticado e perfil admin comprovou substituição, auditoria, reversão em erro, repetição sem duplicação e criação de diária apenas após presença. Todos os dados desse teste foram revertidos pela transação; nenhum cadastro de teste ficou na produção.
- A nova função de substituição usa as permissões do usuário e valida admin/operação. Acesso anônimo à função foi conferido e está bloqueado.
- O Security Advisor não apresentou novo alerta de banco. Permanece o aviso anterior sobre proteção contra senhas vazadas desativada.

## Limites da conferência

Os testes móveis desta entrega usam emulação de Chromium/WebKit; não representam uma nova sessão em aparelho físico. Nenhuma presença, falta ou desistência dos pedidos reais foi alterada durante a conferência. A aprovação dos testes acima é local e no banco; não equivale a afirmar que o workflow remoto de CI concluiu.
