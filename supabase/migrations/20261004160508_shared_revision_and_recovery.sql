-- Global revision: no personal information exposed; roles checked at the boundary.
create table direct_private.data_revision (id boolean primary key default true check(id), version bigint not null default 0);
alter table direct_private.data_revision enable row level security;
revoke all on direct_private.data_revision from public, anon, authenticated;
insert into direct_private.data_revision values(true,0);
create function direct_private.bump_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin update direct_private.data_revision set version=version+1 where id; return null; end;$$;
revoke all on function direct_private.bump_revision() from public, anon, authenticated;
do $$declare t text;begin foreach t in array array['pedidos','pedido_escalas','diaristas','diarias','lojas','financeiro_lancamentos','tarifas_redes','tarifas_setores','custos_extras','contratos','ocorrencias','leituras_pendentes','loja_solicitacoes','loja_validacoes'] loop
execute format('create trigger direct_revision after insert or update or delete on public.%I for each statement execute function direct_private.bump_revision()',t); end loop;end;$$;
create function public.direct_data_revision() returns text language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao','financeiro','consulta') then raise exception 'Acesso não permitido.' using errcode='42501';end if;
return (select version::text from direct_private.data_revision where id);end;$$;
revoke all on function public.direct_data_revision() from public,anon,authenticated;
grant execute on function public.direct_data_revision() to authenticated;
-- Backup credential is read-only, scoped, expiring and revocable; only its hash is stored.
create table direct_private.backup_agents(id uuid primary key default gen_random_uuid(), token_hash text unique not null, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '365 days', revoked boolean not null default false);
create table direct_private.backup_runs(id uuid primary key, agent_id uuid references direct_private.backup_agents(id), started_at timestamptz not null default now(), finished_at timestamptz, state text not null check(state in ('running','ok','error')), checksum text, size_bytes bigint, message text, verified boolean not null default false);
alter table direct_private.backup_agents enable row level security;
alter table direct_private.backup_runs enable row level security;
revoke all on direct_private.backup_agents,direct_private.backup_runs from public,anon,authenticated;
create function direct_private.backup_agent(p_token text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare agent uuid;begin
if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Credencial inválida.' using errcode='42501';end if;
select id into agent from direct_private.backup_agents where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and not revoked and expires_at>now();
if agent is null then raise exception 'Credencial inválida ou expirada.' using errcode='42501';end if;return agent;end;$$;
revoke all on function direct_private.backup_agent(text) from public,anon,authenticated;
create function public.direct_backup_agent_create() returns jsonb language plpgsql security definer set search_path='' as $$
declare token text:=encode(extensions.gen_random_bytes(32),'hex');agent uuid;begin
if auth.uid() is null or coalesce(direct_private.member_role(),'')<>'admin' then raise exception 'Somente administrador.' using errcode='42501';end if;
insert into direct_private.backup_agents(token_hash) values(encode(extensions.digest(token,'sha256'),'hex')) returning id into agent;
return jsonb_build_object('id',agent,'token',token);end;$$;
revoke all on function public.direct_backup_agent_create() from public,anon,authenticated;
grant execute on function public.direct_backup_agent_create() to authenticated;
create function public.direct_backup_agent_revoke(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null or coalesce(direct_private.member_role(),'')<>'admin' then raise exception 'Somente administrador.' using errcode='42501';end if;update direct_private.backup_agents set revoked=true where id=p_id;end;$$;
revoke all on function public.direct_backup_agent_revoke(uuid) from public,anon,authenticated;
grant execute on function public.direct_backup_agent_revoke(uuid) to authenticated;
create function public.direct_backup_bundle(p_token text,p_run uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare agent uuid:=direct_private.backup_agent(p_token);result jsonb;begin
insert into direct_private.backup_runs(id,agent_id,state) values(p_run,agent,'running');
-- Repeatable statement snapshot. Sessions/refresh tokens and backup agent tokens are never exported.
select jsonb_build_object('format','direct-recovery-v1','exportedAt',now(),'data',direct_private.backup_snapshot_v7(),
'auth',jsonb_build_object('users',(select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) from auth.users u),'identities',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from auth.identities i)),
'access',jsonb_build_object('roles',(select coalesce(jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit)),'[]'::jsonb) from pg_roles where rolname in ('anon','authenticated','service_role')),
'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from pg_policies p where schemaname in ('public','direct_private')),
'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'ddl',pg_get_functiondef(p.oid),'grants',p.proacl)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','direct_private') and p.prokind='f'),
'columns',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from information_schema.columns c where table_schema in ('public','direct_private')),
'indexes',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from pg_indexes i where schemaname in ('public','direct_private')),
'constraints',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',r.relname,'name',c.conname,'ddl',pg_get_constraintdef(c.oid))),'[]'::jsonb) from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname in ('public','direct_private')))) into result;
return result;end;$$;
revoke all on function public.direct_backup_bundle(text,uuid) from public,anon,authenticated;
grant execute on function public.direct_backup_bundle(text,uuid) to anon,authenticated;
create function public.direct_backup_agent_result(p_token text,p_run uuid,p_ok boolean,p_checksum text,p_bytes bigint,p_verified boolean,p_message text default '') returns void language plpgsql security definer set search_path='' as $$
declare agent uuid:=direct_private.backup_agent(p_token);begin
if p_ok and (coalesce(p_checksum,'') !~ '^[a-f0-9]{64}$' or coalesce(p_bytes,0)<=0 or not coalesce(p_verified,false)) then raise exception 'Cópia sem verificação.';end if;
update direct_private.backup_runs set finished_at=now(),state=case when p_ok then 'ok' else 'error' end,checksum=p_checksum,size_bytes=p_bytes,verified=p_verified,message=left(p_message,300) where id=p_run and agent_id=agent and state='running';
if not found then raise exception 'Execução não encontrada.' using errcode='42501';end if;end;$$;
revoke all on function public.direct_backup_agent_result(text,uuid,boolean,text,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.direct_backup_agent_result(text,uuid,boolean,text,bigint,boolean,text) to anon,authenticated;
create function public.direct_backup_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null or coalesce(direct_private.member_role(),'')<>'admin' then raise exception 'Somente administrador.' using errcode='42501';end if;
return jsonb_build_object('runs',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from(select id,started_at,finished_at,state,checksum,size_bytes,verified,message from direct_private.backup_runs order by started_at desc limit 30)r),'agents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'expires_at',expires_at,'revoked',revoked)),'[]'::jsonb) from direct_private.backup_agents));end;$$;
revoke all on function public.direct_backup_status() from public,anon,authenticated;
grant execute on function public.direct_backup_status() to authenticated;
