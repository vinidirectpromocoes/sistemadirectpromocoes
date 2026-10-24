# Direct Promoções — manutenção pela nuvem

Referência inicial conferida em **23/10/2026**, horário de Fortaleza. O proprietário pode pedir alterações pelo ChatGPT no celular; o trabalho técnico usa GitHub, Vercel e Supabase conectados. Este documento permite retomar o projeto em outro ambiente sem depender de arquivos do notebook.

## Projeto e endereços

| Componente | Alvo confirmado | Função |
| --- | --- | --- |
| Código | [vinidirectpromocoes/sistemadirectpromocoes](https://github.com/vinidirectpromocoes/sistemadirectpromocoes) | Fonte principal, histórico, PRs e testes |
| Produção oficial | [sistemadirectpromocoes-zeta.vercel.app](https://sistemadirectpromocoes-zeta.vercel.app/) | Sistema existente em uso pela equipe; manter este endereço nas entregas e verificações |
| Alias preexistente | `directpedidos.vercel.app` | Outro endereço do mesmo projeto, não é um sistema separado nem o endereço de referência do proprietário |
| Vercel | Equipe `sistemadirectpromocoes`, projeto `sistemadirectpromocoes` | Publicação de `static/` pela integração Git |
| ID da equipe Vercel | `team_kW55Rdvix5ihMK4ErsQ89HcF` | Escopo das operações remotas |
| ID do projeto Vercel | `prj_u9o6iYnsfh3Cym7hrK5aD19K0AhV` | Identificação exata da publicação |
| Supabase | Projeto `jxthqgtzybcyediyciqc`, região `sa-east-1` | PostgreSQL, autenticação e funções |
| Organização Supabase | `fhwbnlcyzhvmbffgxhpk` | Organização conectada |

O repositório `aplicativodirecto` também está disponível, mas estava vazio nesta conferência. Ele não é a origem confirmada do sistema publicado.

O proprietário reafirmou em 23/10/2026 que a manutenção deve continuar exclusivamente no sistema existente em `sistemadirectpromocoes-zeta.vercel.app`, preservando o endereço, o banco e os cadastros em uso. A conferência nas três ferramentas confirmou que os dois aliases acima resolviam a mesma publicação Vercel, do mesmo repositório, e que o adaptador servido em ambos apontava para o Supabase `jxthqgtzybcyediyciqc`. Não criar outro sistema ou copiar os registros para uma base nova para realizar melhorias. Dados pessoais e resultados de consultas aos cadastros não devem ser registrados neste repositório público.

## Estrutura de código

No ponto de partida havia 299 arquivos versionados: 85 em `static/`, 71 migrações, 67 arquivos em `tests/` e 27 arquivos Python entre raiz e scripts; os demais são documentos e configuração.

| Área | Arquivos principais |
| --- | --- |
| Entrada, autenticação e conexão remota | `static/index.html`, `static/app.js`, `static/remote.js` |
| Início e navegação | `static/hub.js`, `static/route-loader.js`, `static/hub.css` |
| Pedidos, escala e encerramento | `static/orders.js`, `static/operations.js`, `static/workflow.js`, `static/order-lifecycle-model.js` |
| Central do supervisor | `static/supervisor.js`, `static/supervisor-model.js`, `supervisor.py` |
| Diaristas, redes e lojas | `static/app.js`, `static/stores.js`, `catalogo_lojas.py` |
| Financeiro e calendários | `static/finance.js`, `static/forecast.js`, `static/payment-calendar.js`, `static/reconciliation.js` |
| Pendências e automação | `static/management.js`, `static/automation.js`, `static/crm-model.js` |
| Minha empresa | `static/enterprise*.js`, `static/enterprise*.css`, `enterprise.py`, `enterprise_actions.py` |
| Leitura e revisão de pedidos | `static/reading*.js`, `linked_reading.py` |
| Mensagens copiáveis | `static/messages.js`, `static/messages-model.js` |
| Cadastro e vagas por link | `static/cadastro.html`, `static/vagas.html`, `static/portal.js`, `static/portal-admin.js`, `static/vacancies-admin.js` |
| Portais de lojas e redes | `static/loja.html`, `static/rede.html`, `static/store-portal.js`, `static/network-links.js` |
| Configurações e acesso | `static/settings.js`, `static/settings.css`, `static/remote.js` |
| Offline e atualização no celular | `static/sw.js`, `static/offline.js`, `static/session-sync.js`, `static/manifest.webmanifest`, `static/mobile.css` |
| Backup e recuperação | `static/backup.js`, `static/backup-model.js`, `scripts/backup_agent.py`, `scripts/restore_backup.py`, `scripts/verify_recovery.py` |
| Banco e regras persistentes | `supabase/migrations/`, `scripts/enterprise_sql_*.sql` |
| Funções remotas | `supabase/functions/portal-cadastro/`, `supabase/functions/backup-evidencias/` |
| Testes pela nuvem | `.github/workflows/quality.yml`, `tests/`, `scripts/test_*_postgres.py` |
| Servidor isolado de desenvolvimento | `server.py` e módulos Python da raiz |

O site publicado chama o Supabase diretamente pelo adaptador `static/remote.js`. O servidor Python/SQLite serve ao desenvolvimento e aos ensaios. Rodá-lo não atualiza o banco de produção.

## Banco de dados confirmado

Foram identificadas **29 tabelas no schema `public` e 11 no `direct_private`**, todas com RLS habilitado na consulta de catálogo. Essa constatação não substitui uma auditoria de cada política. As tabelas internas gerenciadas pelo Supabase, como Auth e Storage, não estão incluídas nessa contagem.

| Grupo | Tabelas em `public` |
| --- | --- |
| Equipe e acesso | `diaristas`, `direct_admins`, `direct_staff` |
| Operação | `pedidos`, `pedido_escalas`, `pedido_modelos`, `lojas`, `ocorrencias`, `supervisor_registros` |
| Financeiro | `diarias`, `financeiro_lancamentos`, `cobrancas`, `cobranca_itens`, `cobranca_recebimentos`, `pagamento_lotes`, `custos_extras`, `contratos`, `tarifas_redes`, `tarifas_setores` |
| Leitura, cadastro e revisão | `leituras_pendentes`, `portal_cadastros`, `loja_solicitacoes`, `loja_validacoes`, `pendencia_acoes`, `substituicao_contatos` |
| Empresa e auditoria | `empresa_registros`, `empresa_extrato`, `empresa_anexos`, `direct_auditoria` |

No schema `direct_private`: `backup_agents`, `backup_runs`, `data_revision`, `empresa_compartilhamentos`, `loja_links`, `portal_config`, `portal_convites`, `portal_identity_limits`, `portal_registros`, `portal_vagas_link`, `rede_links`.

Foram listadas 71 migrações aplicadas no projeto remoto. Existem diferenças históricas entre versões/timestamps de arquivos e os registros remotos. Compare nome, conteúdo e efeito antes de planejar uma migração; não execute novamente toda a pasta em produção.

As Edge Functions `portal-cadastro` (versão 2) e `backup-evidencias` (versão 1) estavam ativas. Autorização de funcionários combina Supabase Auth e as permissões próprias da Direct. Links privados dos portais precisam continuar respeitando os escopos existentes.

## Como atualizar sem notebook

**Orientação do proprietário, 23/10/2026:** cada melhoria ou implantação solicitada neste chat deve ser concluída com testes, merge, deploy e conferência da publicação, dentro do escopo do pedido. Não é necessário pedir uma nova confirmação genérica de publicação a cada etapa. Mudanças fora do pedido, exclusões de dados e contratação de serviços exigem uma decisão própria.

1. O proprietário descreve a alteração e, quando útil, envia uma captura da tela pelo celular.
2. O assistente consulta a versão atual no GitHub e confirma os alvos Vercel/Supabase. Recria o checkout na nuvem se o ambiente anterior tiver expirado.
3. Implementa a mudança em branch `codex/...`, valida em ambiente isolado e abre PR com uma descrição objetiva.
4. Acompanha a execução **Qualidade antes da publicação** no commit final: `test`, `Navegação — Empresa`, `Navegação — Operação` e `Navegação — Assistente e portais`.
5. Após os checks aprovados, faz merge dentro do escopo autorizado, acompanha a publicação da Vercel e confere commit, ambiente e estado READY.
6. Se houver mudança de banco, a migração e sua verificação são etapas próprias no Supabase; merge no GitHub não aplica SQL nem publica Edge Functions automaticamente.
7. Entrega o link atualizado, o resultado dos testes e eventuais pendências. O proprietário confere o comportamento no próprio celular.

Cada push na `main` aciona a publicação pela integração Git da Vercel e o job **Publicação — produção** no GitHub. Esse job usa `scripts/verify_publication.py` para comparar, por conteúdo, todos os arquivos versionados de `static/` com o site online. Repetições breves permitem a propagação do deploy. Se outra mudança já avançou a `main`, a execução anterior informa `superseded`; a verificação da versão mais recente é a referência. O resultado fica no GitHub Actions. A conferência é somente de leitura e não precisa de credenciais administrativas da Vercel ou do Supabase.

O código e as configurações do site são publicados pela Vercel. Mudanças solicitadas no banco e nas Edge Functions continuam sendo executadas e verificadas pelo assistente no Supabase conectado, com as respectivas migrações/código registrados no GitHub. O deploy do site não é uma migração automática do banco. Uma atualização comum não exige alterar os três serviços quando apenas um deles é afetado.

A execução de qualidade pode ser iniciada manualmente pelo navegador do celular em **GitHub → Actions → Qualidade antes da publicação → Run workflow**, depois que a versão com `workflow_dispatch` estiver na branch principal. O workflow usa dados de teste e não executa a publicação nem migrações de produção.

Manutenção por conversa ocorre durante as tarefas solicitadas, enquanto as conexões estiverem disponíveis. Este fluxo não cria um agente permanente em segundo plano.

## Estado de referência da adoção

- Commit inicial de `main`: `6eaef68f2658197c3308c45e60ec05611eebd06f` (13/10/2026).
- Produção Vercel `dpl_4fuQkhTev1dyK5hYDUbeVpLsX1N7`: READY, origem Git, mesmo commit inicial.
- Última execução inicial de qualidade: [38408422647](https://github.com/vinidirectpromocoes/sistemadirectpromocoes/actions/runs/38408422647), concluída com sucesso.
- Branch `main` identificada como protegida, com check obrigatório `test`. A consulta de branches não comprova todas as opções administrativas de proteção.
- Supabase: `ACTIVE_HEALTHY` na conferência. Não houve alteração dos registros operacionais nesta preparação.

Esses identificadores descrevem o ponto de partida e devem ser reconferidos antes de uma nova tarefa.

## Dependência ainda existente: backup no Mac

A manutenção e publicação já usam serviços remotos. A rotina automática de recuperação descrita em `docs/RECUPERACAO.md` usa o Chaves e o agendamento do macOS; ela depende do Mac estar disponível.

O último registro encontrado em `direct_private.backup_runs` nesta conferência começou e terminou em **14/10/2026**, com estado `ok`, verificação confirmada e 3.539.719 bytes. O histórico prova a execução registrada; não prova disponibilidade atual do arquivo ou sua sincronização no iCloud. Não foi localizado um agendamento de backup na nuvem no workflow atual.

Portanto, não considerar o backup diário independente do computador. Para migrá-lo serão necessários destino privado para arquivos criptografados, credencial de leitura revogável, senha guardada de modo recuperável e ensaio de restauração. Não copiar credenciais do Mac para o código ou pedir que sejam publicadas nesta conversa. O backup manual já disponível em Configurações continua sendo uma alternativa para administradores, sujeito às validações do aplicativo.

## Regras operacionais a preservar

- Escalar ou confirmar compromisso não registra presença nem pagamento.
- Presença, falta, substituição e encerramento mantêm histórico e as proteções financeiras existentes.
- Valores congelados em diárias realizadas/pagas não devem ser recalculados por uma mudança de tarifa.
- Pagamento no sistema é registro financeiro; não significa transferência bancária.
- Mensagens copiáveis não enviam WhatsApp automaticamente.
- Links privados, dados pessoais e backups não pertencem ao repositório público.
- Consulte `README.md`, `WORK_LOG.md` e o código vigente para detalhes; relatórios antigos podem descrever comportamentos já substituídos.
