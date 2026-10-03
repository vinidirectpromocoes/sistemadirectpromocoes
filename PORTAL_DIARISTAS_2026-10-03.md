# Convites privados dos diaristas e Financeiro simplificado

## Funcionamento

- Configurações → Links dos diaristas → Gerar links privados cria **dois links diferentes por pessoa**, com validade de 7/30/90 dias. CPF opcional vincula o convite àquela pessoa. Os tokens são distintos, armazenados no banco como hashes e transportados no fragmento da URL. Envie cada link no privado; gere outro par para o próximo diarista.
- `/cadastro.html#convite=…`: nome e CPF, e-mail e senha próprios; endereço e experiência opcionais. A confirmação do e-mail antecede a gravação. A sessão é separada da equipe administrativa. Não há acesso às vagas nessa página.
- `/vagas.html#convite=…`: somente escalas com disponibilidade em **todos os dias** e que ainda não começaram. Rede, loja, endereço, setor, datas, horários e valor pago por diária, com apenas o botão **Quero pegar essa vaga**. Sem busca, filtros, atualização manual, seleção de datas ou navegação para cadastro. Atualiza em segundo plano a cada 45 segundos.
- Ao clicar, a pessoa entra na própria conta cadastrada, revisa todos os dias e confirma que vai. O banco escala a pessoa em **todos os dias do pedido, numa única transação**. Conflito ou lotação em qualquer dia cancela a operação inteira. A Direct continua registrando presença/falta; o compromisso de comparecer não gera presença ou pagamento antecipado.
- Sem convite válido/ativo ou cadastro ativo não se assume a escala. Convite vencido, de outro acesso, CPF incompatível, diarista bloqueado e sobreposição de horários são rejeitados no banco. As antigas APIs sem convite foram fechadas.
- CPF preexistente em convite genérico exige vínculo aprovado pela Direct. Convite emitido especificamente para aquele CPF pode vincular o cadastro existente, se não houver outro proprietário e o diarista estiver liberado. Não duplica nem substitui os dados internos.
- O link de vagas não expõe nomes da equipe, CPF, contatos, observações internas, faturamento ou lucro. Os valores exibidos acompanham contrato, setor e tarifa da rede.
- Financeiro: removidos Cobranças das redes e Conferir pedidos incluídos. Gráficos, previsões e lançamentos preservados. Cobranças existentes continuam no banco e pendências podem abrir sua ficha.

## Testes

- `tests/portal_database.sql`: executado no Supabase em transação revertida. Cadastro e idempotência, escala/confirmou que vai, lotação, conflito, bloqueio, conta sem cadastro, vínculo autorizado, CPF, permissões e fechamento das APIs antigas. Testa dois dias completos, nenhuma gravação parcial em conflito, tokens separados, convite usado por outra conta e vencimento. Nenhum dado sintético permanece.
- `tests/portal_e2e.mjs`: Chromium e WebKit, 1280/390/320 px, APIs sintéticas isoladas. Páginas sem convite bloqueadas, CPF/senha, confirmação de e-mail, conta sem cadastro rejeitada, separação dos links, ausência de filtros e seleção de dias, revisão, escala completa, campos de 16 px, ausência de transbordamento e erros JavaScript. Integrado ao fluxo de publicação.
- `node tests/e2e.mjs`: navegação, perfis, escalas, substituição, pendências, leitura e financeiro em base temporária.
- `DIRECT_FINANCE_ONLY=1 node tests/e2e.mjs`: cards, períodos, temas, layout móvel, ausência dos blocos removidos, cobrança/recebimento parcial e pagamento agrupado em SQLite temporário.

## Limites dos testes

O serviço de Auth usa os limites gratuitos existentes. Os testes automatizados simulam a entrega de e-mail; não enviam e-mails reais. Os testes móveis simulam dimensões e motores de navegador; não equivalem a testar fisicamente um iPhone ou Android. O portal conecta ao Supabase publicado; SQLite local permanece isolado.
