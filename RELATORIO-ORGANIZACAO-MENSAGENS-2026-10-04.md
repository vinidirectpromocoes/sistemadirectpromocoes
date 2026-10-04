# Organização, backup e mensagens — 04/10/2026

## O que foi implementado

| Melhoria | Resultado |
|---|---|
| Backup consistente | Uma leitura do Postgres captura 24 tabelas, incluindo contatos, origem dos cadastros, autorizações internas, convites e link privado de vagas. Exportação somente pelo administrador, com criptografia AES-GCM no navegador. |
| Recuperação isolada | Verificação de contagens, duplicidades e vínculos. Restauração em SQLite novo, sem sobrescrever arquivos ou a produção. Configurações privadas preservadas em área administrativa da cópia operacional. Compatibilidade com backups antigos. |
| Pendências simples | Quatro atalhos: Precisa de diarista, Aguardando confirmação, Presença a registrar e Pagamento a realizar. Um pedido aparece uma vez; os dias e motivos ficam nos detalhes. Filtros de prazo ficam recolhidos. |
| Mensagens copiáveis | Pedido/equipe, divulgação de vaga, endereço, lembrete individual, solicitação de substituição e resumo de diárias/pagamentos. Prévia editável, restaurar texto e copiar; alternativa manual se o navegador bloquear a cópia. |
| Telas enxutas | Informações complementares da ficha e do pedido ficam em “Ver detalhes”. Cadastro parcial tem acesso direto por “Completar”. Uma única diária agora também abre a consulta e o resumo de pagamento. |
| Documentação e publicação | README atualizado para o funcionamento atual; documentos antigos corrigidos onde conflitavam com as regras recentes. Novos testes entram no workflow de qualidade existente. Proteção obrigatória da main preparada, mas pendente da verificação de identidade solicitada pelo GitHub. |

## Como usar as mensagens

1. Em **Pedidos**, abra o pedido e clique em **Mensagens para copiar**.
2. Escolha o modelo. O sistema consulta o pedido, a loja e a escala ao abrir a prévia.
3. Confira o texto, ajuste se necessário e clique em **Copiar mensagem**. Cole no WhatsApp.
4. Em **Financeiro → Ver diárias → Resumo para copiar**, consulte pagamentos da pessoa selecionada, conforme os itens do filtro aberto.

O endereço usa `*Rede:*`, `*Loja:*` e `*Endereço:*` para negrito no WhatsApp. A equipe aparece em cada dia, com distinção entre compromisso confirmado, resposta pendente e presença registrada. Vagas incluem somente dias ainda disponíveis e não iniciados. Uma recusa ainda vinculada à escala exige substituição antes de divulgar a vaga. CPF e receita do supermercado não entram nas mensagens. Não há envio automático.

## Verificações

- Regras de negócio: **65 testes aprovados**.
- Backend e restauração: **47 testes aprovados**, incluindo seis testes de recuperação, senha incorreta, referência quebrada, destino existente, dados privados e integridade.
- Novas mensagens: Chromium e WebKit, larguras 1280, 390 e 320 px; equipe/endereço, vagas, edição, restauração, cópia, bloqueio da área de transferência, pagamento e abertura de cadastro parcial.
- Suíte integrada: navegação, permissões dos quatro perfis, formulários, leitura/revisão, presença/falta, previsão financeira, pagamentos, escala de vários dias, persistência, substituição, filtros, calendários, pendências, temas e rascunho offline.
- Portal: cadastro sem conta, ViaCEP/fallback, conclusão, origem do cadastro, links separados, vagas atualizadas, convite vinculado e aceite da escala inteira; mesmos dois motores e três larguras.
- Backup pelo navegador: download criptografado → verificação → restauração isolada de consulta e operacional.
- Banco real: snapshot de 24 tabelas e contagens conferidos. Exportação negada a anônimo, operação, financeiro e consulta; administrador autorizado. Fixtures SQL terminam em rollback.
- Banco real após os ensaios: **zero cadastros, pedidos, escalas, diárias e lançamentos**. Preservados **44 lojas, seis redes e dez setores**.

As falhas encontradas durante o desenvolvimento foram corrigidas: novos scripts ausentes da lista de arquivos do servidor local; consulta de pagamento indisponível para uma única diária; teste antigo esperando 18 tabelas após a expansão para 24; limpeza do teste tentando excluir pedido antes de retirar a escala. Os novos testes de mensagens também verificam vagas sem ignorar pessoas ainda vinculadas e sem divulgar turnos já iniciados.

## Segurança e limites verificados

O Supabase Advisor mantém avisos sobre funções SECURITY DEFINER e tabelas privadas sem políticas. A função nova de exportação também é sinalizada por ser SECURITY DEFINER para authenticated: foi revisada com search_path vazio, helper privado sem execução por clientes e verificação explícita de administrador. Os testes negativos confirmaram que outros perfis não exportam dados. Os avisos não devem ser tratados automaticamente como resolvidos.

A proteção contra senhas vazadas permanece desativada; não foi contratado plano pago para ativá-la. Referências do Advisor: [funções com privilégio de definidor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [segurança de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). A função adicionada tem search_path explícito; o aviso de execução por authenticated é mitigado pelo bloqueio de perfis na própria função.

O backup de dados não inclui senhas/contas do Supabase Auth, chaves da infraestrutura ou código. Recuperação em novo Supabase exige migrações, remapeamento das contas autorizadas e validação antes de trocar a produção. O teste de restauração desta entrega é em base SQLite isolada, não uma troca real de projeto Supabase.

Testes móveis usam emulação Chromium/WebKit; não constituem uma nova conferência em aparelho físico. OCR não foi alterado nesta entrega; baixa confiança e revisão foram testadas com respostas controladas, sem repetir o ensaio de fotos/PDFs reais.

## Única configuração externa pendente

O GitHub pediu **Confirm access** antes de salvar a proteção da `main`. Foi solicitada ao proprietário a verificação por e-mail no navegador do Codex, sem pedir código ou senha pelo chat. Até concluir e confirmar o salvamento, a regra não pode ser declarada ativa. Publicação desta entrega usa PR, check aprovado no commit exato e verificação do deploy; a exigência técnica obrigatória para futuras alterações ainda depende dessa etapa do GitHub.

Regra preparada: PR obrigatório, check `test` do GitHub Actions, branch atualizada, conversas resolvidas e aplicação a administradores. Aprovação manual adicional não foi exigida para manter o fluxo de uma empresa com um administrador.
