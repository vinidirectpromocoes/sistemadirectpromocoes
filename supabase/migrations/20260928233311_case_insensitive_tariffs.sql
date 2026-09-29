create or replace function public.direct_sync_pedido_presenca()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.pedidos%rowtype;
  v_recebido bigint;
  v_pago bigint;
begin
  if new.status = old.status then return null; end if;
  if new.status = 'presente' then
    select * into v_order from public.pedidos where id = new.pedido_id;
    select valor_recebido_centavos, valor_padrao_centavos
      into v_recebido, v_pago from public.tarifas_redes where lower(rede) = lower(v_order.supermercado);
    select coalesce(s.valor_pago_centavos, v_pago) into v_pago
      from public.tarifas_setores s
      where lower(s.setor) = lower(v_order.setor)
        and (lower(s.rede) = lower(v_order.supermercado) or s.rede is null)
        and s.valor_pago_centavos is not null
      order by case when lower(s.rede) = lower(v_order.supermercado) then 0 else 1 end
      limit 1;
    -- SELECT INTO sem correspondência atribui NULL; o padrão da rede continua válido.
    if v_pago is null then
      select valor_padrao_centavos into v_pago from public.tarifas_redes where lower(rede) = lower(v_order.supermercado);
    end if;
    insert into public.diarias
      (diarista_id, data, local, setor, observacoes, pedido_escala_id,
       valor_centavos, valor_recebido_centavos, vencimento_pagamento)
    values (new.diarista_id, new.data,
      v_order.supermercado || case when v_order.unidade = '' then '' else ' · ' || v_order.unidade end,
      v_order.setor, 'Presença no pedido #' || new.pedido_id, new.id,
      v_pago, v_recebido, case when v_pago is not null then new.data else null end);
  elsif old.status = 'presente' then
    delete from public.diarias where pedido_escala_id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public.direct_sync_pedido_presenca() from public, anon, authenticated;
