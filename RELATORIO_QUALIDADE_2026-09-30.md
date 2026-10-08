# Entrega e verificação — operação Direct Promoções

Data: 30/09/2026. Avaliação técnica provisória: **9,2/10** para o uso interno e o escopo verificado. É uma avaliação de engenharia; não é uma certificação ou garantia de ausência de falhas.

## Funcionalidades entregues

| Recurso | Onde usar | Integração e comportamento |
| --- | --- | --- |
| Confirmação antecipada | Pedidos → abrir pedido → diarista escalada | Aguardando, confirmou ou recusou; autoria/hora no servidor; convite com endereço para copiar ao WhatsApp. Confirmar não registra presença nem gera pagamento. Recusa exige retirada explícita para liberar a vaga. |
| Plantão e reservas | Início | Vagas, respostas e chegadas a conferir nos próximos sete dias. Reservas por setor/bairro; telefone e disponibilidade reconfirmada na ficha. Recomendações existentes continuam conferindo disponibilidade e conflitos. |
| Validação da loja | Pedido → pessoa com presença → Validar atendimento | Responsável, resultado, observação, chegada/saída opcionais. Horários precisam pertencer ao dia e não podem estar no futuro. Validação é registrada pela equipe Direct, não por um novo login externo da loja. |
| Contratos com versões | Configurações → Contratos e versões | Rede, loja opcional, setor opcional, vigência, valores, prazo e condições. Uma nova versão encerra a anterior quando necessário. Sobreposição da mesma abrangência é rejeitada; diárias já confirmadas preservam valor e contrato de origem. |
| Ocorrências e qualidade | Pedido / Início | Atrasos, troca de setor, saída antecipada, reclamação, elogio e outros fatos; resolução separada, sem alterar descrição original. Vínculos protegidos contra exclusão do histórico. |
| Demonstrativo e contestação | Financeiro → Demonstrativos e conferência | Itens por pedido, loja, pessoa, data, horário, substituição e validação; imprimir/salvar PDF; conferida/contestada com responsável e motivo. Não altera valor nem registra recebimento automaticamente. |
| Repetição de pedidos | Abrir pedido → Repetir pedido | Escolhe nova data inicial e abre cadastro para revisão. Mantém intervalo e horários; não copia pessoas, presença nem pagamentos. |
| Agenda e rascunhos offline | Início / novo pedido → Guardar rascunho | Shell estático e agenda mínima pré-carregada. Dados locais cifrados com AES-GCM e chave por sessão. Rascunho só é enviado depois de revisão e Salvar pedido; UUID evita duplicação por reenvio. Não há gravação financeira/presença offline. |

## Indicadores

- Cobertura efetiva das diárias até hoje; vagas futuras não entram como atendimento realizado.
- Confirmação antecipada no período escolhido.
- Pontualidade apenas quando há chegada efetiva, mostrando separadamente horários desconhecidos.
- Tempo médio de substituição somente quando existem horários válidos de falta e criação da substituta.
- Presenças validadas e ocorrências abertas.
- Histórico individual de presença, falta, atraso registrado, elogio e reclamação.
- Cadastros sem telefone e disponibilidade sem reconfirmação há 30 dias.
- Saldo vencido/contestado de cobranças, descontando recebimentos parciais.
- Faturamento, custo de diárias, extras e líquido estimado por loja/setor, mantendo os cenários ideal e atualizado do financeiro.

A projeção não substitui recebimento. Custos extras continuam sendo estimativas atuais por rede. Dados de presença/falta, pagamentos e recebimentos precisam ser registrados pela equipe. Sem esses registros, o sistema não presume pontualidade, presença ou quitação.

## Testes e evidências

| Verificação | Resultado e alcance |
| --- | --- |
| Python/backend/backup | 27 testes aprovados: cadastro, CPF, disponibilidade, bloqueios, conflitos, escala em lote, presença/falta, valores, pagamentos, cobrança/recebimento, contratos, ocorrências e restauração. |
| JavaScript/regras | 15 testes aprovados: previsão, conciliação, recomendação, leitura, contratos e indicadores. |
| Navegação | Chromium e WebKit, 1280×800, 390×844, 320×640 e 844×390; sete abas, formulário, largura, foco e botão com altura reduzida simulando teclado. Não são aparelhos físicos. |
| Perfis na interface | Admin, operação, financeiro e consulta com autenticação simulada no ambiente de teste. |
| Perfis no banco publicado | Admin, operação, financeiro, consulta e visitante anônimo usando papéis Postgres/claims controladas. Permissões de leitura/escrita e RPC, autoria/horário, snapshot contratual, validação, ocorrência e conferência passaram em transação com rollback. Não equivale a entrar em contas Auth reais de cada perfil. |
| Fluxo financeiro | Dois pedidos, cobrança conjunta, recebimento parcial e pagamento agrupado; projeções incluem custos extras e escalas em lote. |
| Fluxo operacional ampliado | Botões de reserva, confirmação, validação, ocorrência/resolução, contrato, conferência/contestação, impressão, repetição e rascunho offline/revisão/envio passaram no navegador em 320px. |
| Leitura real de arquivos | Tesseract/PDF.js sem simulação: PNG claro, PDF com texto e PDF digitalizado de teste foram processados. Arquivos sintéticos; não substituem documentos/fotos reais difíceis. |
| OCR com pouca confiança | Testes controlados de 31% exigem revisão; 95% permitem registro e desfazer. Nenhuma afirmação de precisão universal. |
| Backup v4 | 18 tabelas; restauração operacional local com contratos, ocorrências, escalas, diárias e cobrança vinculados. Senha incorreta e referência ausente rejeitadas. Cópias v1–v3 continuam aceitas. |
| Offline | Rascunho guardado sem conexão, revisão/envio após reconexão, um pedido criado; IndexedDB contém dados cifrados; cache do service worker não contém respostas de API. |
| Dependências | Auditoria pnpm executada; resultado sem vulnerabilidades registradas para as dependências instaladas. Não é auditoria formal de toda a cadeia de CDN. |
| Supabase Security Advisor | Apenas aviso de proteção de senha vazada desativada; avisos novos das RPC privilegiadas eliminados com implementação privada e wrappers públicos sem privilégios elevados. |
| Supabase Performance Advisor | 12 avisos informativos de índices sem uso observado. Índices recentes e de vínculos foram preservados. |

Os ensaios no Supabase terminaram com **8 pedidos e zero diaristas, escalas, diárias, cobranças, contratos e ocorrências**, igual ao estado operacional anterior. Nenhuma conta fictícia de Auth foi criada. Três registros temporários de perfil também foram revertidos.

## Correções durante a verificação

- Validação da loja é limpa quando a presença é revertida.
- Timestamp de confirmação/disponibilidade é definido no servidor; contrato da diária não pode ser trocado por atualização direta.
- Nova ocorrência não pode apontar uma escala de outro pedido; resolução preserva o registro original.
- Recarregamento após gravação espera consultas anteriores para não conservar um painel desatualizado.
- Salvamento do rascunho espera a conclusão da transação IndexedDB.
- Valores, vigências, lojas, setores, telefone e horários recebem validação no servidor.
- Layout dos novos cards e rodapés ajustado em telas estreitas, com campos de 16px no celular e redução de movimento respeitada.
- Falha de conexão informa o uso da agenda anterior e mantém rascunhos para revisão.
- PDF acima do limite também libera recursos do leitor ao ser rejeitado.

## Limites que permanecem

1. **iPhone físico:** o macOS recusou controle do Espelhamento. O usuário aceitou conferir no iPhone. Após a publicação: entrar no Safari, abrir Configurações → Conferência neste aparelho → Executar diagnóstico/baixar; conferir temas, teclado, rotação, formulário e escala. Resultado físico ainda pendente até receber a conferência.
2. **Android físico:** nenhum aparelho conectado estava disponível. Emulação Chromium passou; homologação física permanece pendente.
3. **Rascunhos:** a chave é por sessão. Revise/envie antes de sair ou fechar o navegador. Logout elimina dados locais; o recurso não é backup persistente.
4. **Recuperação integral hospedada:** restauração operacional foi ensaiada em SQLite isolado. Não foram recriados projeto Supabase, contas Auth nem configurações de infraestrutura.
5. **Branch main:** testes de CI existem, mas a proteção obrigatória depende da verificação de identidade solicitada pelo GitHub anteriormente. Não foi informada como ativada.
6. **Senhas vazadas:** o recurso exige plano elegível do Supabase; não foi contratado serviço pago. [Referência](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
7. **Volume e arquivos difíceis:** não houve carga de milhares de pedidos simultâneos nem validação de todos os tipos de fotos/manuscritos. O OCR local pode precisar de revisão e depende da internet para baixar os componentes na primeira leitura.

Não foram contratados serviços pagos ou créditos de IA. Nenhum erro bloqueante permaneceu nos cenários finais que foram executados. A nota pode ser revista após homologação física, recuperação integral hospedada e uso real com maior volume.

Referências técnicas: [RLS e permissões](https://supabase.com/docs/guides/database/postgres/row-level-security), [Advisor de índices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
