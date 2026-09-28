create or replace function public.direct_guard_manual_daily_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.pedido_escala_id is null and exists (
    select 1 from public.diaristas where id = new.diarista_id and bloqueada
  ) then
    raise exception 'Desbloqueie a diarista antes de registrar uma nova diária.';
  end if;
  return new;
end;
$$;

create trigger guard_manual_daily_insert before insert on public.diarias
for each row execute function public.direct_guard_manual_daily_insert();

create or replace function public.direct_validate_pedido_escala()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.pedidos%rowtype;
  v_worker public.diaristas%rowtype;
  v_shift jsonb;
  v_day text;
  v_activating boolean;
begin
  if tg_op = 'UPDATE' then
    if (new.pedido_id, new.diarista_id, new.data) is distinct from (old.pedido_id, old.diarista_id, old.data) then
      raise exception 'A diarista e a data da escala não podem ser alteradas. Exclua a escala pendente e crie outra.';
    end if;
    if new.status = old.status then return new; end if;
    if old.status = 'presente' and new.status <> 'presente' and exists (
      select 1 from public.diarias where pedido_escala_id = old.id and data_pagamento is not null
    ) then
      raise exception 'A diária já foi paga. Corrija o pagamento antes de alterar a presença.';
    end if;
    if new.status in ('presente', 'falta') and new.data > (now() at time zone 'America/Fortaleza')::date then
      raise exception 'Presença ou falta só pode ser registrada a partir da data da diária.';
    end if;
    v_activating := old.status = 'falta' and new.status <> 'falta';
  else
    if new.status <> 'escalada' then
      raise exception 'Uma nova escala deve começar como escalada.';
    end if;
    v_activating := true;
  end if;

  select * into v_order from public.pedidos where id = new.pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  select t into v_shift from jsonb_array_elements(v_order.turnos) t where t->>'data' = new.data::text;
  if v_shift is null then raise exception 'A data escolhida não consta no pedido.'; end if;

  if v_activating then
    if v_order.situacao in ('concluido', 'cancelado') then
      raise exception 'Não é possível escalar uma diarista em pedido encerrado.';
    end if;
    select * into v_worker from public.diaristas where id = new.diarista_id for update;
    if not found or v_worker.bloqueada then
      raise exception 'Escolha uma diarista cadastrada e não bloqueada.';
    end if;
    v_day := (array['segunda','terca','quarta','quinta','sexta','sabado','domingo'])[extract(isodow from new.data)::integer];
    if not exists (
      select 1 from jsonb_array_elements(v_worker.disponibilidade) slot
      where slot->>'dia' = v_day
        and (slot->>'inicio')::time <= (v_shift->>'inicio')::time
        and (slot->>'fim')::time >= (v_shift->>'fim')::time
    ) then
      raise exception 'A diarista não está disponível nesse dia e horário.';
    end if;
    if exists (
      select 1 from public.pedido_escalas e
      join public.pedidos p on p.id = e.pedido_id
      cross join lateral jsonb_array_elements(p.turnos) t
      where e.diarista_id = new.diarista_id and e.data = new.data and e.status <> 'falta'
        and (tg_op = 'INSERT' or e.id <> new.id)
        and t->>'data' = e.data::text
        and (t->>'inicio')::time < (v_shift->>'fim')::time
        and (v_shift->>'inicio')::time < (t->>'fim')::time
    ) then
      raise exception 'A diarista já está escalada em outro pedido nesse horário.';
    end if;
    if (
      select count(*) from public.pedido_escalas
      where pedido_id = new.pedido_id and data = new.data and status <> 'falta'
    ) >= v_order.quantidade_diaristas then
      raise exception 'A quantidade de diaristas deste dia já foi preenchida.';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;
