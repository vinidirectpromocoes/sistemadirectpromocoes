# Links dos diaristas e Financeiro simplificado

## Funcionamento

- `/cadastro.html`: nome e CPF, e-mail e senha próprios; endereço e experiência opcionais. A confirmação do e-mail antecede a gravação. O acesso é separado da sessão administrativa.
- `/vagas.html`: somente turnos com vagas que ainda não começaram, de pedidos ativos. Rede, loja, endereço, setor, datas, horários e valor pago por diária. Busca por rede, loja e setor; atualização automática a cada 45 segundos e botão Atualizar.
- A pessoa seleciona os dias, revisa e confirma que vai. O banco salva a escala e a resposta confirmada; a Direct registra presença/falta posteriormente. A presença continua criando a diária e alimentando os cálculos financeiros.
- Somente uma conta com e-mail confirmado e cadastro ativo pode assumir vagas. CPF válido, bloqueio, lotação e conflito de horários são verificados no banco. Todos os dias selecionados são gravados em uma transação. Uma falha em um dia não deixa os demais parcialmente escalados.
- Um CPF que já existe exige vínculo aprovado pela Direct em Configurações → Links dos diaristas. Nenhum cadastro existente é apropriado somente pelo conhecimento de nome e CPF. O vínculo não duplica nem substitui os dados internos.
- A página pública não expõe nomes da equipe, CPF, contato dos clientes, observações internas, faturamento ou lucro da empresa. O valor mostrado é o pagamento ao diarista, conforme configuração vigente.
- Financeiro: removidos Cobranças das redes e Conferir pedidos incluídos. Gráficos, previsões e lançamentos continuam operacionais. As cobranças existentes continuam preservadas; as pendências podem abrir sua ficha.

## Verificação

- `tests/portal_database.sql`: cadastro, validação e vínculo; registro da escala/confirmou que vai; idempotência; vaga preenchida; conflito; datas indisponíveis; bloqueio; conta sem cadastro; vínculo de CPF existente; autorização por operador; permissões de acesso. Executado no Supabase em transação revertida, sem conservar dados sintéticos.
- `tests/portal_e2e.mjs`: Chromium e WebKit, 1280/390/320 px, APIs sintéticas isoladas. CPF/senha inválidos, confirmação de e-mail, sessão, busca, seleção de dias, revisão, confirmação, saída, fonte de campos e ausência de transbordamento/erros JS. Integração incluída no fluxo de publicação.
- `node tests/e2e.mjs`: navegação, perfis, escalas, substituição, pendências, leitura, financeiro e cópia em base temporária.
- `DIRECT_FINANCE_ONLY=1 node tests/e2e.mjs`: cards, períodos, temas, layout móvel, ausência dos blocos removidos, cobrança/recebimento parcial e pagamento agrupado em SQLite temporário.

## Limites práticos

A confirmação de e-mail depende da entrega do serviço de Auth, sujeita aos limites gratuitos existentes. Testes de e-mail usam respostas sintéticas e o banco confirma o requisito; não enviam e-mails reais de teste. Os testes móveis simulam tamanhos e motores de navegador; não equivalem a conferir fisicamente um iPhone ou Android. O portal público conecta ao Supabase publicado; o SQLite local continua isolado.
