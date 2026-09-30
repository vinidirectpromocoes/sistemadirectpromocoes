# Relatório de qualidade — Direct Promoções

Data: 30/09/2026. Avaliação técnica: **9,0/10**, considerando o uso interno e o escopo testado. A nota é uma avaliação de engenharia, não certificação nem garantia de ausência de falhas.

## Melhorias entregues

| Frente | Resultado | Onde conferir |
| --- | --- | --- |
| Conciliação operacional e financeira | Conferência por pedido e dia: vagas, escala, presença/falta, cobrança, recebimento e pagamento; alertas de divergência; carregamento de mais dias em lotes de 100 | Financeiro → Conciliação operacional e financeira |
| Recuperação de backup | Exportação criptografada de 16 tabelas, compatível com cópias anteriores; ensaio que recria as tabelas reais do servidor local, confere contagens, vínculos e integridade; recusa sobrescrever uma base existente | Configurações → Cópia de segurança; scripts/restore_backup.py --operational |
| Faltas e substituições | Justificativa obrigatória, autoria e horário definidos no banco publicado; histórico protegido contra alteração direta; nova escala vinculada à falta do mesmo pedido/dia | Pedidos → Ficha → Presença/falta |
| Custos e resultado | Transporte, taxas e outros custos estimados por diária e rede; cards e gráfico incluem custos extras e resultado líquido estimado, além da margem bruta | Configurações → Custos extras; Financeiro → Previsão operacional |
| Validação da publicação | Novos testes de conciliação incluídos no GitHub Actions, junto com backend, restauração e navegação | GitHub → Actions |
| Uso móvel e carregamento | Leitura das escalas em lote, eliminando consultas individuais por pedido; paginação com ordenação estável; telas pequenas e orientação horizontal verificadas | Início, Pedidos e Financeiro |

Os custos extras iniciam em zero. Nenhum gasto da empresa foi presumido. O resultado líquido exibido é estimado e não inclui despesas ou impostos que não tenham sido cadastrados. Presenças mantêm os valores históricos de faturamento e diária; os extras usam a estimativa atual da rede.

## Correções e comportamento conferido

- Pedido e datas entram individualmente na previsão; exclusão, cancelamento, falta e substituição recalculam os cenários.
- Cenário ideal conserva a hipótese de atendimento de todas as vagas; previsão atual desconta faltas sem atendimento substituto.
- Recebimento parcial continua no nível da cobrança, sem afirmar que uma diária específica foi integralmente recebida.
- Escala sem confirmação aparece como aguardando presença, sem afirmar que já existe obrigação financeira realizada.
- Motivo/autoria da falta não podem ser adulterados junto com a atualização da substituta.
- Custos aceitam zero e decimais; valores negativos, inválidos ou acima do limite são rejeitados.
- Exportação/restauração inclui cobranças, recebimentos, lotes de pagamento e os novos custos extras.
- Mais de 100 dias de conciliação podem ser consultados pelo botão de carregar mais.

## Testes executados

| Verificação | Resultado e alcance |
| --- | --- |
| Backend e backup em Python | 22 testes aprovados: validações, conflitos de escala, bloqueio, presença/falta, tarifas, financeiro, cobranças, lotes, leitura pendente e restauração |
| Regras em JavaScript | 12 testes aprovados: previsão, leitura, recomendação e conciliação |
| Navegação automatizada | Chromium e WebKit: 1280×800, 390×844, 320×640 e 844×390; formulário, navegação e largura sem transbordamento nos cenários testados |
| Perfis na interface | Admin, operação, financeiro e consulta em ambiente de teste com autenticação simulada; não equivale a sessões reais de cada perfil na produção |
| Financeiro no navegador | Dois pedidos, cobrança, recebimento parcial, pagamento agrupado e custos extras; consultas de escala em lote |
| Leitura/OCR | Revisão obrigatória com confiança simulada de 31%; registro e desfazer com 95%; parser de textos reais de pedidos. Não valida a precisão do OCR em toda foto/PDF real |
| Recuperação | Cópia criptografada do navegador verificada e restaurada em SQLite isolado; teste separado com registros vinculados não vazios e consulta financeira após restauração |
| Regras no Supabase publicado | Ensaios em transação com rollback: recusa falta sem motivo, associação de substituta e recusa adulteração do histórico. Sem registros fictícios mantidos |
| Auditoria Supabase | Uma advertência de senha vazada desativada; sete informações de índices sem uso registrado. Sem novo aviso de RLS no relatório obtido |

A execução inicial do teste de recuperação no Mac falhou porque selecionou o Python do sistema sem a biblioteca cryptography. A repetição com o Python configurado passou; o CI instala a dependência explicitamente.

## Limites e pendências verificáveis

1. **Proteção obrigatória da branch main:** formulário preparado com PR obrigatório, teste `test`, branch atualizada e sem bypass administrativo. O GitHub pediu verificação de identidade por e-mail e não salvou a regra. Os testes rodam, mas a obrigatoriedade ainda não está ativa.
2. **Aparelhos físicos:** testes usam Chromium/WebKit automatizados. Safari de iPhone e Chrome de Android reais, teclado do aparelho, rotação física e acessibilidade ainda não foram homologados. Os campos móveis usam tamanho apropriado para evitar zoom de foco, preservando o zoom manual de acessibilidade.
3. **Recuperação integral do Supabase:** o ensaio recupera dados operacionais em base local utilizável. Ainda não foi ensaiada recriação de projeto Supabase, contas Auth e importação em Postgres hospedado isolado.
4. **OCR real difícil:** fotos pouco legíveis, manuscritos e PDFs digitalizados podem precisar de revisão. Confiança do OCR não garante correção de todos os campos.
5. **Senhas vazadas:** o recurso do Supabase permanece desativado. A documentação o limita ao plano Pro ou superior; nenhum plano pago foi contratado. Referência: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
6. **Volume:** removido o padrão de consulta individual por pedido; não há benchmark de milhares de pedidos nem ensaio de carga concorrente em produção.
7. **Índices:** os sete avisos são informativos de ausência de uso observado; os índices foram preservados para evitar perda de desempenho em fluxos ainda pouco usados. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## Avaliação

O sistema cobre os fluxos operacionais e financeiros testados e ganhou rastreabilidade e recuperação de dados mais úteis. Nenhum erro bloqueante permaneceu nos testes finais executados. Para sustentar uma avaliação maior, faltam sobretudo homologação em aparelhos reais, recuperação integral do ambiente hospedado, sessões reais de todos os perfis e proteção obrigatória do fluxo de publicação. Não é correto afirmar que todos os cenários possíveis funcionam perfeitamente.

Não foram contratados serviços pagos nem APIs de IA com cobrança por créditos.
