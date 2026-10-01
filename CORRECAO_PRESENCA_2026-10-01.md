# Presença e atualização financeira — 01/10/2026

## Causa e correção

A leitura de uma data sem ano avançava para o próximo ano quando o início já tinha passado. O pedido do Francisco Antônio Fagner foi registrado como 29/09 a 05/10/2027, bloqueando corretamente a presença por ser uma data futura. O administrador confirmou que o período era de 2026.

- Corrigidos o pedido e suas sete escalas para 29/09 a 05/10/2026, preservando os IDs, a pessoa escalada e as três confirmações de ida. A correção foi registrada na auditoria e nas observações do pedido.
- Presença disponível nos dias 29/09, 30/09 e 01/10. Os próximos dias ficam disponíveis na respectiva data; confirmar que vai continua separado da presença.
- Leitura agora reconhece inícios recentes de até 31 dias sem avançar o ano, inclusive na virada de ano. Intervalos abreviados que estão em andamento atravessando o mês usam o início do mês anterior.
- A leitura informa o período completo identificado. Datas sem ano deduzidas para mais de 90 dias à frente exigem revisão antes de salvar. Anos explicitamente informados são preservados.
- O card de lucro confirmado mostra também a média por diária, após extras estimados. Se houver tarifas faltantes, a média fica pendente em vez de apresentar um valor incompleto.

## Testes aprovados

- 41 testes Python e 42 testes JavaScript.
- Suíte completa de navegação Chromium/WebKit. O fluxo específico de leitura de pedido iniciado recentemente, presença, financeiro e recarga passou em 1280, 390 e 320 pixels nos dois motores.
- Cada presença de teste acrescentou R$ 134,00 de faturamento, R$ 90,00 de custo e R$ 44,00 de lucro sem extras. Os valores persistiram após recarga.
- No Supabase, teste autenticado e revertido comprovou a geração da diária com os valores e vencimento em 15/10/2026; repetir a presença não duplicou a diária. Corrigir para falta retirou a diária pendente.
- Conferência da produção confirmou as datas, sete escalas, confirmações preservadas e os três botões de presença habilitados. Nenhuma presença real foi marcada pelo teste; a transação de verificação foi inteiramente revertida.
- Os dois gatilhos de integridade envolvidos na correção foram conferidos como ativos após a migração. A auditoria permaneceu ativa durante a correção. Nenhuma permissão permanente foi alterada.

Os testes móveis usam telas emuladas. O aviso anterior do Supabase sobre proteção contra senhas vazadas continua presente; esta entrega não introduziu novo aviso de banco. Os testes aprovados são locais e no banco, sem afirmar conclusão do CI remoto.
