-- Escalas independentes por pedido: dias, disponibilidade e sobreposição não bloqueiam a escolha.
CREATE OR REPLACE FUNCTION public.direct_validate_pedido_escala()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_order public.pedidos%rowtype;
  v_worker public.diaristas%rowtype;
  v_shift jsonb;
  v_day text;
  v_activating boolean;
begin
  if tg_op = 'UPDATE' then
    if new.disponibilidade_pedido_confirmada is distinct from old.disponibilidade_pedido_confirmada then raise exception 'A disponibilidade informada no pedido é um registro de origem e não pode ser trocada.'; end if;
    if (new.pedido_id, new.diarista_id, new.data) is distinct from (old.pedido_id, old.diarista_id, old.data) then
      raise exception 'A diarista e a data da escala não podem ser alteradas. Exclua a escala pendente e crie outra.';
    end if;
    if old.status='desistiu' and new.status<>'desistiu' then raise exception 'Preserve a desistência registrada. Escolha uma substituição.'; end if;
    if new.status='desistiu' and old.status not in ('escalada','desistiu') then raise exception 'Desistência disponível apenas antes da presença ou falta.'; end if;
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
    if (
      select count(*) from public.pedido_escalas
      where pedido_id = new.pedido_id and data = new.data and status not in ('falta','desistiu')
    ) >= v_order.quantidade_diaristas then
      raise exception 'A quantidade de diaristas deste dia já foi preenchida.';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end;
$function$
;
revoke execute on function public.direct_validate_pedido_escala() from public,anon,authenticated;
