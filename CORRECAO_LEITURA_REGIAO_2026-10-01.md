# Correção da leitura — Região e nome sem rótulo

## Causa

O formato enviado utilizava `Região: LOJA VILA UNIÃO` e o nome em uma linha própria, antes do CPF. A leitura anterior reconhecia `Loja`/`Unidade` e exigia um rótulo como `Nome:` para uma pessoa sem cadastro.

## Correção

- `Região` e `Regiao` também identificam a loja, respeitando a rede e o catálogo de lojas.
- Nome escrito sozinho, com ou sem asteriscos, é reconhecido quando aparece imediatamente antes do CPF, ignorando linhas vazias.
- Nomes com acentos, apóstrofos e hífens são aceitos. Títulos como `NOVA SOLICITAÇÃO` e `Dados para Cadastro` não são usados como nome.
- A quantidade de dias é contada incluindo a data inicial. No pedido mostrado: Hipermarket / Vila União, Repositor de mercearia, 03 e 04/10/2026, 13:40–22:00, um diarista por dia.
- Cadastro novo continua básico: nome e CPF. Endereço, experiência e disponibilidade geral permanecem para completar posteriormente.
- Após reconhecer, o botão `Cadastrar diarista e salvar pedido` salva cadastro, pedido e as escalas em conjunto. Pessoa já cadastrada é reutilizada.
- Dois nomes/CPFs no mesmo pedido ficam para revisão. Cadastros e pedidos em lote mantêm suas informações separadas.
- Reconhecimento de região foi limitado a campos da mensagem para não confundir `posso ir para qualquer região` no cadastro com um pedido.
- O cache do aplicativo foi atualizado para receber a correção no celular.

## Testes

38 testes JavaScript aprovados, com cinco regressões novas para o formato do print, nome livre em cadastros, cabeçalhos, lote por região e duas pessoas no mesmo pedido. O exemplo real foi conferido localmente; as versões publicadas dos testes utilizam nomes/CPFs de exemplo.

Fluxo completo aprovado em Chromium e WebKit, 1280, 390 e 320 pixels: reconhecimento, sugestão, cadastro básico, duas escalas, reutilização de pedido existente, recarga antes da confirmação, releitura sem duplicação e abertura do pedido. Testes em tela móvel emulada; esta entrega não realizou novo ensaio em iPhone físico.

A rotina de publicação inclui os 36 testes de backend/restauração, regras de negócio, navegação, perfis, financeiro e os testes móveis. As gravações do navegador utilizaram uma base local isolada. Não foram criados pedidos ou cadastros operacionais reais para testar a correção.

## Como usar após atualizar

Recarregue o sistema, abra Leitura IA e envie novamente a mesma mensagem. Para a pendência anterior, use `Abrir e completar` e depois `Ler e registrar tudo`; o texto original é preservado. Confira os dados reconhecidos e confirme o botão de cadastro quando a pessoa ainda não estiver cadastrada.

Não há nova API paga nem mudança na estrutura do banco.
