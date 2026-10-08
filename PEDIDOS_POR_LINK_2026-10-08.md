# Pedidos por link das redes

Abra **Pedidos por link** e clique no card da rede. Cada rede tem uma página própria com **Copiar link**, contadores e histórico exclusivo de solicitações. Use a busca por loja, setor ou solicitante e o filtro de situação para localizar pedidos aguardando revisão, registrados ou recusados. Conferências pendentes também aparecem apenas no espaço da rede correspondente.

O endereço é curto: `https://directpedidos.vercel.app/r/<código>`. É fixo e não vence. Atualizar a página, receber novos pedidos ou cadastrar novas lojas da rede não altera o endereço. Os botões de gerar, renovar e revogar foram removidos dessa função. Os códigos têm 96 bits aleatórios; o nome da rede não permite descobrir seu endereço. Links antigos de rede ainda ativos continuam funcionando, sem expiração; links antigos anteriormente revogados não são reativados. Links anteriores por loja seguem suas regras originais.

No portal, o responsável escolhe a loja e informa setor, data inicial, quantidade de dias, horários de início/fim, diaristas por dia, contato e orientações. O resumo mostra período e total de diárias antes de enviar. A pessoa também pode acompanhar solicitações, pedidos e equipe da loja escolhida e enviar conferências para revisão. O formulário foi preservado.

Clique em **Revisar pedido**, confira os dados e salve para registrar o pedido; ou recuse informando o motivo. Pedidos registrados permitem abrir seu atendimento. O envio externo não publica vagas nem confirma presença automaticamente.

Administrador e Operação gerenciam os links e as revisões. Financeiro e Consulta não recebem acesso aos códigos. O portal externo não mostra CPF, dados financeiros ou lojas de outra rede. Os links são privados: quem recebe o endereço pode acessar as lojas daquela rede. Não há contas individuais dos solicitantes nesta modalidade.

Não foi adicionado serviço pago nem encurtador externo. O domínio curto é um endereço gratuito da hospedagem existente. Os limites atuais de hospedagem/banco continuam aplicáveis. Em futuras publicações, mantenha **sistemadirectpromocoes-zeta.vercel.app** e **directpedidos.vercel.app** apontando para a mesma versão aprovada, com a regra `/r/:codigo` → `/rede.html`.

Validação: testes de isolamento entre redes e lojas, idempotência, revisão, estabilidade do código após atualização e vencimento antigo, proteção de links previamente revogados e backup v9; fluxo em Chromium/WebKit nas larguras 1280, 390 e 320; ensaio no banco com registros sintéticos revertidos ao final. O backup inclui os códigos permanentes e o código-fonte da nova rota.
