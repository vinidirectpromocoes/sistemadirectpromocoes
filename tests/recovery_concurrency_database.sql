begin;
do $$
declare uid uuid; email text; credential jsonb; token text; agent uuid; run uuid:=gen_random_uuid(); bundle jsonb; denied boolean; old_version text; worker bigint; revision text; columns text;
begin
select u.id,u.email into uid,email from auth.users u join public.direct_admins a on a.email=u.email limit 1;
if uid is null then raise exception 'Administrador necessário para ensaio.';end if;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
execute 'set local role authenticated';credential:=public.direct_backup_agent_create();revision:=public.direct_data_revision();execute 'reset role';
token:=credential->>'token';agent:=(credential->>'id')::uuid;
if token !~ '^[a-f0-9]{64}$' or exists(select 1 from direct_private.backup_agents where id=agent and token_hash=token) then raise exception 'Segredo armazenado sem hash.';end if;
execute 'set local role anon';denied:=false;begin perform public.direct_backup_bundle(repeat('0',64),run);exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'Credencial incorreta aceita.';end if;
-- Correct secret is read-only; no JWT impersonation and no sessions are exported.
bundle:=public.direct_backup_bundle(token,run);execute 'reset role';
if bundle->>'format'<>'direct-recovery-v1' or jsonb_array_length(bundle->'auth'->'users')<>(select count(*) from auth.users) or bundle->'auth' ? 'sessions' or (select count(*) from jsonb_object_keys(bundle->'data'->'tables'))<>28 then raise exception 'Recuperação incompleta.';end if;
execute 'set local role anon';denied:=false;begin perform public.direct_backup_status();exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'Histórico exposto ao anônimo.';end if;
denied:=false;begin perform public.direct_backup_agent_result(token,run,true,null,1,true,'');exception when others then denied:=true;end;
if not denied then raise exception 'Cópia sem hash aceita.';end if;
perform public.direct_backup_agent_result(token,run,true,repeat('a',64),10,true,'Ensaio revertido');execute 'reset role';
-- Rehydrate Auth identities into temporary tables, including constraints, without changing Auth.
create temporary table recovery_auth_users(like auth.users including all);
create temporary table recovery_auth_identities(like auth.identities including all);
select string_agg(quote_ident(attname),',' order by attnum) into columns from pg_attribute where attrelid='auth.users'::regclass and attnum>0 and not attisdropped and attgenerated='';
execute format('insert into recovery_auth_users(%s) select %s from jsonb_populate_recordset(null::auth.users,$1)',columns,columns) using bundle->'auth'->'users';
select string_agg(quote_ident(attname),',' order by attnum) into columns from pg_attribute where attrelid='auth.identities'::regclass and attnum>0 and not attisdropped and attgenerated='';
execute format('insert into recovery_auth_identities(%s) select %s from jsonb_populate_recordset(null::auth.identities,$1)',columns,columns) using bundle->'auth'->'identities';
if (select count(*) from recovery_auth_users)<>(select count(*) from auth.users) or exists(select 1 from recovery_auth_identities i left join recovery_auth_users u on u.id=i.user_id where u.id is null) then raise exception 'Identidades não recuperadas.';end if;
execute 'set local role authenticated';perform public.direct_backup_agent_revoke(agent);execute 'reset role';
execute 'set local role anon';denied:=false;begin perform public.direct_backup_bundle(token,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;execute 'reset role';
if not denied then raise exception 'Credencial revogada aceita.';end if;
-- Compare-and-swap test: stale editor cannot overwrite the first editor.
insert into public.diaristas(nome,cpf) values('Teste CAS 20261004','52998224725') returning id,atualizado_em::text into worker,old_version;
update public.diaristas set nome='Primeiro editor',atualizado_em=clock_timestamp() where id=worker and atualizado_em=old_version::timestamptz;
update public.diaristas set nome='Segundo editor' where id=worker and atualizado_em=old_version::timestamptz;
if found or (select nome from public.diaristas where id=worker)<>'Primeiro editor' then raise exception 'Versão antiga sobrescreveu dados.';end if;
execute 'set local role authenticated';if public.direct_data_revision()=revision then raise exception 'Revisão não atualizada.';end if;execute 'reset role';
end $$;
select 'Credenciais inválidas/revogadas bloqueadas; cópia integral criptografável; identidades restauradas em tabelas temporárias; CAS e revisão verificados. Tudo revertido.' as result;
rollback;
