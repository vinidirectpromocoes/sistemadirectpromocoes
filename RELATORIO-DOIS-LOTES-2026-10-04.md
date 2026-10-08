# Direct Promoções — entrega dos dois lotes

Data: 04/10/2026. Escopo: oito melhorias em dois lotes sequenciais. O lote 1 foi testado, integrado pela PR 30 e publicado antes de iniciar o lote 2. Nenhum serviço pago ou crédito de IA foi adicionado.

## Melhorias entregues

| Lote | Melhoria | Onde usar | Integração |
|---|---|---|---|
| 1 | Sugestão de diarista | Detalhes do pedido | Confere todos os dias restantes, experiência, deslocamento, conflitos, empresa atual e bloqueio. A operação escolhe e o servidor valida a escala. |
| 1 | Orientação específica da loja | Redes e lojas → Editar | Entrada, responsável, contato, apresentação, uniforme e orientação por setor aparecem nas mensagens daquele pedido. |
| 1 | Alerta por prazo | Pendências | Vagas/confirmacões a até 24h; urgência a até 2h; disponibilidade sem atualização há mais de 30 dias. |
| 1 | Modelos de pedidos | Pedidos → Modelos | Reaproveita setor, horários, quantidades e intervalos entre dias; abre rascunho para conferir antes de publicar. |
| 2 | Portal da loja | Redes e lojas → Link da loja | Solicitação de equipe e conferência da loja entram na revisão da Direct. Apenas pedidos daquela loja e nomes da equipe; sem CPF ou valores internos. |
| 2 | Resumo diário copiável | Pendências → Resumo do dia | Equipe, presenças, faltas, substituições, vagas de amanhã e ocorrências. |
| 2 | Agenda financeira | Financeiro → Agenda por vencimento | Entradas/saídas previstas por prazo e valores realizados pela data real. Preserva preços/prazos congelados, abate pagamentos e evita duplicar recebimentos vinculados. |
| 2 | Relatório mensal por loja | Redes e lojas → Relatório | Atendimento, presenças, faltas, desistências, substituições e ocorrências; copiar ou imprimir/salvar PDF. |

## Correções realizadas durante os testes

- Atualização das solicitações/conferências ao trocar de aba, retornar à página e após gravações.
- Sobreposição dos botões de modelos e solicitações em telas estreitas; ações agora têm ícones e nomes acessíveis.
- Conferência de presença integrada em duas etapas: gerar diária e depois validar a loja, respeitando as regras de estado do atendimento.
- Preservação das diárias pagas/cobradas: conferência contraditória não remove histórico nem marca a revisão como aplicada.
- Renovação/revogação de link reconferida após bloqueio de transação para não aceitar token antigo numa disputa entre operações.
- Sugestões ignoram conflitos de pedidos cancelados.
- Backup ampliado para 28 tabelas, preservando versões anteriores, vínculos e registros privados das lojas.
- Sincronização dos testes com a atualização financeira após pagamento; conferência de recarga isolada do service worker para evitar erros transitórios de acesso do WebKit. O teste de offline permanece separado.

## Evidência de testes

| Verificação | Resultado |
|---|---|
| Regras de negócio JavaScript | 76 testes aprovados |
| Backend Python e recuperação do backup | 49 testes aprovados |
| Regressão geral no navegador | 74 cenários registrados como aprovados |
| Lote 1, Chromium/WebKit em 1280/390/320px | 6 ciclos aprovados |
| Lote 2, Chromium/WebKit em 1280/390/320px | 6 ciclos aprovados |
| Cadastro externo, acompanhamento de links e vagas | 18 ciclos aprovados |
| Banco Supabase: ciclo completo, portais, calendário, modelos, backup v6/v7 e portal de loja | 8 roteiros SQL aprovados, com rollback |
| Perfis admin/operação/financeiro/consulta | Navegação, ações e permissões conferidas; ações novas incluídas no gate de publicação |
| Isolamento da loja | Rede forjada, outra loja, link inexistente/expirado/revogado e presença futura rejeitados |
| Financeiro integrado | Presença de R$134 gera diária de R$90; falta retira a diária; pagamento liquidado permanece protegido |
| Backup v7 | Snapshot consistente de 28 tabelas; restauração isolada com integridade referencial; referência quebrada rejeitada |

Os testes criaram dados sintéticos em bancos temporários e em transações revertidas no Supabase. A verificação final de produção encontrou zero cadastros, pedidos, diárias, lançamentos, modelos, solicitações, conferências e links de loja de teste; as 44 lojas permanecem preservadas.

A publicação segue PR → GitHub Actions no commit atual → merge → Vercel. A proteção de main foi conferida ativa, exigindo o check `test`. Os ciclos dos dois lotes foram adicionados ao fluxo de publicação.

## Segurança e limites verificados

- Links de lojas são segredos de acesso, expiram em 90 dias e podem ser renovados/revogados. Identificam a loja, não a pessoa que recebeu o link. Compartilhar apenas com o responsável.
- A loja envia propostas; presença/falta só afetam operação e financeiro após revisão da Direct. Não permite presença antecipada, alteração silenciosa de conferência aplicada ou remoção de diária paga.
- Os avisos do Advisor foram revisados: cinco tabelas privadas com RLS e sem políticas/grants são fechadas por projeto; 11 funções de portal acessíveis a anon e 22 funções de privilégio para authenticated exigem token ou perfil na própria função. Os testes negativos verificam essas barreiras. [Referência do Advisor](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- A proteção de senhas vazadas continua desativada no plano atual; não foi contratado um plano pago. [Recurso do Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Doze índices ainda sem uso foram mantidos: a operação foi limpa e não há volume representativo para concluir que são desnecessários. [Referência](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Os testes móveis usam motores Chromium/WebKit e emulação. Não houve novo teste em iPhone/Android físico nesta entrega. Impressão foi verificada no fluxo do navegador; o diálogo nativo e a impressora física não foram ensaiados.
- A agenda mostra o que possui data/valor configurados. Receitas avulsas sem vínculo não abatem previsão de pedidos; extras precisam ser lançamentos datados para entrar no caixa. Dias futuros no relatório não são presenças realizadas.
- Os limites dos serviços gratuitos continuam aplicáveis. Não há promessa de custos ilimitados para qualquer volume nem garantia de ausência absoluta de defeitos fora dos cenários testados.

## Próxima etapa operacional

Usar um pedido real do início ao pagamento: revisar → escalar → confirmar que vai → presença/falta → conferir os valores e vencimentos. Preencher orientações de cada loja e salvar modelos dos pedidos mais frequentes. O objetivo é validar a rotina com dados reais antes de ampliar automatizações.
