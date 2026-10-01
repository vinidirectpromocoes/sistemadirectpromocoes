# Calendário de recebimentos e pagamentos — 01/10/2026

## Regras implementadas

As mesmas datas valem para receber dos supermercados e pagar aos diaristas.

| Rede | Diárias de 1 a 15 | Diárias de 16 ao fim do mês |
|---|---|---|
| Fazendinha | Dia 20 do mesmo mês | Dia 05 do mês seguinte |
| Hipermarket | Dia 20 do mesmo mês | Dia 05 do mês seguinte |
| Super Lagoa | Dia 30 do mesmo mês | Dia 15 do mês seguinte |
| Super do Povo | Dia 30 do mesmo mês | Dia 15 do mês seguinte |
| Pinheiro | Prazo não informado | Prazo não informado |
| Variedades | Prazo não informado | Prazo não informado |

Se o dia configurado não existir no mês, vence no último dia daquele mês. Não há ajuste automático por feriados ou fins de semana: essas regras não foram informadas.

## Integrações

- Configurações → Calendário de pagamentos: regras editáveis por rede, pelos perfis admin e financeiro.
- Presença gera diária com os dois vencimentos, inclusive quando existe contrato com tarifas específicas.
- Alterações no calendário recalculam diárias automáticas abertas; preservam vencimentos manuais, pagamentos concluídos e diárias em fechamento.
- Financeiro e Pendências usam o vencimento, sem confundi-lo com a data de trabalho. Uma diária só é atrasada após seu vencimento; sem prazo informado, permanece sem vencimento.
- Cobranças sugerem a data de recebimento. Períodos com diferentes vencimentos pedem separação por quinzena ou uma data negociada. Datas digitadas manualmente e cobranças já emitidas são preservadas.
- Exportação e restauração preservam calendários, os dois vencimentos e a origem da data. Alterações são auditadas.

## Correção dos registros reais

As duas diárias do Super do Povo, de 29/09/2026 e 30/09/2026, tinham vencimento automático igual ao dia trabalhado. Ambas passaram para **15/10/2026**, tanto para pagamento como para recebimento. A auditoria foi conferida para preservar qualquer alteração manual anterior.

Mantidos: 9 pedidos, 7 escalas, 2 diárias, R$ 180,00 de custo e R$ 268,00 de faturamento confirmado. Nenhum pagamento ou presença foi confirmado de forma permanente durante os testes.

## Verificações

- 32 testes Python: cadastro, presença, financeiro, validações, calendários, edição manual, prazos desconhecidos e restauração de backup.
- 28 testes de regras JavaScript: previsões, leitura, seleção, conciliação, indicadores, pendências e calendário.
- Suíte de navegação Chromium e WebKit: desktop, 390 px, 320 px e orientação horizontal; perfis admin, operação, financeiro e consulta; cadastro, leitura, escalas, pendências, cobrança, recebimento parcial e fechamento de pagamentos.
- Novo fluxo de calendário nos dois navegadores: salvar, recarregar, verificar persistência, restaurar configuração, temas claro/escuro, ausência de transbordamento e campos com fonte de pelo menos 16 px para evitar zoom de foco.
- Supabase: testes transacionais com rollback de presença, contrato, recálculo das duas quinzenas, prazo desconhecido, pagamento concluído e edição manual. Diária manual sem vencimento continua sendo rejeitada quando tem valor pendente.
- Permissões reais no banco: financeiro pode alterar o calendário; operação não altera; consulta não acessa tarifas. Contas temporárias e alterações foram revertidas.
- Advisor: nenhuma nova advertência de segurança de banco. Permanece o aviso anterior sobre proteção contra senhas vazadas desativada ([referência do Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)); os 11 índices sem uso são avisos informativos, preservados.

Os testes móveis automatizados não representam uma nova conferência em iPhone/Android físico. Não foi adicionado serviço pago nem dependência externa.
