# Validação do sistema Direct Promoções — 29/09/2026

## Implementado

- Cópia criptografada com paginação ordenada, contagem consistente e lembrete da última verificação neste aparelho.
- Restaurador isolado em SQLite que descriptografa, valida as 11 tabelas, confere referências entre diaristas, pedidos, escalas e diárias, e recusa sobrescrever arquivos.
- Leitura de foto/PDF com revisão obrigatória abaixo de 75% de confiança e orientação prática para uma nova foto abaixo de 45%.
- Testes automáticos de backend, regras financeiras, navegador, perfis, telas móveis, leitura e exportação/restauração no GitHub Actions.
- Políticas RLS simplificadas, sem permissões SELECT redundantes; Consulta não lê valores de tarifas.

## Evidências de teste

| Área | Resultado |
| --- | --- |
| Backend local | 18 testes Python passaram. |
| Regras de previsão e leitura | 9 testes JavaScript passaram. |
| Navegação e formulários | Chromium e WebKit em 1280×800, 390×844, 320×640 e 844×390; sem rolagem horizontal nem campos de texto abaixo de 16 px no modo móvel. |
| Janela reduzida com foco no formulário | Botão Salvar continuou alcançável ao reduzir a altura para 420 px, simulando o espaço ocupado pelo teclado. |
| Interface por perfil | Admin, Operação, Financeiro e Consulta testados com sessão simulada e dados sintéticos. |
| Permissões no banco de produção | Perfis simulados em transações com `ROLLBACK`: Operação alterou pedido e não finanças; Financeiro fez o inverso; Consulta não alterou nenhum. Sem perfil, nenhuma leitura. Registros de teste remanescentes: zero. |
| OCR real, fora do navegador | Foto nítida 95%, PDF digitalizado 95%, foto degradada 31%; PDF com texto extraído sem OCR. Arquivos sintéticos, sem dados de pessoas reais. |
| Fluxo de leitura no navegador | 31% ficou em revisão; 95% registrou pedido sintético e permitiu desfazer. |
| Backup | Arquivo gerado no navegador, verificado no navegador e restaurado em SQLite isolado com contagem correta. Ensaio com dados sintéticos. |
| Supabase Advisor | Sem alertas de políticas RLS/performance nível WARN após ajuste. Restaram cinco índices sem uso (INFO) e o aviso de proteção contra senhas vazadas (WARN). |

## Limites ainda abertos

1. Não foi possível testar login real de Operação, Financeiro e Consulta: ainda não existem contas Auth desses perfis. A simulação SQL confirma o RLS, e o teste de navegador confirma a interface, mas não substitui o login real ponta a ponta.
2. Não foi possível testar em iPhone e Android físicos. WebKit e Chromium em tamanhos móveis e paisagem são aproximações. O acesso ao Safari deste computador continuou pendente na ferramenta de automação, apesar da autorização informada.
3. Não foi fornecida uma foto/PDF real de cadastro ou pedido. O OCR foi ensaiado em documentos de teste legíveis, degradados e digitalizados. A primeira amostra operacional real deve ser conferida antes de confiar no cadastro automático.
4. O ensaio de restauração usou uma cópia gerada com dados sintéticos. A cópia de produção ainda precisa ser baixada pelo administrador e ensaiada em computador confiável. A ferramenta restaura para SQLite isolado, não reimporta diretamente para o Supabase e não inclui usuários Auth.
5. O GitHub Actions roda em pull requests e após pushes em `main`. Sem uma regra obrigatória de proteção da branch, um push direto pode disparar o deploy da Vercel antes da conclusão dos testes.
6. A proteção de senhas vazadas está disponível apenas no Supabase Pro ou superior, segundo a documentação do fornecedor; o projeto está no plano Free. Não foi ativada para evitar custo.
7. O plano da Vercel não pôde ser confirmado pela integração. Se for Hobby, a documentação da Vercel restringe seu uso a projetos pessoais não comerciais. É preciso verificar o plano e, se necessário, migrar a hospedagem para uma opção compatível sem custo.

## Avaliação

**8,5/10.** O código, as permissões principais e os cenários automatizados estão consistentes. A nota fica abaixo de 10 por depender de testes físicos, logins reais dos funcionários, restauração operacional da cópia de produção e proteção efetiva do fluxo de publicação.

Fontes dos limites de plano: [Supabase Password Security](https://supabase.com/docs/guides/auth/password-security) e [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines).
