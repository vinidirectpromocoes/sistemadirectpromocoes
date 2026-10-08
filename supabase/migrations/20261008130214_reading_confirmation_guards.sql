-- Confirma a versão da escala sob bloqueio antes de substituir pelo assistente.
create function public.direct_read_replace_worker(
 p_pedido_id bigint,p_escala_id bigint,p_diarista_id bigint,p_motivo text,
 p_disponibilidade_confirmada boolean,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.pedido_escalas%rowtype;
begin
 if coalesce((select direct_private.member_role()),'') not in ('admin','operacao') then
  raise exception 'Sem permissão para substituir uma pessoa.' using errcode='42501';
 end if;
 -- Mesma ordem de bloqueio usada pela substituição existente: pedido, depois escala.
 perform 1 from public.pedidos where id=p_pedido_id for update;
 select * into s from public.pedido_escalas where id=p_escala_id and pedido_id=p_pedido_id for update;
 if s.id is null then raise exception 'Escala não encontrada.';end if;
 if p_expected_updated_at is null or s.atualizado_em is distinct from p_expected_updated_at then
  raise exception 'A escala mudou depois da leitura. Confira novamente antes de substituir.' using errcode='40001';
 end if;
 return public.direct_replace_order_worker(p_pedido_id,p_escala_id,p_diarista_id,p_motivo,p_disponibilidade_confirmada);
end $$;
revoke all on function public.direct_read_replace_worker(bigint,bigint,bigint,text,boolean,timestamptz) from public,anon;
grant execute on function public.direct_read_replace_worker(bigint,bigint,bigint,text,boolean,timestamptz) to authenticated;

-- Uma escala planejada que substitui outra já pertence ao histórico da operação.
create function direct_private.guard_reading_scale_delete()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.substituida_por_escala_id is not null or exists(
  select 1 from public.pedido_escalas where substituida_por_escala_id=old.id
 ) then raise exception 'Esta escala faz parte de uma substituição. Preserve o histórico no pedido.';end if;
 return old;
end $$;
create trigger guard_reading_scale_delete before delete on public.pedido_escalas
 for each row execute function direct_private.guard_reading_scale_delete();
revoke all on function direct_private.guard_reading_scale_delete() from public,anon,authenticated;
