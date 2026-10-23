# Manutenção da Direct Promoções

O proprietário acompanha o sistema pelo celular. Execute desenvolvimento, testes e publicação em ambientes na nuvem, usando as conexões autorizadas; não dependa do notebook ou do Mac do proprietário.

## Comece por aqui

- Leia `docs/MANUTENCAO_NUVEM.md` para alvos, módulos, fluxo e limitações verificados.
- Atualize a leitura da branch `main` antes de cada tarefa. GitHub é a fonte persistente do código; o checkout do ambiente de trabalho pode ser temporário.
- Produção: Vercel publica `static/`; dados, Auth e regras estão no Supabase. O SQLite de `server.py` é independente e não sincroniza com produção.
- Relatórios datados são históricos. Confira código, banco e publicação atuais antes de assumir que descrevem o estado vigente.

## Alterações e validação

- Trabalhe em branch `codex/...`, abra PR e acompanhe os checks no commit final. Preserve as proteções existentes de `main`.
- Para publicar, confira os quatro jobs de qualidade: `test` e as três áreas de navegação. Depois do merge, confirme o commit e o estado READY na Vercel.
- Execute testes de dados com bases isoladas e registros sintéticos. Não use os cadastros reais para ensaios.
- Para mudanças no banco, inspecione esquema e histórico remoto; os timestamps das migrações antigas nem sempre coincidem com os arquivos. Não reaplique migrações existentes só pela diferença no nome do arquivo.
- Mudanças em arquivos publicados devem considerar atualização do service worker e funcionamento em celular. Preserve permissões, histórico de escalas e valores de diárias já realizadas/pagas.
- Registre o resultado relevante em documentação versionada. Diga ao proprietário o que mudou, o que foi validado e o que continua pendente.

## Dados e recuperação

- Não publique dados pessoais, convites privados, credenciais, senhas, chaves secretas ou backups descriptografados em código, PRs, logs ou relatórios.
- A rotina de backup em `scripts/backup_agent.py` depende do Chaves e do agendamento do macOS. Não a descreva como backup automático na nuvem.
- A manutenção remota não configura por si só backup remoto. Verifique o histórico em `direct_private.backup_runs` consultando somente metadados; consulte `docs/RECUPERACAO.md` antes de mudanças nessa área.
