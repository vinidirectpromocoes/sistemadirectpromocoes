-- Índices completos das FKs de usuários; preserva RLS, grants e conteúdo dos convites.
set local lock_timeout = '5s';
create index portal_convites_criado_por_idx on direct_private.portal_convites (criado_por);
create index portal_convites_usado_por_idx on direct_private.portal_convites (usado_por);
