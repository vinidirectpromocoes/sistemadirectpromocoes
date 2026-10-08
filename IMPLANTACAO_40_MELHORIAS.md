# Implantação das 40 melhorias — Direct Promoções

Data: 8 de outubro de 2026. Base preservada: `04f8fc6`. Branch: `codex/evolucao-empresa-40-melhorias`.

As melhorias foram construídas em módulos compatíveis com a operação existente. O acesso principal é **Empresa**, com oito áreas. A inteligência gratuita combina regras existentes com consultas verificáveis e recursos locais opcionais. Não foram contratadas APIs pagas nem adicionados serviços pagos.

## Evidências por melhoria

| Nº | Melhoria | Onde usar | Comportamento implementado |
|---|---|---|---|
| 1 | Painel de execução por dia e rede | Empresa → Visão do período → Execução por dia e rede | Resumos SQL/local por período, rede, loja, função, cliente e campanha. |
| 2 | Prazos e escalonamento | Execução → Tarefas; Regras e acessos → Regras | Responsável, próxima ação, supervisor e antecedência configurável; alertas internos. |
| 3 | Fechamento diário | Execução → Fechamento | Detecta vagas sem pessoa, presenças pendentes, valores incompletos, ocorrências e conferências; exige resolução ou justificativa. |
| 4 | Briefing e ciência | Execução → Orientações; Confirmação de leitura | Versão publicada preservada; ciência ligada à versão e pessoa. |
| 5 | Qualificações e treinamento | Clientes e equipe → Qualificação / integração | Tipo, função, data, validade e responsável; usados nas reservas e alertas. |
| 6 | Reservas explicadas | Pedido → Reservas / Qualificação | Sugestões baseadas em função, qualificações e informações disponíveis; exige confirmação; horários continuam livres. |
| 7 | Checklists por função | Execução → Modelos; Checklists | Modelo aplicável à função, perguntas obrigatórias, respostas e versão preservadas ao concluir. |
| 8 | Fotos privadas | Ver detalhes → Fotos e comprovantes | Compressão JPEG, limite de resolução/tamanho, até oito fotos, hash e acesso privado; não aprova presença. |
| 9 | Supervisão por local | Execução → Visitas | Região, responsável, data, observação, loja e abertura de endereço no mapa. |
| 10 | Ruptura, preço e exposição | Execução → Observações de loja | Tipo de observação, produto, contexto e valor observado quando pertinente. |
| 11 | Retorno do cliente | Execução → Avaliação do cliente | Nota de 1–5, contexto, resposta e vínculo ao serviço. |
| 12 | Relatório aprovado externo | Execução → Relatório → Aprovar → Copiar link | Conteúdo revisado, versão preservada e acesso por código privado; projeção externa sem dados financeiros ou cadastrais internos. |
| 13 | Clientes e redes configuráveis | Clientes e equipe → Clientes / Redes; Lojas; Ajustes → tarifas | Identificações novas estáveis, nomes antigos preservados e novas redes aceitas pelo cadastro de lojas. |
| 14 | Campanha com vários pedidos | Campanhas → Campanha / Vínculo de pedido | Pedidos continuam independentes; vínculos agrupam operação e resultados. |
| 15 | Cronograma de evento | Campanhas → Etapas do evento | Preparação, montagem, atendimento e desmontagem; responsáveis e horários. |
| 16 | Controle de amostras | Campanhas → Amostras e degustação | Saldo inicial + entradas − distribuição − perdas − devoluções; impede saldo negativo. |
| 17 | Resultado de degustação | Campanhas → Amostras e degustação | Abordagens, porções, problemas e vendas observadas com origem obrigatória. |
| 18 | Kits e materiais | Materiais → Material / Movimentação | Entradas, entregas, retorno, responsável e condição; impede saldo negativo e devolução superior à entrega. |
| 19 | Lote e validade | Materiais → Lotes | Identificação, validade, antecedência e alerta; impede entrega de lote vencido. |
| 20 | Resultados de campanha | Campanha → Resultados da campanha | Execução e resultado financeiro autorizado, amostras e preparação de relatório revisável. |
| 21 | Categorias e centros de custo | Controle financeiro → Categorias | Catálogo editável, centro de custo e vínculo de despesas ao serviço ou administração. |
| 22 | Despesa com aprovação | Controle financeiro → Despesas | Operação prepara; Financeiro/Admin aprova; gera um único lançamento; preserva valor aprovado. |
| 23 | Conciliação CSV/OFX | Controle financeiro → Conta / Extrato | Prévia, escolha de colunas CSV, identificadores, sugestões de vínculo e revisão humana; recebimento parcial atômico. |
| 24 | Conferência de pagamento | Controle financeiro → Conferência de pagamento | Seleciona diárias pendentes da pessoa, guarda valores, revalida antes de aprovar e gera lote nativo uma vez. |
| 25 | Atraso e acompanhamento | Visão do período → Estimado, contratado e realizado; Acompanhamento de cobrança | Faixas de vencimento, contestação, promessa e próximo contato. |
| 26 | Estimado, contratado, planejado e realizado | Visão do período → Estimado, contratado e realizado | Orçamento da campanha, propostas convertidas, escalas e diárias; não inventa valores de pedidos antigos. |
| 27 | Margem de contribuição | Visão do período → filtros | Receita do serviço − diárias − despesas diretas aprovadas; capital separado; administração não entra na margem do serviço. |
| 28 | Cenários de caixa | Controle financeiro → Cenários de caixa | Saldo inicial, entradas, saídas, custo extra e atraso; hipóteses sem alterar lançamentos. |
| 29 | Oportunidade até pedido | Comercial → Oportunidades / Propostas | Etapas, responsável e retorno; conversão de proposta aprovada em pedido. |
| 30 | Propostas com versão | Comercial → Propostas | Preços e quantidades contratados preservados; nova versão para corrigir; conversão sem duplicação. |
| 31 | Relacionamento por cliente | Cliente → Histórico de relacionamento | Contatos, oportunidades, campanhas, tarefas, retornos e relatórios; proposta conforme perfil financeiro. |
| 32 | Solicitação por serviço | Pedidos por link → rede → portal | Reposição, degustação e evento; somente campos pertinentes; pedido fica pendente da revisão da Direct. |
| 33 | Assistente analista | Assistente → Pergunte sobre o período | Vagas, presenças, despesas e contribuição com período, registros, fontes e abertura de pedidos; sem inventar respostas livres. |
| 34 | Prévia de impacto | Formulários → Revisar; Leitura IA → revisão existente | Lista de campos, pessoas, vínculos, datas e valores antes de gravar; versões e revalidação no banco. |
| 35 | Vocabulário revisado | Assistente → Frases aprovadas | Só frases aprovadas ampliam a interpretação; ambiguidades recusadas; nome, CPF e restante do texto preservados. |
| 36 | Busca por significado e voz local | Recursos locais experimentais | Embeddings multilíngues sobre até cinquenta registros permitidos; transcrição de arquivo em português até sessenta segundos; revisão necessária. |
| 37 | Modelo local opcional | Recursos locais experimentais → sugestão | CPU WASM ou WebGPU compatível; processamento isolado, ativação manual e botão de parar; nenhuma operação automática. |
| 38 | Avisos e ciência | Regras e acessos → Avisos / Leitura de aviso | Aviso por destinatário/perfil e confirmação pessoal; repetição não cria segunda leitura. |
| 39 | Entrada e treinamento da equipe | Como começar e treinar a equipe; Regras e acessos → Acesso | Exercício fictício sem gravação, orientação por responsabilidade e restrição dos novos módulos por cliente. |
| 40 | Continuidade e recuperação | Ajustes → Backup; rotina diária do Mac | Snapshot consistente de trinta e cinco tabelas, fotos privadas, código/migrações e Auth; criptografia e ensaio de restauração isolada. |

## Verificação

- Backend: **83 testes aprovados**; formulários tipados, valores, referências, versões, repetição de envio, aprovação, conversão, fechamento, saldos, CPF existente e restauração criptografada.
- Regras de negócio: **115 testes aprovados**, incluindo valores, leitura, versões, importação e confirmação. Total: **198 testes de backend e regras**.
- Banco isolado: histórico das 66 migrações anteriores, novas funções e políticas reais, 35 tipos de formulário, Admin/Operação/Financeiro/Consulta, restrição por cliente, acesso anônimo, aprovação financeira, recebimento parcial, estoque, propostas, fotos e credencial do agente de backup.
- Volume: 5.000 tarefas fictícias; página limitada a 50 registros, abaixo de cinco segundos no ambiente de ensaio. Não representa capacidade máxima da nuvem.
- Navegador: Chromium e WebKit em 1280, 390 e 320 pixels; detalhes dos 35 tipos, gravação dos formulários editáveis, revisão, cancelamento, importação, escolha de colunas, temas, reabertura e treinamento.
- Fluxos integrados: foto realmente comprimida e baixada, conferência até lote de pagamento, campanha até preparação de relatório, proposta até pedido, relatório externo aprovado, reservas, histórico, ciência, cenários e tipos de solicitação.
- Regressão: pedidos e escalas, finanças, leitura/dialogue, links por rede, cadastro por convite, vagas, fila operacional, paginação e recarga.
- Recuperação: backup com registro novo e foto real foi descriptografado, verificado e restaurado em SQLite separado. A rotina diária foi atualizada para o código final; sua execução automática e restauração operacional também foram verificadas.

## Limites explícitos

Os itens 36 e 37 foram previstos na pesquisa como **experimentais** e continuam assim. O modelo local de linguagem foi executado no Mac pelo processador, mas produziu uma interpretação inadequada no ensaio; não deve decidir operações. A transcrição de voz executou localmente, com erros em palavras. Revise o texto e use as regras de confirmação. WebGPU não estava disponível para inferência neste aparelho; o caminho de indisponibilidade foi conferido. Esses recursos ficam desligados até uso explícito e podem ser interrompidos.

As larguras móveis foram emuladas em dois motores de navegador; não substituem ensaio físico com cada Android/iPhone dos funcionários. Não existe promessa comprovável de ausência universal de erros ou dificuldade de uso. A evidência refere-se aos cenários descritos.

Avisos e confirmação de leitura estão implementados; push em segundo plano era opcional na pesquisa e não foi habilitado. Nenhuma notificação externa é enviada. Pagamentos são registros da quitação realizada; o sistema não transfere dinheiro.

A restrição de cliente dos funcionários se aplica à nova área Empresa. As abas anteriores continuam com as permissões globais existentes por perfil. Não conceda perfil Operação/Financeiro a quem não deve acessar as informações dessas abas.

Relatórios externos mostram apenas título, período, resumo e resultado revisados. As fotos internas continuam privadas e não são publicadas automaticamente. Valores ausentes permanecem pendentes; capital da empresa é mostrado separado da contribuição dos serviços.

A restauração ensaiada é operacional em SQLite isolado. A cópia inclui identidade/Auth, mas recriar um projeto completo do provedor e suas configurações externas não foi ensaiado nem exigiu criar serviço pago.

## Publicação

**Publicação concluída em 8 de outubro de 2026.** Abra [Minha empresa](https://sistemadirectpromocoes-zeta.vercel.app/#empresa). Os pedidos públicos continuam em [Direct Pedidos](https://directpedidos.vercel.app). O [guia da equipe](https://sistemadirectpromocoes-zeta.vercel.app/empresa-ajuda.html) também está disponível dentro da nova área.

- Código aprovado: `e17a57e594d8061861cba968e300317e1a216a0d`; árvore completa `590847912c03c89f6d898574c4e3a75c7fd36526`. [Verificação contínua 118](https://github.com/vinidirectpromocoes/sistemadirectpromocoes/actions/runs/37843787687): backend/banco, Empresa, Operação e Assistente/portais **todos aprovados**. Todos os conjuntos de navegação anteriores foram mantidos.
- [Alteração 35](https://github.com/vinidirectpromocoes/sistemadirectpromocoes/pull/35) incorporada em `main`, commit `9e39e1681870996b469f7e2b9475c15bae3c0010`, com árvore idêntica à versão testada.
- Versão inicialmente liberada: `dpl_9Adk7jcRmWPDirEQKTdqSdpyBfFa`. Ambos os endereços públicos apontaram para essa versão. **74 arquivos de cada endereço tiveram SHA-256 idêntico ao código testado**; HTTPS e política de segurança conferidos.
- Na interface pública real, Chromium e WebKit em 1280, 390 e 320 pixels passaram por login, guia, link fixo existente da rede, escolha de loja, três tipos de serviço, consulta/atualização de pedidos e rejeição de relatório inválido. Nenhum pedido de teste foi enviado à empresa.
- A interface e o adaptador remoto da prévia foram exercitados com dados fictícios nos dois navegadores: 35 tipos abertos, formulários editáveis gravados, campos originais preservados e ausência de erro JavaScript/rolagem horizontal em 390 pixels. Esse ensaio usa um SDK simulado; as gravações e permissões reais do banco em nuvem foram verificadas separadamente em transações com **ROLLBACK**. Não foi usada uma sessão real de funcionário para gravar todos os formulários publicados.
- Supabase: migração `20261008185515_enterprise_operational_platform.sql` aplicada e função `backup-evidencias` ativa. Teste real dos 35 tipos e restrição por cliente/perfil aprovado. HTTP sem credenciais negou painel e evidências; relatório com código inválido também foi negado. O armazenamento de fotos é privado.
- Base conferida antes/depois: **23 diaristas, 8 pedidos, 19 diárias, 45 lojas**, custo histórico **R$ 1.710,00** e receita histórica **R$ 2.546,00**; **zero CPF duplicado** e nenhum registro fictício novo remanescente. Dez registros iniciais dos novos módulos correspondem às seis redes e quatro categorias.
- Cópia antes da migração: `direct-20261008T202239Z-4223aa1f-bd40-4613-b020-25938ae1d589.directbackup`, SHA-256 `1647cdb0a2652abf4aa4e07162f00f7c5f9f7bf6a099b005344f01ace796c400`.
- Cópia automática final: `direct-20261008T211220Z-41f8d980-95f9-422e-beb5-81b7b87b4c48.directbackup`, SHA-256 `3068b6ac52100fa91e6eb4b48b337559c5b75263f3a7337486c71aac5a81d5b7`. **35 tabelas, 547 registros, 1 usuário Auth e 273 arquivos**; descriptografada, hashes/vínculos conferidos e restaurada em SQLite isolado. A base real tinha zero fotos novas; a recuperação de bytes de foto foi ensaiada com imagem real e registros fictícios no ambiente isolado.

As cópias ficam em `~/Library/Application Support/Direct/Backups` e têm espelho verificado no iCloud. Credenciais permanecem no Chaves do macOS. A execução automática foi confirmada como `ok`/`verified` no banco.

A atualização deste relatório após a liberação é documental; a versão do aplicativo foi congelada e verificada antes da publicação.
