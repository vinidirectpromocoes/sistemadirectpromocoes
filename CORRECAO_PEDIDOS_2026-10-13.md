# Pedidos: reposições, encerramento e histórico

A seleção considera apenas as vagas de hoje e dos próximos dias no calendário de Fortaleza. Ausências históricas permanecem nas métricas; cobrir os dias restantes retira o pedido da seleção.

Após o último dia, o pedido mostra Encerrar. A revisão apresenta presenças, faltas, dias com desistência e diárias não atendidas. Uma escala ainda sem baixa impede a confirmação, pois o sistema não presume falta ou presença. Dias sem equipe podem encerrar como não atendidos; não são lançados como falta de uma pessoa inexistente.

Repor no passado é bloqueado. Registrar/corrigir a presença da pessoa original antes de encerrar permanece sujeito às proteções financeiras existentes. Ao encerrar, as ocorrências e diárias são preservadas e os pagamentos continuam no Financeiro. Não se cria pagamento, cobrança ou nota fiscal.

Na ficha do diarista aparece o histórico de escalas por data/pedido, com motivos, autor e reposição. Os dias abrangidos por uma desistência são identificados como dias afetados, sem atribuir novas desistências nem bloquear pessoas automaticamente.

A migração altera funções de cálculo e guardas; recalcula apenas situação e data de atualização dos pedidos abertos. Compara integralmente nove tabelas protegidas e os demais campos dos pedidos antes/depois. Cadastros, lojas, datas das escalas, presenças, faltas, desistências e valores financeiros não são reescritos pela migração. Encerrar cada pedido requer confirmação do operador; a implantação não encerra pedidos automaticamente.

Testes usam somente bases fictícias e incluem prazo, reposição sucessiva, ausência antiga, presença pendente, revisão desatualizada, permissões, reabertura indevida e preservação financeira. A publicação depende dos testes PostgreSQL e das quatro baterias de regressão.

A conferência também encontrou timeout do backup completo. Os wrappers v8–v11 passam a materializar cada snapshot uma vez, preservando as 36 tabelas, registros, permissões e formato. O teste PostgreSQL compara o conteúdo integral antes/depois dessa otimização. Referência técnica: [materialização de CTEs no PostgreSQL](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION).
