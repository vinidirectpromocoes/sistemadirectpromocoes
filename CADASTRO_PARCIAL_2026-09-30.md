# Cadastro parcial de diaristas — 30/09/2026

## Alteração

Somente nome e CPF válido são obrigatórios. Endereço, setores, trabalho atual, horários e locomoção podem ser preenchidos depois, na ficha → Editar cadastro.

As respostas de trabalho e locomoção começam como “Não informado”. O banco preserva `null`, sem transformar a ausência de resposta em Sim/Não. Dias não informados ficam vazios; o cadastro não ganha disponibilidade automaticamente. A lista identifica “Cadastro parcial”, e o CRM apresenta os dados que precisam ser completados.

A Leitura IA também salva nome/CPF válidos com os outros campos ausentes, sinalizando o cadastro parcial. CPF inválido, CEP inválido quando informado e OCR de baixa confiança continuam exigindo revisão. Mensagens com CPF já cadastrado permitem abrir o cadastro existente no formulário, preservando os campos que não vieram na nova mensagem; alterações só são gravadas ao salvar.

## Banco e compatibilidade

- Migração Supabase permite campos opcionais vazios e respostas booleanas desconhecidas; CPF válido e único, limites de tamanho, formatos de horários, auditoria, vínculos e RLS continuam ativos.
- Migração SQLite preserva IDs, registros e histórico relacionado. Respostas existentes não são modificadas.
- Pessoas sem dias informados não entram no contador de disponíveis nem recebem disponibilidade presumida nas sugestões de escala.

## Testes

- 29 testes Python passaram, incluindo cadastro com somente nome/CPF, persistência, CPF duplicado, completar o mesmo registro, validações e migração de base antiga com histórico.
- 21 testes JavaScript passaram, incluindo leitura parcial, CPF/CEP e pendência de cadastro no CRM.
- Fluxos completos em Chromium e WebKit, computador e telas móveis emuladas de 390 e 320 pixels: salvar cadastro básico, recarregar, consultar ficha, completar e salvar o mesmo cadastro.
- Leitura parcial automática e revisão de mensagem complementar sem apagar campos já cadastrados nem duplicar a pessoa.
- Teste transacional no Supabase: inserir mínimo, completar, rejeitar CPF/CEP/horário inválidos e CPF duplicado. Transação desfeita; nenhum registro fictício permaneceu.
- RLS confirmada ativa. Advisor sem novo alerta relativo à migração; permanece o aviso anterior de proteção contra senhas vazadas desativada ([referência](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). Advisor de desempenho apresenta índices ainda não utilizados, sem erro bloqueante.

Os testes de navegador usam bases isoladas e celulares emulados; não representam uma nova conferência em aparelho físico.
