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
