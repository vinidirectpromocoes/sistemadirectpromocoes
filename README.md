# Sistema Direct Promoções

Sistema da Direct Promoções com abas de Início, Diaristas, Pedidos, Leitura IA, Redes e lojas, Financeiro e Configurações. O site público é hospedado na Vercel; o acesso aos dados exige login e autorização no Supabase. A versão local em Python continua disponível para desenvolvimento, usando seu próprio SQLite.

## Site publicado e primeiro acesso

Endereço público: **https://sistemadirectpromocoes-zeta.vercel.app/**. A página de login é pública; os dados exigem uma conta administradora autorizada.

O administrador autorizado entra com o e-mail e a senha já cadastrados no Supabase. A tela pública contém apenas o formulário de login. O e-mail precisa estar registrado em `public.direct_admins`; uma conta sem essa autorização não consegue ler ou alterar os dados da operação. Funcionários individuais precisam de conta no Supabase Auth **e** autorização de seu e-mail em Configurações → Acesso dos funcionários.

O arquivo `vercel.json` publica `static/`. O JavaScript desta pasta usa a chave publicável do Supabase, e as políticas RLS verificam o administrador em cada tabela. A chave de serviço e o banco SQLite não pertencem ao site ou repositório. Enviar alterações para `main` no GitHub aciona um novo deploy pela integração Git da Vercel.

O fluxo recomendado de publicação é abrir um pull request, esperar o teste **Qualidade antes da publicação** ficar verde e só então integrar em `main`. O mesmo teste roda após cada atualização de `main`. A integração Git da Vercel publica automaticamente o commit; por isso, não envie commits diretamente a `main` antes de testar. O teste usa apenas banco temporário e dados sintéticos, sem credenciais de produção. Uma regra obrigatória de proteção da branch ainda deve ser configurada no GitHub para impedir integrações com testes reprovados.

Para adicionar outro administrador, inclua seu e-mail em `public.direct_admins` usando um acesso seguro ao banco. Não coloque a lista de administradores no código publicado. As permissões de funcionários são Operação (cadastros, pedidos, escalas e leituras), Financeiro (lançamentos e tarifas) e Consulta (pedidos e lojas). O administrador autoriza ou desativa o e-mail em Configurações; a conta e a senha devem ser criadas separadamente em Supabase Auth. Os esquemas e políticas estão em `supabase/migrations/`.

## Como iniciar

No Terminal, dentro desta pasta:

```bash
python3 server.py
```

Abra `http://127.0.0.1:8000` no navegador. Para encerrar, pressione `Ctrl+C` no Terminal.

Se `python3` não estiver disponível no Mac, use o Python incluído no Codex:

```bash
/Users/vini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 server.py
```

O servidor local aceita conexões somente do próprio computador e usa o arquivo SQLite em `data/`. Os dados salvos localmente não são sincronizados automaticamente com o Supabase após a migração inicial. Para operação compartilhada, use o site publicado. Como o CPF é um dado pessoal, mantenha a pasta `data/` restrita e faça cópias de segurança do arquivo `diaristas.db`.

## Cópia de segurança e ensaio de recuperação

No site publicado, o administrador pode ir a **Configurações → Cópia de segurança**, baixar o arquivo criptografado e conferir a senha e a integridade pela opção **Verificar cópia**. Repita semanalmente e após mudanças importantes. A tela lembra a data da última verificação neste aparelho; esse lembrete local não substitui um calendário de trabalho nem comprova cópias em outros aparelhos.

Para ensaiar uma recuperação sem tocar na produção, execute em um computador confiável:

```bash
python3 -m pip install cryptography==50.0.1
python3 scripts/restore_backup.py /caminho/direct-backup-AAAA-MM-DD.json /caminho/ensaio-direct.db
```

O programa pede a senha sem mostrá-la, recusa sobrescrever arquivos, confere as relações entre diaristas, pedidos, escalas, diárias, cobranças e lotes de pagamento e materializa as 15 tabelas em SQLite isolado. Cópias antigas de 11 tabelas continuam aceitas. A saída contém dados pessoais e financeiros **sem criptografia**; mantenha-a com acesso restrito e apague-a após o ensaio. Esta ferramenta verifica que os dados são recuperáveis para consulta e reimportação planejada. Ela não reimporta automaticamente para o Supabase e não inclui usuários do Supabase Auth, senhas nem configurações do projeto. Uma recuperação completa de desastre exigirá um projeto Supabase separado e uma rotina de importação validada para esse ambiente.

## Campos disponíveis

- Nome e CPF com validação e bloqueio de duplicidade
- Um ou mais setores de experiência
- Endereço em Fortaleza–CE: CEP, logradouro, número, complemento e bairro. Cidade e estado são definidos automaticamente.
- Situação de trabalho atual e local onde trabalha
- Dias da semana e horários específicos de disponibilidade
- Disponibilidade de locomoção, meio de transporte e observações
- Situação disponível ou bloqueada; a ficha completa é aberta pelo botão de olho
- Histórico de diárias com data, setor, local, observações e data do pagamento. A data do pagamento pode ser registrada ou corrigida depois; sem ela, a diária aparece como pendente.

Os indicadores contam como **disponíveis** os cadastros não bloqueados e como **bloqueados** os cadastros bloqueados. A informação sobre estar trabalhando atualmente continua na ficha da diarista.

## Financeiro

- As diárias aparecem automaticamente como saídas. Informe valor, vencimento, data e forma de pagamento na ficha da diária ou na aba Financeiro.
- A previsão operacional mostra faturamento, custo das diárias e margem bruta do mês (ou de todos os meses), com gráfico circular e divisão por rede. O cenário ideal considera todas as vagas de todos os dias atendidas; a previsão atual desconta faltas sem substituição e usa os valores congelados das presenças confirmadas. Vagas futuras ainda sem escala permanecem como hipótese de atendimento. Pedidos cancelados não entram. Valores de tarifas ausentes são avisados e não são inventados.
- Ao confirmar uma presença, a diária registra os valores vigentes de faturamento e pagamento. Alterar uma tarifa depois não reescreve esse histórico. Uma falta sem pagamento retira a diária ligada à escala. O faturamento previsto é uma estimativa de serviço prestado, não equivale a dinheiro já recebido da rede: registre a cobrança e sua liquidação como entrada no financeiro para acompanhar o caixa.
- Registre outras entradas e saídas com descrição, cliente ou favorecido, categoria, valor, vencimento, data de liquidação e observações.
- Os cards mostram entradas, saídas e saldo **realizados no mês selecionado**, além do total de valores pendentes de receber e pagar em todos os períodos.
- O filtro de mês afeta a lista; a opção **Ver todos os meses** mostra todo o histórico. Há busca, filtros por tipo e situação, e exportação CSV do resultado filtrado.
- Diárias antigas sem valor ficam sinalizadas e não entram nos totais até serem completadas.
- Uma diária marcada como paga não pode ser excluída diretamente. Cadastros com diárias registradas também não podem ser excluídos, para preservar o histórico financeiro; use o bloqueio da diarista quando necessário.
- Em **Cobranças das redes**, gere uma cobrança por rede e período a partir das presenças confirmadas, com número de nota opcional e vencimento. A ficha mostra os pedidos e as diárias incluídos. Cada diária só pode ser cobrada uma vez enquanto a cobrança estiver ativa. Registre recebimentos parciais; o saldo, os cards, o gráfico e o razão financeiro são recalculados. Um recebimento incorreto pode ser estornado com motivo. Para corrigir uma presença já cobrada, cancele a cobrança antes; os itens voltam a ficar disponíveis e a alteração fica na auditoria.
- Em um grupo de diárias por pessoa, **Fechar pagamento** permite selecionar várias diárias, registrar data e forma uma vez e preservar o total do lote. Para corrigir, reabra o lote com motivo; o pagamento das diárias volta a pendente.

## Pedidos dos supermercados

- Registre supermercado, unidade, contato, setor e número de diaristas necessário por dia.
- Adicione uma ou mais datas, cada uma com seu próprio horário de início e fim. A quantidade de dias e o total de diárias solicitadas são calculados automaticamente.
- Acompanhe a situação do pedido: novo, em seleção, confirmado, concluído ou cancelado.
- A lista oferece busca e filtro por situação; a ficha mostra todos os dias e horários e permite editar ou excluir o pedido.
- Um pedido corresponde a um setor e a uma quantidade de diaristas por dia. Para demandas diferentes por setor, registre pedidos separados.
- A escala semanal mostra horários, equipe e vagas abertas. Na ficha do pedido, associe diaristas e confirme presença ou falta por data. A página Início reúne vagas abertas, presenças pendentes, leituras pendentes e lançamentos vencidos.
- A lista de pessoas disponíveis prioriza experiência no setor, bairro da loja e locomoção. Bloqueio, indisponibilidade no turno, deslocamento limitado e conflito com outra escala impedem a sugestão. A confirmação de falta reabre a vaga para substituição e atualiza a previsão financeira. A página Início aponta pedidos, presenças e cobranças vencidas com links diretos para resolver cada pendência.

## Leitura IA

- A aba **Leitura IA** aceita vários registros em texto, várias fotos e PDFs de até 10 MB e 20 páginas. O reconhecimento de texto em imagens usa Tesseract.js no navegador; PDFs usam PDF.js para texto e OCR nas páginas digitalizadas. As bibliotecas e o modelo de português são baixados da internet na primeira leitura. Não há chamada à API OpenAI nem cobrança por créditos.
- O sistema separa cadastros e pedidos pelas etiquetas das mensagens, identifica seus campos e registra automaticamente os completos. Verifica CPF, datas, loja e duplicidade antes de salvar. Informações incompletas ficam na lista **Informações pendentes**, preservadas no banco e disponíveis para completar no formulário.
- O resultado mostra o arquivo de origem, a confiança da leitura de imagem, os totais por arquivo e um filtro para registrados, pendentes, duplicados ou erros. Imagens com confiança baixa exigem revisão antes do registro.
- Para pedidos, intervalos abreviados como `29 a 05` são interpretados com base no dia atual em Fortaleza. A rede é associada ao nome da loja quando há correspondência única no catálogo. A quantidade de dias nunca é usada como quantidade de diaristas. Se a quantidade de pessoas não vier informada, o padrão da empresa é 1 por dia.
- A leitura segue formatos com etiquetas como `Nome Completo:`, `CPF:`, `Loja:`, `Função:` e `Horário:`. Texto ilegível, escrita manual ou mensagens ambíguas podem exigir revisão na lista de pendências.
- Cada resultado da leitura pode ser expandido para conferir os campos identificados. OCR com baixa confiança vai para revisão, e o último pedido salvo pode ser desfeito se ainda não tiver escala associada.

## Cópia de segurança

Em Configurações, o administrador pode baixar uma cópia **criptografada** das tabelas operacionais e verificar se o arquivo abre com sua senha. Guarde arquivo e senha separadamente. A cópia contém dados das tabelas, mas não inclui contas do Supabase Auth nem um restaurador automático do banco. Faça a verificação do arquivo após baixar; perder a senha impede a leitura da cópia.

## Redes e lojas

- O catálogo inicial contém 44 unidades pesquisadas das seis redes informadas: Super do Povo, Super Lagoa, Fazendinha, Hipermarket, Pinheiro e Variedades. Abrange Fortaleza, Caucaia, Eusébio, Aquiraz e Maranguape. Nova Metrópole fica em Caucaia.
- Busque por rede, loja, bairro ou cidade e filtre por rede e município. Cada unidade mostra o endereço, a fonte pública e um botão **Copiar dados** que gera uma mensagem com rede, loja e endereço.
- Oito endereços têm divergência, fonte indireta ou informação incompleta e aparecem como **Conferir endereço**. O botão de cópia pede confirmação nesses casos. Use **Editar** para corrigir o registro e registrar uma observação; alterações persistem mesmo após reiniciar o servidor.
- Use **Nova loja** quando a rede confirmar outra unidade. A pesquisa pública não confirma quais unidades são efetivamente atendidas por cada contrato nem garante que a lista de lojas esteja completa ou atualizada. Confira unidades e endereços operacionais com cada rede.
- As fontes individuais ficam no próprio cadastro e a lista inicial está em `catalogo_lojas.py`. Foi feito um backup antes da migração em `data/backups/diaristas-before-redes.db`.

## Estrutura

- `server.py`: servidor local, validação e banco de dados
- `static/reading-parser.js`: classificação e extração local das informações
- `static/`: interface do cadastro
- `data/`: banco local criado automaticamente na primeira execução, ignorado pelo Git
- `supabase/migrations/`: esquema e regras de acesso do banco publicado
- `vercel.json`: configuração de publicação da interface

Para evoluir o sistema por partes, novos módulos podem usar este mesmo servidor e banco, mantendo as diaristas cadastradas.
