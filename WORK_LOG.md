# Melhorias aprovadas — outubro de 2026

## 2026-10-07 — Limpar convite ao atualizar cadastros por link

- Clique em Atualizar limpa CPF, links de cadastro/vagas, validade exibida e mensagem de cópia/WhatsApp. Atualiza a lista de cadastros recebidos e retorna à primeira página.
- Respostas atrasadas de geração/cópia não restauram o convite limpo. A próxima geração continua disponível; atualização automática e paginação mantêm o convite em edição.
- Regressão administrativa verifica cadastro mantido, campos limpos, geração atrasada descartada e próximo convite. Chromium/WebKit em 1280, 390 e 320 pixels.
- Encaminhamento HTTP secundário dos arquivos do teste substituído por leitura direta dos mesmos arquivos reais na origem HTTPS simulada, eliminando a conexão que apresentava ECONNRESET no WebKit. Verificações de erros permanecem ativas.
- Sem alteração de banco. CI completo obrigatório antes da publicação.

## 2026-10-05 — Vagas compactas e conferência de cadastro

- Cards resumem rede/loja, setor, período, horário, endereço e valor. Dias específicos, horários e valores variáveis ficam em detalhes expansíveis; botão “Quero essa vaga”.
- Nome completo e CPF são conferidos no banco nos links compartilhados e individuais. Cadastro autorizado mostra indicador verde; cadastro não encontrado recebe orientação. Editar os campos invalida a autorização anterior.
- Confirmação revalida cadastro, bloqueio, empresa e capacidade e grava todos os dias futuros numa transação, com bloqueio do pedido e proteção contra duplicidade. Não expõe ficha nem CPF na resposta pública; limite de consultas por link/IP.
- Consultas a cada 15 segundos preservam cards sem mudanças, foco, rolagem e formulário. Indicador “Ao vivo”, “Reconectando…” ou “Sem conexão”; falhas transitórias preservam a última lista.
- Migração já aplicada no Supabase no chat anterior. Retomada confirmou RPCs e repetiu roteiro SQL sintético com rollback, sem deixar dados de teste.
- 80 testes de regras aprovados; portal Chromium/WebKit em 1280/390/320 aprovado. Teste administrativo repetido nas seis combinações com sucesso após interrupção transitória de conexão no ensaio anterior.
- CI completo obrigatório antes de publicar; emulação móvel não equivale a ensaio em Android físico.

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

## 2026-10-05 — Escalas livres entre pedidos

Solicitação: permitir o mesmo diarista em vários pedidos, inclusive no mesmo dia e em horários sobrepostos.

- Supabase e servidor local deixam de bloquear a escala por sobreposição ou pela disponibilidade geral cadastrada. Datas válidas do pedido, identidade, vagas e permissões continuam verificadas.
- Escala manual mostra todos os cadastros não bloqueados e permite selecionar todos os dias com vaga; horário disponível serve para ordenar sugestões, sem impedir a escolha.
- Leitura com nome/CPF reutiliza o cadastro e cria escalas independentes em cada pedido. Substituição em lote também aceita pessoa escalada em outro pedido.
- Regressão: exemplo Paulo, Super do Povo/Meireles, 06–12/10/2026, 07:00–15:20 e 13:40–22:00, testado em Chromium/WebKit nas larguras 1280, 390 e 320. Dois pedidos/14 escalas; terceiro pedido manual/7 escalas; recarga preserva registros; escalar não gera pagamento.
- 80 testes JS e 57 testes backend aprovados. Presenças dos dois turnos geram duas diárias; falta num turno remove somente sua diária; previsão mantém pedidos independentes.
- SQL real com rollback: leitura conjunta, escala manual sem disponibilidade, presença/falta, permissões, substituição sobreposta, portal de vagas. Nenhum dado sintético fica na produção.
- Teste de navegador de sobreposição integrado ao gate de publicação; CI completa obrigatória antes da publicação.

## 2026-10-05 — Correção do setor com equipe escalada

- Guarda no Supabase e backend local permite editar apenas o setor entre os campos antes imutáveis, preservando rede, loja, quantidade, datas/horários e exclusão protegida.
- A correção não recria escalas nem recalcula os valores congelados de diárias já realizadas/pagas; novas presenças usam o setor corrigido. Controle de versão e permissões mantidos.
- 58 testes backend e 80 JS aprovados. Teste de edição real no formulário em Chromium/WebKit, larguras 1280/390/320, mantém sete escalas e persiste após recarga.
- Ensaio SQL com usuário autenticado, dados sintéticos e rollback confirma edição, preservação financeira, bloqueio de alteração estrutural e ausência de acesso anônimo.
- Gerador de CPF sintético do ensaio SQL corrigido nos pesos verificadores para evitar rejeições aleatórias na própria fixture.
- Pedido solicitado do Super do Povo/Meireles, 06–12/10/2026 07:00–15:20, corrigido de “frios ( dois)” para “Balconista de frios”, com comparação transacional garantindo equipe e demais campos idênticos.

## 2026-10-05 — Excluir pedido com escalas planejadas

- Exclusão via RPC invoker/autenticada e backend local remove pedido e suas escalas planejadas em uma única transação. Preserva cadastro dos diaristas e outros pedidos; versão antiga é recusada e exclusão repetida não retorna sucesso falso.
- Histórico de presença/falta/desistência, diária, cobrança, conferência da loja ou ocorrência exige cancelamento para preservar os registros. Não foram relaxados os guards de histórico nem o RLS.
- Frontend usa a operação atômica, explica a remoção das escalas na confirmação, desabilita duplo clique, mostra erro na posição visível e atualiza lista, início e gestão.
- 60 testes backend, 80 JS e seis cenários de navegador aprovados (Chromium/WebKit, 1280/390/320). Botão cancelar não exclui; confirmar exclui sete escalas; cadastro e outros 14 vínculos permanecem; previsão reduz faturamento/custo/lucro em 938/630/308 no cenário testado.
- SQL autenticado real com rollback confirma versão, atomicidade, histórico e permissões de admin/operação, com negativas para financeiro/consulta/sem perfil/anon. Security Advisor não apontou o novo RPC; avisos já existentes permanecem.
- A primeira execução de navegador acusou mensagens nativas de origem descartada no WebKit durante recarga. O roteiro agora aguarda a conclusão da exclusão e das consultas antes da recarga de persistência; verificações de exceções foram mantidas e todos os seis cenários passaram. Logs preservados em .design-qa.
- Pedido indicado, Super do Povo/Meireles 06–12/10/2026 07:00–15:20, removido com sete escalas depois de backup. Comparação transacional confirmou cadastro, outros pedidos, escalas e financeiro intactos, incluindo 14 escalas de Paulo nos outros dois pedidos.
