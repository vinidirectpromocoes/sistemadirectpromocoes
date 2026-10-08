# Assistente Direct sem API paga

A aba **Leitura IA** funciona por regras locais e consulta os dados atuais do sistema. Não usa um modelo de linguagem pago, chave de API ou créditos de IA. As contas de hospedagem e banco de dados continuam sujeitas aos limites dos serviços já utilizados.

## Como conversar

1. Diga a ação e informe a pessoa, o CPF ou o número do pedido.
2. Responda na própria conversa quando faltar data, motivo, valor ou outro campo. Quando houver pessoas com nomes parecidos ou várias diárias, escolha uma opção ou informe o CPF/número correto.
3. Confira a revisão. Corrija um campo escrevendo, por exemplo, `Telefone: 85999991234`, ou use **Corrigir**.
4. Confirme para aplicar. Pagamentos e exclusões pedem uma conferência adicional; novas escalas e substituições pedem a confirmação de disponibilidade.
5. Escreva **Cancelar** para descartar a revisão. Nenhuma ação pendente será aplicada.

Não há salvamento automático ao interpretar uma mensagem. **Guardar pendência**, disponível para cadastros e pedidos incompletos, é uma ação explícita. Ações completas podem ser confirmadas mesmo quando outras mensagens ainda precisam de dados. As ações concluídas não são repetidas ao tentar novamente as que falharam. Para revisar várias ações, separe as mensagens com uma linha contendo `---` (até 10 ações por revisão).

## Exemplos

Os nomes, CPFs e números abaixo devem ser substituídos pelos registros reais. O CPF tem prioridade sobre o nome; o sistema preserva o cadastro existente mesmo quando o nome enviado é abreviado.

| Objetivo | Mensagem |
| --- | --- |
| Verificar cadastro | `Consultar cadastro` + `CPF: ...` |
| Presença | `Marcar presença de Maria hoje` |
| Falta | `Marcar falta de Maria hoje` e responder ao pedido de motivo |
| Confirmação | `Confirmar que vai` + `CPF: ...` + `Data: hoje` |
| Desistência | `Registrar desistência` + CPF + data + motivo |
| Substituir | `Trocar Maria por João no pedido 8 hoje porque avisou que não pode ir` |
| Escalar | `Escalar João no pedido 8` e responder à pergunta sobre a data |
| Alterar cadastro | `Alterar cadastro` + CPF + `Telefone: ...` ou `Novo nome`, `Bairro`, `CEP`, `Rua`, `Número`, `Setores`, `Transporte` |
| Bloquear/desbloquear | `Bloquear cadastro` ou `Desbloquear cadastro` + CPF |
| Alterar pedido | `Alterar pedido 8` + `Observações`, `Setor`, `Quantidade`, `Situação` ou `Horário` |
| Cancelar pedido | `Cancelar pedido 8` |
| Cadastrar loja | `Cadastrar loja` + `Rede`, `Loja`, `Endereço`, `Cidade` |
| Alterar loja | `Alterar loja` + `Rede`, `Loja`, campo desejado (ex.: `Orientações`) |
| Registrar pagamento | `Paguei Maria hoje R$ 100,00 por Pix` |
| Selecionar diária | Acrescentar `Diária: número` ou `Data: dd/mm/aaaa` (dia trabalhado) |
| Corrigir pagamento | `Corrigir pagamento` + CPF + diária + valor/data/forma + motivo |
| Reabrir pagamento | `Reabrir pagamento` + CPF + diária + motivo |
| Consultar pagamentos | `Consultar pagamentos de Maria` ou CPF |
| Excluir sem histórico | `Excluir cadastro` + CPF; `Excluir pedido 8`; `Remover escala` + CPF + pedido + data específica |
| Consultar/ajuda | `Consultar pedidos`, `Consultar lojas`, `Consultar pendências`, `Consultar financeiro de hoje`, `Ajuda` |

Os botões em **O que posso pedir?** preenchem modelos de mensagens. Textos de pedidos e cadastros recebidos pelo WhatsApp continuam disponíveis, assim como leitura de fotos e PDFs. A baixa de pagamento apenas registra o pagamento informado: não envia Pix ou transfere dinheiro.

## Permissões e histórico

- **Administrador:** cadastros, operação, financeiro e exclusão de cadastro sem histórico.
- **Operação:** cadastros, pedidos, lojas, presença/falta e substituições. Sem valores financeiros ou baixa de pagamento pelo assistente.
- **Financeiro:** consultas autorizadas e pagamentos. Sem alteração de cadastros ou escalas.
- **Consulta:** consultas de pedidos e lojas, sem alterações ou fichas pessoais de diaristas.

As permissões são verificadas na interface e continuam protegidas pelas regras do banco. Sair da conta limpa a revisão e a conversa. Antes de aplicar uma alteração, o sistema consulta novamente os dados; cadastros, pedidos, escalas e pagamentos com versão alterada precisam de nova revisão. A substituição compara a versão dentro da mesma transação que preserva a desistência/falta e cria a escala substituta.

Presença gera a diária e atualiza o financeiro existente. Falta não equivale a pagamento ou confirmação de disponibilidade. Datas futuras não permitem presença/falta. Pagamentos já baixados exigem motivo para correção. Diárias de um fechamento precisam ser reabertas no Financeiro. Cadastros, pedidos e escalas com histórico protegido não podem ser apagados; uma escala usada como substituta também permanece no histórico.

## Limitações

A interpretação usa um conjunto de regras, não a compreensão geral de um modelo de linguagem. Frases fora dos padrões precisam ser reformuladas com os campos sugeridos. O sistema não aprende sozinho nem guarda uma memória pessoal permanente: utiliza os cadastros atuais e a revisão em andamento. Imagens pouco legíveis pedem correção. Não realiza ações autônomas, transferências bancárias ou alterações coletivas sem revisão. Contratos, fechamentos, cobranças, permissões e configurações continuam nos formulários específicos.

## Validação e referências

Validado com testes de regras de interpretação, backend temporário, navegação por perfil e fluxo completo em Chromium/WebKit nas larguras de 1280, 390 e 320 pixels. O fluxo testa perguntas, homônimos, baixa/reabertura, falta, substituição, correções, bloqueio, proteção do histórico, sessão, cancelamento e ausência de chamadas externas durante a conversa digitada. A proteção de substituição foi validada também no banco publicado, com dados sintéticos revertidos ao final.

Referências usadas para o desenho: [formulários e perguntas por informações faltantes no Rasa](https://legacy-docs-oss.rasa.com/docs/rasa/next/forms/), [princípios de autorização da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) e [filtros de atualização do Supabase](https://supabase.com/docs/reference/javascript/update). Nenhuma dependência de IA ou serviço pago foi adicionada.
