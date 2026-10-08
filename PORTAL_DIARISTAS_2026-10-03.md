# Cadastro e vagas por convite privado — 03/10/2026

## Fluxo atual

- O link de cadastro é acompanhado na aba **Cadastros por link**; o link compartilhado de oportunidades fica em **Vagas disponíveis**. São páginas separadas. Convites individuais de aceite vinculam a pessoa/CPF, vencem na data informada e usam segredos aleatórios de 256 bits no fragmento da URL.
- O cadastro coleta nome, CPF válido, telefone, nascimento, CEP, endereço, cidade/UF, setores, dias/horários, locomoção e trabalho atual. Não pede e-mail, senha ou conta.
- ViaCEP preenche rua, bairro, cidade e UF. Se a consulta falhar, o formulário permite preencher o endereço manualmente. Número da casa é informado pelo diarista.
- Após salvar, aparece “Cadastro concluído”, agradecimento, contato WhatsApp, grupo e link privado de vagas. WhatsApp da Direct e grupo estão configurados e podem ser atualizados nas Configurações.
- O link compartilhado de vagas mostra escalas com vagas em todos os dias restantes e ainda não iniciados. Não oferece filtros nem seleção de dias.
- No catálogo compartilhado, “Quero pegar essa vaga” abre contato com a Direct para receber convite individual. O aceite efetivo exige cadastro vinculado ao convite individual. A pessoa confirma o CPF e o compromisso com todos os dias. Não marca presença: isso continua sendo feito pela equipe no dia da diária.
- Funcionário de supermercado não pode assumir diária na rede em que trabalha. O aviso aparece no formulário; a API verifica rede/local de trabalho declarados ao aceitar a escala.

## Duplicidade e segurança

- CPF já cadastrado não é atualizado ou vinculado pelo simples conhecimento do documento. A equipe deve gerar o convite especificando esse CPF; o vínculo é criado por essa emissão autorizada.
- Repetir um envio com o mesmo convite não duplica a pessoa. Repetir a confirmação não duplica escalas. Qualquer conflito reverte todos os dias.
- A API confere convite válido, vínculo, CPF, bloqueio, empresa, capacidade, datas futuras e conflitos de horário. Não disponibiliza nomes/CPF de outros diaristas nem valores faturados pela Direct.
- Convites e contatos ficam em esquema privado com RLS e sem acesso direto pelos clientes. Funções públicas acessíveis sem Auth existem intencionalmente para o formulário: todas validam o convite antes de acessar dados.
- APIs antigas de criação de conta foram revogadas. A Edge Function antiga retorna 410 sem criar usuário. Registros Auth anteriores são preservados; não dão acesso ao painel interno, que continua exigindo perfil de funcionário.
- A posse do link privado identifica seu destinatário. Envie os links individualmente; gerar convite para um CPF conhecido é o caminho de recuperação e vínculo. Não são páginas abertas de inscrição.

## Verificação

- Testes de formulário em Chromium e WebKit: larguras 1280, 390 e 320; sem campos de conta, CPF, endereço por CEP e falha do serviço, vários setores/dias/transportes, turnos, horários inválidos, mensagem final, identidade e escala completa. Serviços externos simulados nesses testes.
- SQL real no Supabase com dados sintéticos e rollback: cadastro completo sem criar Auth, duplicidade, nascimento futuro, vínculo privado, token original e token após conclusão, confirmação/estado do pedido, repetição, conflito atômico, mesma empresa, bloqueio, convite vencido e permissões.
- Testes Python de integração/backup e JavaScript de regras de negócio. Conferência visual e disponibilidade após publicação registradas no relatório final da tarefa.
- Safari/iPhone e Chrome/Android físicos não foram controlados nesta alteração. Não há bloqueio do zoom de acessibilidade; fontes dos campos têm 16px para evitar zoom automático ao digitar.

## Contatos e backup atualizados

WhatsApp: `5585988349664`. Grupo configurado pela Direct nas Configurações. Nenhuma assinatura ou serviço pago foi adicionado. Backup v5 inclui contatos, convites, origem dos cadastros e link compartilhado em snapshot consistente, criptografado pelo navegador. Não inclui contas/senhas do Supabase Auth.
