create function direct_private.backup_snapshot_v10() returns jsonb language sql stable security invoker set search_path='' as $$
with data as(select direct_private.backup_snapshot_v9()->'tables'||jsonb_build_object(
 'empresa_registros',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.empresa_registros t),
 'empresa_extrato',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.empresa_extrato t),
 'empresa_anexos',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.empresa_anexos t),
 'empresa_compartilhamentos',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from direct_private.empresa_compartilhamentos t)) tables)
select jsonb_build_object('format','direct-data-v10','exportedAt',now(),'tables',tables,'snapshot',jsonb_build_object('consistent',true,'counts',(select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(data.tables)))) from data;$$;
revoke all on function direct_private.backup_snapshot_v10() from public,anon,authenticated;
create function public.direct_backup_snapshot_v10() returns jsonb language plpgsql stable security definer set search_path='' as $$begin if auth.uid() is null or coalesce(direct_private.member_role(),'')<>'admin' then raise exception 'Somente administrador.' using errcode='42501';end if;return direct_private.backup_snapshot_v10();end;$$;
revoke all on function public.direct_backup_snapshot_v10() from public,anon,authenticated;grant execute on function public.direct_backup_snapshot_v10() to authenticated;
do $$declare ddl text;begin select pg_get_functiondef('public.direct_backup_bundle(text,uuid)'::regprocedure) into ddl;execute replace(ddl,'direct_private.backup_snapshot_v9()','direct_private.backup_snapshot_v10()');end;$$;
create function public.direct_backup_attachment_manifest(p_token text,p_run uuid,p_ids bigint[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare agent uuid:=direct_private.backup_agent(p_token);begin
 if not exists(select 1 from direct_private.backup_runs where id=p_run and agent_id=agent and state='running' and started_at>now()-interval '30 minutes') or cardinality(p_ids) not between 1 and 100 then raise exception 'Sessão de backup inválida.' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'caminho',a.caminho,'sha256',a.sha256,'bytes',a.bytes)),'[]') from public.empresa_anexos a where a.id=any(p_ids));end;$$;
revoke all on function public.direct_backup_attachment_manifest(text,uuid,bigint[]) from public,anon,authenticated;grant execute on function public.direct_backup_attachment_manifest(text,uuid,bigint[]) to anon,authenticated;
