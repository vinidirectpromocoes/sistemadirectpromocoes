begin;
do $$
declare admin_uid uuid; admin_email text; payload jsonb; r text; denied boolean;
begin
 select u.id,u.email into admin_uid,admin_email from auth.users u join public.direct_admins a on a.email=u.email limit 1;
 if admin_uid is null then raise exception 'O ensaio exige um administrador existente.';end if;
 if has_function_privilege('anon','public.direct_backup_snapshot_v7()','EXECUTE') or
    has_function_privilege('authenticated','direct_private.backup_snapshot_v7()','EXECUTE') then
    raise exception 'Permissão indevida para exportar a cópia.';
 end if;
 if (select provolatile<>'s' from pg_proc where oid='direct_private.backup_snapshot_v7()'::regprocedure) then
    raise exception 'O snapshot precisa ser STABLE.';
 end if;
 insert into public.direct_staff(email,role,active) values
   ('backup-operation@example.invalid','operacao',true),
   ('backup-finance@example.invalid','financeiro',true),
   ('backup-view@example.invalid','consulta',true);
 for r in select unnest(array['backup-operation@example.invalid','backup-finance@example.invalid','backup-view@example.invalid']) loop
   perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'email',r,'role','authenticated')::text,true);
   execute 'set local role authenticated';denied:=false;
   begin perform public.direct_backup_snapshot_v7();exception when insufficient_privilege then denied:=true;end;
   execute 'reset role';if not denied then raise exception 'Perfil % exportou indevidamente.',r;end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'email',admin_email,'role','authenticated')::text,true);
 execute 'set local role authenticated';payload:=public.direct_backup_snapshot_v7();execute 'reset role';
 if payload->>'format'<>'direct-data-v7' or (payload->'snapshot'->>'consistent')::boolean is not true
   or (select count(*) from jsonb_object_keys(payload->'tables'))<>28 then raise exception 'Cópia incompleta.';end if;
 if exists(select 1 from jsonb_each(payload->'tables') t where jsonb_array_length(t.value)<>(payload->'snapshot'->'counts'->>t.key)::int) then raise exception 'Contagens divergentes.';end if;
 if payload->'tables'->'portal_config'<>(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from direct_private.portal_config t)
 or payload->'tables'->'portal_vagas_link'<>(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from direct_private.portal_vagas_link t) then raise exception 'Contatos ou links divergentes.';end if;
end $$;
select 'Backup v7: 28 tabelas, snapshot consistente e acesso restrito ao admin verificados; teste revertido.' result;
rollback;
