# Melhorias aprovadas — outubro de 2026

## Ordem de execução
Lote 1: financeiro, carregamento, backup, concorrência. Publicar e verificar antes do lote 2.
Lote 2: busca global, fila de pendências, substituição guiada, interface consistente.

Critérios: testes de cálculo e persistência; testes no Chromium e WebKit móvel/desktop; permissões no Postgres; publicação vinculada ao commit testado. Sem contratação de serviços. Não prometer perfeição universal nem confundir emulação com telefone físico.

## Lote 1 implementado
- Financeiro: período comum e separação entre competência e caixa.
- Carregamento: 27 scripts iniciais (antes 32); consultas em andamento compartilhadas; sete módulos opcionais e pré-cache ajustado; listas paginadas com totais integrais.
- Concorrência: versão no formulário e comparação atômica no banco; revisão a cada 20s entre funcionários; notificação imediata entre abas.
- Backup: AES-GCM, PBKDF2, credencial limitada/expirável no Chaves, LaunchAgent diário fora de Documents, cópia secundária no iCloud existente, histórico admin. Cópia real restaurada em SQLite temporário; identidades Auth ensaiadas em tabelas temporárias Postgres.
- Correções encontradas nos ensaios: histórico sem autor, dados antigos na atualização, abertura rápida do detalhe antes da lista, resposta vazia de RPC.
- 76 testes JS e 53 testes Python passaram; nove scripts SQL passaram com rollback. Regressão de navegação e publicação em andamento.
- Limites: Mac precisa estar ligado; sincronização remota do iCloud e recriação integral dos provedores não foram certificadas. Não usar a expressão 100% sem ressalvas.

## 2026-10-04 — dois lotes de oito melhorias

Lote 1 concluído e publicado via PR #32, CI 37217633621 aprovado no head final 01ca1d93, merge cc2d2cf8, Vercel READY e 33 assets conferidos. Rotina automática de backup instalada e recuperação ensaiada.

Lote 2: busca global por perfil; pendências com prioridade/responsável/próxima ação/adiamento e CAS; substituição guiada com convites copiáveis, respostas por datas, auditoria e troca atômica de dias restantes; controles compactos e acessíveis nos dois temas. Backup atualizado para v8/30 tabelas com legado preservado. Migrações global_search_pending_queue e queue_response_history aplicadas. 79 testes JS, 56 Python, seis cenários novos de navegador e dez roteiros SQL aprovados localmente. Regressão completa e publicação exigem o check `test` aprovado na revisão final da PR do lote 2.

A regressão no WebKit Linux detectou um campo de calendário herdando a fonte compacta do rótulo. Os valores editáveis em Configurações agora têm piso de 16px independente da media query; a verificação cobre todos os campos visíveis do calendário, mantendo o zoom de acessibilidade disponível.

Uma recarga com leituras locais ainda em andamento também expôs erros de origem descartada no WebKit. Leituras GET locais agora são canceladas em pagehide; gravações conservam seu ciclo. A regressão provoca uma recarga durante uma consulta atrasada e verifica ausência de exceções e funcionamento da leitura na página nova.

O clique imediato em “Contrato”, antes da resposta das tarifas, acessava settingsData nulo. O formulário agora aguarda os setores, mostra falha de carregamento quando necessário e respeita uma mudança de aba durante a espera. A regressão atrasa deliberadamente a resposta das tarifas.
