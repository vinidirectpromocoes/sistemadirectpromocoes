# Direct — verificação do ciclo completo

Executado em 03/10/2026, horário de Fortaleza. Código inicial: `9b85aa24094fca79b1f08996fe6c40d047d60d8e`.

## Resultado

Nenhuma falha funcional foi reproduzida nos cenários executados. Foram corrigidos dois índices ausentes nas chaves estrangeiras de convites no Supabase. O Advisor deixou de apontar chaves estrangeiras sem índice após a migração. Esta alteração preserva os dados, as permissões e os formulários.

## Ciclo verificado

| Etapa | Evidência | Resultado |
|---|---|---|
| Cadastro por convite | Nome, CPF, telefone normalizado, endereço, nascimento, setores, dias, horários e transporte persistiram. Cadastro não criou conta Auth. Convite incorreto, CPF inválido e duplicidade foram recusados. | Passou |
| Acompanhamento interno | Registro de origem apareceu na lista interna. Cadastro manual não foi confundido com cadastro pelo link. | Passou |
| Leitura e pedidos | Navegador local testou pedido com nome/CPF, revisão antes de gravar, correção, cancelamento, cadastro básico, escala completa e releitura sem duplicidade. | Passou |
| Divulgação | Pedido apareceu nos catálogos interno e externo; preenchimento retirou a vaga e preservou o pedido. Desistência reabriu vagas, cancelamento/exclusão retiraram a publicação e dias já encerrados não foram publicados. | Passou |
| Confirmação da escala | Cadastro válido confirmou todos os dias restantes. CPF alheio, trabalhador bloqueado, mesma empresa e conflito de horário foram recusados. Token compartilhado não permitiu assumir a vaga. | Passou |
| Presença e falta | Confirmar que vai não criou diária financeira. Presença criou diária; repetir presença não duplicou. Falta retirou diária ainda não paga. Presença futura foi recusada. | Passou |
| Financeiro | Duas presenças, em pedidos distintos, geraram R$ 268,00 de receita e R$ 180,00 de custo: lucro R$ 88,00. Ao corrigir uma presença para falta, a receita caiu para R$ 134,00. Calendário de pagamento e recebimento conferido. | Passou |
| Fechamento | Duas diárias foram reunidas em pagamento de R$ 180,00, com data e forma. Pagamento duplicado foi recusado. Diária paga não pôde ser removida por alteração de presença. Reabertura permitiu correção controlada. | Passou |
| Perfis e privacidade | Navegação admin/operação/financeiro/consulta, negações de acesso e tabelas privadas verificadas. Ensaio adicional usou papéis reais anon/authenticated nas operações de cadastro, aceite, presença inicial e fechamento. | Passou |
| Produção pelo navegador | Chromium e WebKit, largura 390 px: 7 vagas reais, WhatsApp correto, sem erro JavaScript e sem excesso de largura. Cadastro sem convite foi bloqueado. Nenhuma vaga real foi assumida. | Passou |

## Testes executados

- 55 testes automatizados de regras de negócio: todos passaram.
- 44 testes de backend e backup/restauração: todos passaram.
- `tests/e2e.mjs`: passou, incluindo Chromium/WebKit, larguras 1280/390/320, rotação 844×390, navegação por perfil, leitura, filtros, substituição, presença/falta e financeiro.
- `tests/portal_e2e.mjs`, `tests/portal_admin_e2e.mjs`, `tests/vacancies_e2e.mjs`: seis combinações de navegador/largura em cada suíte, todas passaram.
- `tests/portal_database.sql`, `tests/vacancies_database.sql` e `tests/full_cycle_database.sql`: executados no Supabase publicado com dados sintéticos e ROLLBACK. O último foi repetido após criar os índices e passou novamente.
- Conferência posterior: zero cadastros, pedidos ou acessos sintéticos permaneceram no banco publicado.

## Correção aplicada

Migração `20261004023428_portal_convites_foreign_key_indexes.sql` adicionou índices em `direct_private.portal_convites(criado_por)` e `(usado_por)`. Verificados no catálogo PostgreSQL. Não se afirma ganho medido de velocidade: a correção cobre os vínculos identificados pelo Advisor e evita varreduras desnecessárias conforme a base cresce.

## Pendências e limites

1. **Pinheiro e Variedades:** calendário das duas quinzenas ainda não informado. O sistema mantém o vencimento como não informado, sem inventar prazo. Os valores das diárias continuam configurados.
2. **Senhas vazadas:** proteção nativa do Supabase desativada. A documentação informa disponibilidade em Pro ou superior: https://supabase.com/docs/guides/auth/password-security. Nenhum plano ou serviço pago foi contratado.
3. **Avisos do Advisor:** RPCs SECURITY DEFINER do portal são intencionalmente acessíveis mediante token, e RPCs internas validam o perfil. Tabelas privadas têm RLS sem políticas diretas porque o acesso passa pelas RPCs. Foram mantidas essas proteções. Referências: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable e https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.
4. **Índices sem uso registrado:** avisos informativos permanecem; não foram apagados índices de integridade ou preparados para consultas futuras apenas por baixo uso atual.
5. **Aparelho físico:** nesta execução foram usados navegadores automatizados com telas móveis; não houve teste em iPhone/Android físico. O teclado foi representado por redução da área visível nos testes existentes.
6. **Limite da cobertura:** browser interno testado com backend local isolado; portal publicado conferido sem gravações persistentes; regras do Supabase testadas em transações revertidas. Nenhuma transferência bancária foi feita. Os resultados não garantem ausência de defeitos em entradas ou condições não ensaiadas.

## Continuidade operacional

O fluxo testado está apto ao uso: enviar convite individual, receber cadastro, registrar pedido, divulgar vagas, confirmar escala, registrar presença/falta e fechar o pagamento. Atualização em 04/10/2026: Pinheiro e Variedades foram configurados para pagamento na sexta/sábado da semana seguinte, com sábado como prazo final padrão (PR #28).
