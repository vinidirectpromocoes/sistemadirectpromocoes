# Direct Promoções — oito melhorias em dois lotes

## Entregas

| Lote | Melhoria | Resultado e como usar |
|---|---|---|
| 1 · 1 | Financeiro mais claro | Previsão, diárias realizadas e caixa registrado distinguem escala, presença e movimentação efetiva. Seletor de dia, semana, mês ou todos sincroniza o período. Falta e exclusão atualizam a previsão. |
| 1 · 2 | Carregamento e listas | Leitura, backup e portais administrativos carregam quando necessários. Leituras simultâneas compartilham uma requisição; listas têm páginas de 25 registros, com totais completos. |
| 1 · 3 | Backup e recuperação | Rotina diária criptografada instalada no Mac às 02:15, cópia fora do projeto e espelho na pasta do iCloud, 30 versões. Histórico em Configurações e aviso na sidebar quando houver falha ou mais de 36 horas sem cópia verificada. Inclui dados, Auth, estrutura e código. |
| 1 · 4 | Edições sem perda de dados | Cadastro, pedido, loja e lançamento financeiro verificam a versão antes de salvar. Mudanças externas atualizam a tela; uma edição antiga apresenta conflito e mantém o texto digitado. |
| 2 · 5 | Busca global | Lupa na sidebar ou Ctrl/⌘ K. Pesquisa diarista por nome/CPF, loja por nome/endereço e pedido por número/rede/loja/setor/nome escalado. Abre diretamente o registro. Consulta não recebe cadastros de diaristas. Os resultados não exibem CPF. |
| 2 · 6 | Pendências acionáveis | Prioridade, responsável, próxima ação e adiamento de até 30 dias. Abra “Organizar” no item. “Adiadas” conserva o acompanhamento e “Retomar agora” devolve o item à lista. Adiar não altera presença, pagamento ou situação do pedido. |
| 2 · 7 | Substituição guiada | Sugestões com experiência, disponibilidade e conflitos verificados. Convite copiável com nome, endereço e todos os dias selecionados. Registra respostas e datas; permite substituir um dia ou os dias restantes da pessoa no pedido. Presenças, desistências e auditoria são preservadas. Resposta confirmada não gera pagamento. |
| 2 · 8 | Interface consistente | Controles compactos, foco visível, aviso compartilhado de sucesso/erro, indicador de salvamento, detalhes recolhidos, temas claro/escuro e telas estreitas. Inputs de 16 px no celular evitam o zoom automático ao digitar; zoom de acessibilidade continua permitido. Movimento reduzido é respeitado. |

## Aprovação e publicação

O lote 1 foi testado e publicado antes do início do lote 2: [PR 32](https://github.com/vinidirectpromocoes/sistemadirectpromocoes/pull/32), revisão final `01ca1d93a3e0f87e7db765dbc81711c843c1bed3`, execução GitHub Actions `37217633621`, merge `cc2d2cf8c0e04fccd7946a8510f84dbc6081509e`. A produção Vercel foi confirmada pronta nessa revisão e 33 arquivos foram comparados com a versão publicada.

O lote 2 usa a mesma barreira: testes locais, ensaios transacionais no Supabase, regressão completa no GitHub Actions e confirmação do deploy Vercel antes de encerrar. A revisão e a publicação finais constam nas evidências locais e no relatório de conclusão.

## Verificação

- 79 testes de regras JavaScript: financeiro, leitura, calendário, mensagens, matching, conciliação, CRM, backup e nova fila.
- 56 testes Python: servidor, validações, substituição, concorrência, criptografia e restauração. A restauração v8 verifica também responsáveis, próxima ação, respostas e datas dos novos registros.
- Busca → ficha, pendência → adiamento → retomada, convite → resposta → substituição em todos os dias: Chromium e WebKit, 1280, 390 e 320 px, nos dois temas, sem erros JavaScript ou largura excedida nos cenários executados.
- Regressão completa: navegação por perfil, cadastro, escala, presença/falta, financeiro, importação, portais separados, convites, lojas, agenda, modelos, mensagens, paginação e carregamento.
- Dez roteiros SQL no Supabase com rollback obrigatório: ciclo completo, automação, backups v6/v7/v8, recuperação/conflitos, cadastro externo, vagas, lojas e calendário. Testes não deixam cadastros, pedidos ou lançamentos sintéticos na produção.
- Substituição de vários dias com conflito no último dia: toda a transação volta ao estado anterior. Presenças já registradas são mantidas.
- Perfis admin/operação/financeiro/consulta, perfil desconhecido e anônimo: leituras/gravações indevidas são bloqueadas; backup e histórico de recuperação são restritos.
- Cópia automática persistida de 30 tabelas, 194 registros operacionais e um usuário Auth foi decriptada e restaurada em SQLite temporário; código verificado por hash. Identidades Auth também foram reidratadas em tabelas temporárias no PostgreSQL.

## Segurança e limites da verificação

Os novos controles têm RLS, checagem de perfil nas funções, privilégios revogados para anônimo e comparação de versão para organização e respostas. O histórico registra alterações de pendências e contatos de substituição.

A revisão do Advisor não apontou chaves estrangeiras sem índice. Existem avisos informativos de índices ainda sem uso. Os avisos de funções SECURITY DEFINER permanecem: funções de funcionários exigem perfil, e funções dos portais/backup sem login exigem convite ou segredo de alta entropia. Essas barreiras foram exercitadas nos roteiros SQL. As tabelas privadas sem políticas são intencionalmente inacessíveis diretamente.

A [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) continua desativada no provedor. Nenhum plano pago foi contratado para esta entrega. [Avisos de funções privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) devem continuar sendo revisados quando forem adicionadas funções.

Esta execução usa navegadores automatizados com telas móveis; não equivale a um novo teste físico em iPhone/Android. Não foi ensaiada a reconstrução de um projeto Supabase inteiro com infraestrutura do provedor. A cópia na pasta do iCloud foi verificada, mas a conclusão da sincronização remota do iCloud não foi medida. O backup depende do Mac ligado e com sessão acessível; a chave do Chaves precisa ser preservada para recuperar arquivos antigos.

**Conclusão:** as oito melhorias ficam aprovadas nos cenários executados após a regressão final. Testes aprovados sustentam esta entrega; não constituem garantia de ausência absoluta de defeitos em qualquer aparelho ou situação.

Consulte também [Recuperação](RECUPERACAO.md).
