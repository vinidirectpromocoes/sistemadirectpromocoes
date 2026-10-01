-- Repair only the administrator-confirmed period; preserve assignment IDs and audit history.
do $$
declare
  candidates bigint[]; order_id bigint; old_shifts jsonb; new_shifts jsonb; updated_count integer;
begin
  lock table public.pedidos, public.pedido_escalas in share row exclusive mode;
  select jsonb_agg(jsonb_build_object('data',day::date::text,'inicio','13:40','fim','22:00') order by day)
    into old_shifts from generate_series('2027-09-29'::date,'2027-10-05'::date,'1 day'::interval) day;
  select jsonb_agg(jsonb_build_object('data',day::date::text,'inicio','13:40','fim','22:00') order by day)
    into new_shifts from generate_series('2026-09-29'::date,'2026-10-05'::date,'1 day'::interval) day;
  select array_agg(p.id) into candidates from public.pedidos p
    where lower(p.supermercado)=lower('Super do Povo') and p.unidade='Meireles' and p.setor='Rep. Mercearia'
      and (p.criado_em at time zone 'America/Fortaleza')::date='2026-10-01'::date
      and p.quantidade_diaristas=1 and p.turnos=old_shifts and p.situacao not in ('cancelado','concluido')
      and exists(select 1 from public.pedido_escalas e join public.diaristas d on d.id=e.diarista_id
        where e.pedido_id=p.id and d.nome='Francisco Antônio Fagner');
  if coalesce(cardinality(candidates),0)=0 then return; end if;
  if cardinality(candidates)<>1 then raise exception 'Mais de um pedido corresponde à correção; nenhuma alteração aplicada.'; end if;
  order_id:=candidates[1];
  if (select count(*) from public.pedido_escalas where pedido_id=order_id)<>7
    or exists(select 1 from public.pedido_escalas e join public.diaristas d on d.id=e.diarista_id
      where e.pedido_id=order_id and (e.status<>'escalada' or d.nome<>'Francisco Antônio Fagner' or e.substituida_por_escala_id is not null))
    or exists(select 1 from public.diarias d join public.pedido_escalas e on e.id=d.pedido_escala_id where e.pedido_id=order_id)
    then raise exception 'O histórico mudou; a correção precisa ser revisada.';
  end if;
  if exists(select 1 from public.pedido_escalas source join public.pedido_escalas other
    on other.diarista_id=source.diarista_id and other.pedido_id<>order_id
    and other.data=(source.data-interval '1 year')::date and other.status not in ('falta','desistiu')
    join public.pedidos p on p.id=other.pedido_id cross join lateral jsonb_array_elements(p.turnos) t
    where source.pedido_id=order_id and t->>'data'=other.data::text
      and (t->>'inicio')::time<'22:00'::time and '13:40'::time<(t->>'fim')::time)
    then raise exception 'Há conflito de horário no período corrigido; nenhuma alteração aplicada.';
  end if;
  -- Locks and transactional DDL keep these two guards unavailable only inside this repair.
  -- All audit and financial triggers remain enabled. Any exception rolls back the whole block.
  alter table public.pedidos disable trigger guard_pedido_change;
  alter table public.pedido_escalas disable trigger validate_pedido_escala;
  update public.pedidos set turnos=new_shifts,atualizado_em=now(),
    observacoes=concat_ws(E'\n',nullif(observacoes,''),'Período corrigido para 29/09 a 05/10/2026, conforme confirmação do administrador em 01/10/2026.')
    where id=order_id;
  update public.pedido_escalas set data=(data-interval '1 year')::date,atualizado_em=now() where pedido_id=order_id;
  get diagnostics updated_count=row_count;
  if updated_count<>7 then raise exception 'Correção incompleta; nenhuma alteração aplicada.'; end if;
  alter table public.pedidos enable trigger guard_pedido_change;
  alter table public.pedido_escalas enable trigger validate_pedido_escala;
end $$;
