# Sistema Direct Promoções

Sistema da Direct Promoções com abas de Diaristas, Pedidos, Redes e lojas e Financeiro. O site público é hospedado na Vercel; o acesso aos dados exige login e autorização de administrador no Supabase. A versão local em Python continua disponível para desenvolvimento, usando seu próprio SQLite.

## Site publicado e primeiro acesso

Endereço público: **https://sistemadirectpromocoes-zeta.vercel.app/**. A página de login é pública; os dados exigem uma conta administradora autorizada.

O administrador autorizado entra com o e-mail e a senha já cadastrados no Supabase. A tela pública contém apenas o formulário de login. O e-mail precisa estar registrado em `public.direct_admins`; uma conta sem essa autorização não consegue ler ou alterar os dados da operação.

O arquivo `vercel.json` publica `static/`. O JavaScript desta pasta usa a chave publicável do Supabase, e as políticas RLS verificam o administrador em cada tabela. A chave de serviço e o banco SQLite não pertencem ao site ou repositório. Enviar alterações para `main` no GitHub aciona um novo deploy pela integração Git da Vercel.

Para adicionar outro administrador, inclua seu e-mail em `public.direct_admins` usando um acesso seguro ao banco. Não coloque a lista de administradores no código publicado. Os esquemas e políticas estão em `supabase/migrations/`.

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
- Registre outras entradas e saídas com descrição, cliente ou favorecido, categoria, valor, vencimento, data de liquidação e observações.
- Os cards mostram entradas, saídas e saldo **realizados no mês selecionado**, além do total de valores pendentes de receber e pagar em todos os períodos.
- O filtro de mês afeta a lista; a opção **Ver todos os meses** mostra todo o histórico. Há busca, filtros por tipo e situação, e exportação CSV do resultado filtrado.
- Diárias antigas sem valor ficam sinalizadas e não entram nos totais até serem completadas.
- Uma diária marcada como paga não pode ser excluída diretamente. Cadastros com diárias registradas também não podem ser excluídos, para preservar o histórico financeiro; use o bloqueio da diarista quando necessário.

## Pedidos dos supermercados

- Registre supermercado, unidade, contato, setor e número de diaristas necessário por dia.
- Adicione uma ou mais datas, cada uma com seu próprio horário de início e fim. A quantidade de dias e o total de diárias solicitadas são calculados automaticamente.
- Acompanhe a situação do pedido: novo, em seleção, confirmado, concluído ou cancelado.
- A lista oferece busca e filtro por situação; a ficha mostra todos os dias e horários e permite editar ou excluir o pedido.
- Um pedido corresponde a um setor e a uma quantidade de diaristas por dia. Para demandas diferentes por setor, registre pedidos separados.

## Leitura IA

- A aba **Leitura IA** aceita vários registros em texto, várias fotos e PDFs de até 10 MB e 20 páginas. O reconhecimento de texto em imagens usa Tesseract.js no navegador; PDFs usam PDF.js para texto e OCR nas páginas digitalizadas. As bibliotecas e o modelo de português são baixados da internet na primeira leitura. Não há chamada à API OpenAI nem cobrança por créditos.
- O sistema separa cadastros e pedidos pelas etiquetas das mensagens, identifica seus campos e registra automaticamente os completos. Verifica CPF, datas, loja e duplicidade antes de salvar. Informações incompletas ficam na lista **Informações pendentes**, preservadas no banco e disponíveis para completar no formulário.
- Para pedidos, intervalos abreviados como `29 a 05` são interpretados com base no dia atual em Fortaleza. A rede é associada ao nome da loja quando há correspondência única no catálogo. A quantidade de dias nunca é usada como quantidade de diaristas. Se a quantidade de pessoas não vier informada, o padrão da empresa é 1 por dia.
- A leitura segue formatos com etiquetas como `Nome Completo:`, `CPF:`, `Loja:`, `Função:` e `Horário:`. Texto ilegível, escrita manual ou mensagens ambíguas podem exigir revisão na lista de pendências.

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
