-- Exclusão atômica de pedidos sem histórico de execução ou financeiro.
create function public.direct_delete_order(p_id bigint, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.pedidos%rowtype; removed integer;
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then
  raise exception 'Sem permissão para excluir pedidos.' using errcode='42501';
 end if;
 select * into o from public.pedidos where id=p_id for update;
 if o.id is null then raise exception 'Pedido não encontrado ou sem permissão.';end if;
 if p_expected_updated_at is not null and o.atualizado_em is distinct from p_expected_updated_at then
  raise exception 'Este pedido foi alterado por outra pessoa. Atualize a lista e abra novamente antes de excluir.' using errcode='40001';
 end if;
 perform 1 from public.pedido_escalas where pedido_id=p_id order by id for update;
 if exists(select 1 from public.pedido_escalas where pedido_id=p_id and status<>'escalada')
 or exists(select 1 from public.diarias d join public.pedido_escalas e on e.id=d.pedido_escala_id where e.pedido_id=p_id)
 or exists(select 1 from public.cobranca_itens where pedido_id=p_id)
 or exists(select 1 from public.loja_validacoes v join public.pedido_escalas e on e.id=v.escala_id where e.pedido_id=p_id) then
  raise exception 'Este pedido possui histórico de presença, falta, desistência, conferência ou financeiro. Cancele o pedido para preservar esses registros.';
 end if;
 if exists(select 1 from public.ocorrencias where pedido_id=p_id or escala_id in(select id from public.pedido_escalas where pedido_id=p_id)) then
  raise exception 'Este pedido possui ocorrências registradas. Cancele o pedido para preservar o histórico.';
 end if;
 delete from public.pedido_escalas where pedido_id=p_id;
 get diagnostics removed=row_count;
 delete from public.pedidos where id=p_id;
 if not found then raise exception 'Pedido não excluído. Confira sua permissão.';end if;
 return jsonb_build_object('ok',true,'escalas_removidas',removed);
end;$$;
revoke all on function public.direct_delete_order(bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.direct_delete_order(bigint,timestamptz) to authenticated;
