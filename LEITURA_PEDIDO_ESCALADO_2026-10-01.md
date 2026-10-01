# Leitura de pedido com diarista escalado — 01/10/2026

## Funcionamento

Cole a mensagem completa na aba Leitura IA. O sistema reconhece o pedido e o nome/CPF que aparecem abaixo dele.

- Cadastro existente: utiliza o CPF para encontrar a pessoa, confere o nome e escala em todas as datas do pedido.
- Cadastro inexistente: preserva a mensagem em uma pendência e oferece **Cadastrar diarista e salvar pedido**. A confirmação cria apenas nome e CPF, o pedido e suas escalas.
- Quantidade de diaristas omitida: um por dia. Data inicial e quantidade de dias geram as datas consecutivas; uma quantidade diferente de um intervalo explícito exige revisão.
- O exemplo Hipermarket / LOJA VILA UNIÃO / 03/10 / 2 dias é reconhecido como Vila União, 03 e 04/10/2026, 06:00–14:20.
- Mensagens de WhatsApp com asteriscos e mensagens em lote são reconhecidas. Fotos e PDFs usam o mesmo processamento após o OCR existente; baixa confiança mantém a revisão obrigatória.
- Releitura não duplica escalas. Pedido idêntico existente pode receber a vinculação, preservando sua grafia mesmo com diferenças de maiúsculas; dois pedidos idênticos exigem escolha manual para evitar vincular ao pedido errado.
- **Ver pedido e escala** abre o pedido salvo. Pendências continuam disponíveis após recarregar a página.

## Integridade e segurança

Cadastro, pedido, escalas e resolução da pendência são gravados em uma transação. Conflito no último dia desfaz as gravações dos dias anteriores e o novo cadastro/pedido da mesma operação.

A disponibilidade informada na mensagem se aplica àquele pedido. Experiência, endereço, mobilidade e disponibilidade geral não são inventados. Permanecem as verificações de CPF, identidade, bloqueio, vagas disponíveis, pedido encerrado e sobreposição de horários.

Escalar não marca presença e não gera pagamento. O financeiro continua usando os pedidos para previsão e as presenças/faltas para realização. Presença antecipada e mudança do registro de origem da disponibilidade são bloqueadas no banco.

A função do Supabase é SECURITY INVOKER, respeita RLS, exige autenticação e perfil admin/operação, utiliza caminho de busca fixo e não permite execução anônima. Financeiro e consulta não podem realizar esta gravação.

## Verificações

- 36 testes Python de backend e restauração aprovados, incluindo confirmação, cadastro básico, idempotência, identidade, conflito em dia posterior e ausência de cadastro órfão quando a vaga já está preenchida.
- 33 testes JavaScript aprovados, incluindo o formato enviado, datas, vários pedidos, CPF inválido, múltiplos nomes, nome sem CPF e mensagens com asteriscos em lote.
- Restauração operacional em SQLite isolado preserva o vínculo entre pedido, escala, diária e a disponibilidade específica do pedido.
- Testes SQL no Supabase executados com papel authenticated e perfil operação: confirmação, duas escalas, releitura, CPF/nome, vaga ocupada, conflito posterior, rollback completo e bloqueio de presença futura. Financeiro/consulta recusados; acesso anônimo ausente.
- Ensaios no Supabase terminaram com ROLLBACK; pessoas, pedidos e acessos de teste não ficaram cadastrados.
- Testes de navegador: Chromium e WebKit, desktop e telas de 390 e 320 pixels, cadastro sugerido, pendência após recarga, duas escalas, releitura e abertura do pedido. Verificação de navegação, perfis, financeiro, pendências e demais fluxos anteriores incluída na rotina de publicação.

## Limites e avisos existentes

A interpretação continua local e sem API paga. Formatos ambíguos ficam pendentes em vez de receber dados inventados. Este trabalho não adiciona serviços pagos.

Não foi executado um novo ensaio em aparelho físico nesta entrega: telas móveis foram verificadas em Chromium/WebKit. Fotos/PDFs seguem o OCR já existente; os novos testes desta entrega focam a mensagem textual e a gravação conjunta.

O Security Advisor mantém o aviso preexistente de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). O Performance Advisor informa 11 índices ainda sem uso, sem novos avisos de política RLS ou permissões desta funcionalidade. Índices não foram removidos apenas por falta de uso observado.

O exemplo real do usuário não foi cadastrado como ação operacional durante os testes. O fluxo fica disponível para envio na aba Leitura IA.
