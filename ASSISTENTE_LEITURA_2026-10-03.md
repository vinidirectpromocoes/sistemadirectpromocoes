# Assistente Direct — leitura com revisão e confirmação

## Entrega

A aba Leitura IA agora funciona como uma conversa operacional. Interpretação e consulta não gravam cadastros, pedidos, escalas nem pendências. O usuário vê os campos identificados, pode corrigir, cancelar ou confirmar pelo botão ou pela resposta isolada “está certo”. Documentos anexados nunca são tratados como autorização de execução.

### Ações disponíveis

- Cadastro com nome/CPF, com demais informações opcionais.
- Pedido com rede, Loja/Região, setor, datas, quantidade de dias e horário.
- Pedido junto de nome/CPF: cadastro básico, pedido e escala de todos os dias, na transação já existente do backend. Pessoa antes ou depois do pedido; nome livre antes do CPF; rótulos WhatsApp na mesma linha, com asteriscos, ponto e vírgula, `=` ou `-`.
- Presença, falta, confirmou que vai, desistência e substituição. Falta/desistência/substituição exigem motivo; a substituição exige pessoa cadastrada e confirmação da disponibilidade.
- Complemento de bairro, CEP, rua, número, complemento e novo nome de pessoa já cadastrada, preservando os outros campos.
- Consultas resumidas de pedidos, cadastros, lojas, pendências e financeiro (todos os períodos, hoje ou semana), com links para as abas. O financeiro usa o mesmo cálculo de previsão e presenças do dashboard, com ressalva para tarifas ausentes.
- Fotos e PDFs mantêm OCR local, limites de tamanho/páginas e revisão de baixa legibilidade. Pendência só é gravada por ação explícita “Guardar pendência”.

### Correção e segurança

- “Corrigir horário para 07:00 às 15:20”, “Corrigir nome para ...” e correções de rede, loja, setor, CPF e data atualizam a revisão antes de salvar.
- Quando há somente um item incompleto, é possível responder com o campo faltante, por exemplo `CPF: ...`, preservando o restante.
- Homônimos e mais de uma escala pedem CPF, data, pedido/loja/horário. Não escolhem o primeiro resultado.
- Data explícita tem prioridade sobre palavras como “hoje” no motivo. Presença/falta futura continuam protegidas pelo backend.
- Alterações operacionais comparam novamente a versão lida do cadastro/escala antes de gravar; versão diferente exige nova revisão. As validações e permissões do backend continuam ativas.
- Duplo clique/reenvio não repete ações concluídas na revisão. Pedido com cadastro e escala mantém a chave de operação e a transação do servidor.
- Falhas em lote aparecem por item. Itens concluídos permanecem concluídos; um lote de várias ações não constitui uma única transação.
- Sem execução de código, SQL ou HTML recebido na mensagem. Campos renderizados com `textContent`. Conversa fica somente na sessão da página e é limpa ao sair da conta.
- Pagamentos, contratos, exclusões e permissões permanecem nos formulários próprios. Um comando não suportado exige orientação; não é executado.

## Evidência de testes

- 41 testes Python: aprovados (`/tmp/direct-assistente-python-final.log`). A fixture de presença futura passou a usar data relativa, pois 03/10/2026 chegou.
- 53 testes JavaScript: aprovados (`/tmp/direct-assistente-unit-final.log`), incluindo 11 testes novos do assistente.
- Navegação, perfis, largura de tela, backup/restauração, OCR simulado, financeiro, operação, escala, pendências, cadastro parcial e calendários: aprovados até a etapa de leitura vinculada (`/tmp/direct-assistente-e2e-final.log`).
- A etapa de leitura vinculada revelou um botão indevido de desfazer o conjunto cadastro/pedido/escala. Corrigido e reexecutado com sucesso, junto de filtros, ciclo de substituição, leitura recente → presença → financeiro e o novo assistente (`/tmp/direct-assistente-e2e-remaining.log`, saída 0).
- Novo assistente: Chromium e WebKit em 1280, 390 e 320px; nenhuma gravação antes de confirmar; correção/cancelamento; registro com duas escalas; presença/falta; complemento de cadastro sem apagar outros dados; rejeição de revisão desatualizada; consulta sem alterações; comando desconhecido bloqueado; desistência e substituição em WebKit 320px.
- Testes de registro utilizam banco SQLite temporário isolado, destruído no fim. Nenhum dado real foi criado/modificado para testes nesta entrega.
- Arquivo JS novo incluído no servidor local e no cache do app; `git diff --check` aprovado.

## Limites

Este assistente usa interpretação local por regras e OCR, sem API de IA paga. Não é um modelo generativo de compreensão irrestrita. Comandos conhecidos têm revisão obrigatória; formatos não reconhecidos pedem complemento. A ampliação de novos comandos deve incluir validação, permissões e testes específicos.

Os testes móveis são emulação Chromium/WebKit; esta entrega não incluiu teste em aparelho físico. A legibilidade de novas fotos/PDFs depende dos arquivos recebidos; o OCR não garante acerto de nomes e números. Testes desta entrega de baixa confiança usam simulação controlada; não substituem conferência de cada documento real.
