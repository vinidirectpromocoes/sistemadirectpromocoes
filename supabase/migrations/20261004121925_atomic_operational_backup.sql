-- A STABLE function shares the caller's MVCC snapshot for every table.
-- Private helper is not exposed; the public wrapper verifies a real admin session.
create function direct_private.backup_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
 with data as (select jsonb_build_object(
    'diaristas', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.diaristas t),
    'diarias', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.diarias t),
    'pedidos', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pedidos t),
    'pedido_escalas', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pedido_escalas t),
    'lojas', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.lojas t),
    'financeiro_lancamentos', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.financeiro_lancamentos t),
    'tarifas_redes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.tarifas_redes t),
    'tarifas_setores', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.tarifas_setores t),
    'leituras_pendentes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.leituras_pendentes t),
    'direct_staff', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.direct_staff t),
    'direct_auditoria', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.direct_auditoria t),
    'cobrancas', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.cobrancas t),
    'cobranca_itens', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.cobranca_itens t),
    'cobranca_recebimentos', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.cobranca_recebimentos t),
    'pagamento_lotes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pagamento_lotes t),
    'custos_extras', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.custos_extras t),
    'contratos', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.contratos t),
    'ocorrencias', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.ocorrencias t),
    'direct_admins', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.direct_admins t),
    'portal_cadastros', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.portal_cadastros t),
    'portal_config', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from direct_private.portal_config t),
    'portal_convites', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from direct_private.portal_convites t),
    'portal_registros', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from direct_private.portal_registros t),
    'portal_vagas_link', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from direct_private.portal_vagas_link t)
 ) tables)
 select jsonb_build_object('format','direct-data-v5','exportedAt',now(),
   'tables',data.tables,'snapshot',jsonb_build_object('consistent',true,
     'counts',(select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(data.tables))))
 from data;
$$;
revoke all on function direct_private.backup_snapshot() from public,anon,authenticated;
create function public.direct_backup_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'')<>'admin' then
   raise exception 'Somente o administrador pode baixar a cópia.' using errcode='42501';
 end if;
 return direct_private.backup_snapshot();
end;
$$;
revoke all on function public.direct_backup_snapshot() from public,anon,authenticated;
grant execute on function public.direct_backup_snapshot() to authenticated;
comment on function public.direct_backup_snapshot() is 'Admin-only consistent operational backup; excludes Supabase Auth credentials.';
