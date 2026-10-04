# Recuperação da Direct

## Conteúdo e limites

A rotina diária guarda uma cópia criptografada AES-GCM fora do projeto, com 30 versões. Inclui as 30 tabelas operacionais (incluindo organização de pendências e respostas de substituição), usuários e identidades do Auth (incluindo hashes, nunca sessões ativas), políticas, funções, estrutura e código/migrações. A senha e a credencial exclusiva de leitura ficam no Chaves do macOS (`br.com.direct.backup`). Não dependem de API paga. O Mac precisa estar ligado e com a sessão acessível; a tela de Configurações avisa se a última cópia ficou antiga. A execução retorna ao iniciar a sessão. Credenciais vencem em um ano e podem ser revogadas pelo administrador.

Se o iCloud Drive já estiver disponível no Mac, uma segunda cópia criptografada é criada em `Direct Backups`. Isso não contrata serviço nem confirma sincronização remota; verifique o espaço e a sincronização no seu iCloud. Sem ele, há uma cópia local fora do repositório: copie os arquivos para outro aparelho/disco. O Chaves também precisa ser preservado para recuperar a senha. Não existe recuperação de criptografia sem a senha.

Configuração e segredos do provedor (Vercel/Supabase), buckets/arquivos de Storage e sessões ativas não são um dump restaurável do provedor. O sistema não utiliza Storage para guardar os anexos de leitura. Registre as configurações externas e preserve o acesso às contas dos provedores.

## Ensaio sem mexer na produção

No Mac configurado: `python scripts/verify_recovery.py caminho/arquivo.directbackup`. A rotina usa a senha no Chaves e cria/apaga uma base SQLite temporária. Não altera produção.

1. Descriptografar a cópia com `scripts/backup_agent.decrypt` e senha do Chaves. Validar com `validate_bundle` antes de extrair. Não compartilhar o conteúdo aberto.
2. Extrair `database.json`. `data` é o snapshot operacional compatível com `scripts/restore_backup.py`; restaurá-lo em SQLite temporário, nunca sobre o banco em uso. Conferir contagens, vínculos, presenças, preços históricos e calendários.
3. Para Postgres/Supabase, criar uma base isolada com as mesmas versões e aplicar `source/supabase/migrations` na ordem. Configurar Auth e provedores na nova base. Restaurar dados com dependências e IDs originais; restaurar usuários e identidades somente na instância isolada de Auth, preservando UUIDs. Ajustar sequências. Não restaurar sessões nem credenciais antigas do agente.
4. Rodar os testes SQL e de navegação do código incluído. Só promover após conferência de contagens e autorização administrativa. Um backup operacional SQLite não substitui um ensaio de recriação de um projeto Supabase inteiro.

A verificação automática autentica a criptografia, testa a integridade do ZIP, contagens, identidades e hashes dos arquivos. O histórico central mostra o resultado; somente administradores conseguem lê-lo. Os testes de recuperação locais e os testes SQL usam bases temporárias/rollback. Não declare recuperação completa do provedor sem ensaio em instância isolada.
