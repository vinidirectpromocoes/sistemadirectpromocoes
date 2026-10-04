# Sistema Direct Promoções

Gestão interna de diaristas, pedidos, escalas e financeiro. Site: **https://sistemadirectpromocoes-zeta.vercel.app/**. Funcionários entram com Supabase Auth e autorização da Direct. Diaristas não criam conta nem acessam o painel interno.

## Rotina de trabalho

1. Receba o cadastro por link privado ou salve manualmente **nome e CPF**. Telefone, endereço e disponibilidade podem ser completados depois. A lista identifica cadastros parciais com botão **Completar**.
2. Registre os pedidos em **Pedidos** ou **Leitura IA**. A leitura é local, aceita texto/fotos/PDFs, apresenta revisão e só grava após confirmação. Nome/CPF junto ao pedido permite cadastrar a pessoa e escalar todos os dias do pedido, conforme a revisão.
3. Pedidos sem equipe aparecem na plataforma de vagas. Ao preencher a escala, a vaga sai da plataforma; o pedido permanece no sistema. Desistência/substituição preservam o histórico.
4. **Confirmou que vai** registra o compromisso. **Presença** registra atendimento e cria a diária financeira; **Falta** retira uma diária ainda não paga. Presença futura é bloqueada. Diárias pagas exigem reabrir o fechamento antes de corrigir.
5. **Financeiro** mostra os indicadores e previsões acima da lista. Diárias são agrupadas por pessoa; **Ver diárias** mostra os itens. Fechamento registra pagamento, data e forma; não transfere dinheiro.

O Início reúne cards e gráficos. Pendências tem quatro atalhos: **Precisa de diarista**, **Aguardando confirmação**, **Presença a registrar** e **Pagamento a realizar**. As áreas Operação, Financeiro e Cadastros preservam acesso às demais pendências. Filtros e histórico ficam sob demanda, sem um quadro CRM paralelo.

## Mensagens copiáveis

Na ficha do pedido, abra **Mensagens para copiar**. Escolha pedido/equipe, divulgar vaga, endereço, lembrete ou substituição. A prévia pode ser corrigida antes de **Copiar mensagem**. Rede, loja, endereço, setor, dias/horários e equipe são consultados ao abrir a prévia. Não são incluídos CPF, telefone de terceiros ou valor recebido da rede.

O modelo de equipe distingue quem confirmou que vai, quem aguarda resposta e quem teve presença registrada em cada dia. Divulgação usa dias com vagas e informa a necessidade de atender todos eles. Lembrete individual usa os dias da pessoa selecionada. Revise disponibilidade e destinatários antes de enviar. No Financeiro, **Ver diárias → Resumo para copiar** mostra somente os pagamentos da pessoa e os itens do filtro atual, separando valores pagos de valores previstos. Copiar não envia WhatsApp automaticamente.

## Links separados dos diaristas

- **Cadastros por link**: acompanhe cadastros recebidos e gere/copie o link privado de cadastro. Não há criação de conta. O formulário inclui telefone, nascimento, CEP/endereço, setores, disponibilidade, transporte e trabalho atual; ViaCEP preenche o endereço com possibilidade de correção manual. A tela final agradece e mostra WhatsApp, grupo e vagas.
- **Vagas disponíveis**: gere/copie o link compartilhado privado para acompanhar as vagas. Não há filtro nem escolha individual de dias. O link compartilhado não autoriza alguém a assumir escala pelo CPF de outra pessoa.
- Para aceitar, um diarista já cadastrado precisa do convite individual vinculado à pessoa/CPF. O aceite confirma todos os dias restantes; presença continua sendo registrada pela Direct. Bloqueio, conflito, capacidade e trabalho na mesma rede são conferidos no banco.

WhatsApp da Direct e convite do grupo estão em **Configurações → Links dos diaristas**. Não compartilhe convites individuais de outra pessoa. Detalhes: [PORTAL_DIARISTAS_2026-10-03.md](PORTAL_DIARISTAS_2026-10-03.md).

## Calendários e valores

Valores em Configurações são em reais; armazenamento/cálculo usa centavos. Presenças congelam os valores vigentes e alterações posteriores não reescrevem pagamentos históricos. Tarifas ausentes não são inventadas. Pedidos cancelados não entram na previsão; faltas sem substituição reduzem o previsto. Previsão não é recebimento em caixa.

| Rede | Recebido por diária | Pagamento padrão | Prazo de recebimento/pagamento |
|---|---:|---:|---|
| Hipermarket | R$ 124 | R$ 85 | dias 1–15: dia 20; segunda quinzena: dia 05 seguinte |
| Fazendinha | R$ 129 | R$ 85 | dias 1–15: dia 20; segunda quinzena: dia 05 seguinte |
| Super do Povo | R$ 134 | R$ 90 | dias 1–15: dia 30; segunda quinzena: dia 15 seguinte |
| Super Lagoa | R$ 134 | R$ 90 | dias 1–15: dia 30; segunda quinzena: dia 15 seguinte |
| Pinheiro | R$ 134 | R$ 90 | semana de segunda a domingo: sexta/sábado da semana seguinte |
| Variedades | R$ 134 | R$ 90 | semana de segunda a domingo: sexta/sábado da semana seguinte |

Pinheiro/Variedades usam sábado como prazo final inicial, configurável para sexta. Pagamento efetuado na sexta pode ser registrado com a data real. Vencido somente após o prazo escolhido. Datas de calendário automáticas atualizam diárias pendentes; datas manuais e registros pagos são preservados.

O financeiro mantém os mecanismos históricos de cobranças, conferência e lotes no banco; as seções extensas foram retiradas da tela principal a pedido do proprietário. Não é necessário reintroduzi-las para usar os indicadores, pagamentos ou mensagens.

## Backup e recuperação

**Configurações → Cópia de segurança → Baixar cópia** exige administrador e senha de pelo menos 12 caracteres. O backup v5 lê as **24 tabelas** em um único snapshot consistente do Postgres, inclui tarifas, calendários, equipe, autorizações internas, contatos, convites, origem dos cadastros e link de vagas. O navegador criptografa o arquivo com AES-GCM antes de baixar. **Verificar cópia** confere decriptação, contagens, duplicidade e vínculos entre registros. Cópias v1–v4 permanecem aceitas, com aviso das configurações ausentes.

Guarde arquivo e senha separadamente, faça uma cópia semanal e após alterações importantes e verifique o arquivo. Tokens privados do portal também são sensíveis e pertencem à cópia criptografada. Credenciais e contas do Supabase Auth, chaves do projeto, infraestrutura e código não estão no backup dos dados; código/migrações permanecem no GitHub.

Ensaio em destino novo e isolado:

```bash
python3 -m pip install cryptography==50.0.1
python3 scripts/restore_backup.py /caminho/backup.json /caminho/consulta.db
python3 scripts/restore_backup.py --operational /caminho/backup.json /caminho/operacional.db
```

O programa pede senha sem mostrá-la, recusa sobrescrever e valida vínculos/contagens. O modo operacional recupera as tabelas de trabalho do servidor local; configurações privadas e vínculos Auth ficam preservados em `backup_private_rows` para recuperação administrativa, sem habilitar os convites no servidor local. O arquivo SQLite restaurado contém dados sem criptografia e deve permanecer restrito. Reimportar no Supabase exige destino separado, esquema pelas migrações, revisão das autorizações/UUIDs Auth e validação antes de troca da produção. Não existe botão que sobrescreva a produção automaticamente.

## Acesso e publicação

Administrador: conta Auth mais e-mail em `direct_admins`. Funcionários: conta Auth e autorização em **Configurações → Acesso dos funcionários**, perfil Operação, Financeiro ou Consulta. Dados privados exigem autorização no banco; a chave publicável do frontend não dá acesso administrativo. Contas de diaristas não são necessárias.

Publicação: branch `codex/...` → pull request → teste **Qualidade antes da publicação / test** aprovado no commit atual → merge → Vercel. O workflow executa backend, regras, restauração, navegador Chromium/WebKit e portal. A regra de proteção da `main` deve exigir PR, check `test` do GitHub Actions, branch atualizada e conversas resolvidas, inclusive para administradores. Não declare a regra ativa sem conferir no GitHub.

Os testes usam banco temporário e dados sintéticos. Testes SQL em `tests/backup_database.sql`, `tests/full_cycle_database.sql` e `tests/weekly_calendar_database.sql` terminam em rollback e exigem o projeto/administrador previstos. Não crie dados de teste permanentes na operação.

## Desenvolvimento e limitações

```bash
python3 server.py
```

Abra `http://127.0.0.1:8000`. O SQLite local não sincroniza automaticamente com Supabase. `static/` é publicado pela Vercel; schema/regras ficam em `supabase/migrations/`; `tests/` e `.github/workflows/quality.yml` verificam a publicação.

Leitura local usa Tesseract.js/PDF.js e exige internet para baixar bibliotecas/modelos na primeira utilização. OCR pouco legível ou mensagem ambígua exige revisão; não é um modelo generativo com entendimento ilimitado. Offline conserva agenda/rascunhos cifrados por sessão; presença e financeiro exigem conexão. Fontes de campos móveis têm 16px para evitar zoom automático; zoom de acessibilidade permanece disponível. Emulação Chromium/WebKit não substitui uma conferência em iPhone/Android físico.

As 44 lojas, seis redes e dez setores estão preservados. Relatórios anteriores são históricos: consulte a documentação atual para recursos alterados posteriormente.

## Automação operacional — lote 1

- **Pedidos → detalhes → Sugestões para a escala inteira:** experiência, horários em todos os dias restantes, deslocamento, conflito e empresa atual. A operação decide; o servidor reconfere e grava a escala inteira atomicamente.
- **Redes e lojas → editar → Orientações para a diária:** responsável, telefone, entrada, apresentação, uniforme e orientações por setor. Dados opcionais, reaproveitados nas mensagens dos pedidos.
- **Pendências → Alertas por prazo:** vagas/confirmacões a até 24 horas, urgência a até 2 horas e cadastro de disponibilidade sem atualização há mais de 30 dias. Derivado dos registros, atualizado ao recarregar e por minuto enquanto a aba está aberta.
- **Pedidos → Modelos:** salve a configuração de um pedido, escolha nova data inicial e abra um rascunho. Preserva intervalos entre dias e horários; não copia diaristas, presenças ou pagamentos. Só publica ao salvar o pedido. Modelos podem ser excluídos sem afetar pedidos.
- Modelos são exclusivos de admin/operação, auditados e incluídos no backup consistente v6 (25 tabelas). Versões v1–v5 continuam restauráveis.
- `tests/automation_e2e.mjs`: fluxos novos em Chromium/WebKit, desktop e telas de 390/320 px, sem dados sintéticos em produção. `tests/automation_database.sql`: ensaio de permissões e validação, transação revertida.

## Gestão integrada — lote 2

- **Redes e lojas → Link da loja:** link exclusivo, com prazo de 90 dias, renovação e revogação. Quem possui o link pode consultar apenas os pedidos/equipe daquela loja. Não substitui identificação pessoal do gerente; compartilhe só com o responsável e revogue em caso de encaminhamento indevido.
- **Portal da loja:** solicita setor, início, quantidade de dias consecutivos, horários e pessoas por dia. Envia presença/falta de dias já realizados. Tudo entra como solicitação/conferência, sem publicar pedido ou gerar pagamento antes da revisão da Direct.
- **Pedidos → Solicitações das lojas / Pendências → Lojas:** revisar pedido abre o formulário preenchido; salvar aprova e cria o pedido na mesma transação. Conferir presença/falta reaproveita as regras da escala e integra financeiro, preservando diárias pagas/cobradas. Recusa exige motivo.
- **Pendências → Resumo do dia:** equipe, presenças, faltas, substituições, presença ainda por registrar, vagas de amanhã e ocorrências. Texto copiável, sem CPF ou valores internos.
- **Financeiro → Agenda financeira por vencimento:** previsão de entradas/saídas no vencimento; realizado na data de pagamento/recebimento. Respeita faltas, valores/prazos congelados, pagamentos e recebimentos parciais vinculados. Receitas avulsas não abatem previsões de pedidos sem vínculo. Extras só aparecem no caixa se registrados como lançamentos datados. Redes sem calendário ficam em “Sem prazo configurado”.
- **Redes e lojas → Relatório:** atendimento mensal, presenças, faltas, desistências, substituições e ocorrências. Cópia e impressão/PDF pelo navegador. Datas futuras ainda não contam como presenças; uma substituição pode recompor a diária apesar do evento de falta.
- Backup consistente v7: 28 tabelas, incluindo solicitações, conferências e links privados das lojas. Backups v1–v6 continuam aceitos; RPC v6 permanece compatível durante atualização. O ensaio SQLite preserva links privados como registros de recuperação, sem reabrir acessos externos nem restaurar Supabase Auth automaticamente.
- CI inclui `tests/management_e2e.mjs`. Ensaios SQL `tests/store_management_database.sql` e `tests/backup_v7_database.sql` são revertidos. Não há serviço pago, envio automático de WhatsApp ou créditos de IA adicionados por esses lotes.
