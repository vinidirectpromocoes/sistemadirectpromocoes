-- Calendário comum ao recebimento da rede e ao pagamento das diárias.
alter table public.tarifas_redes
  add column pagamento_primeira_quinzena smallint,
  add column pagamento_segunda_quinzena smallint,
  add constraint network_payment_calendar_valid check (
    (pagamento_primeira_quinzena is null and pagamento_segunda_quinzena is null)
    or (pagamento_primeira_quinzena is not null and pagamento_segunda_quinzena is not null
        and pagamento_primeira_quinzena between 1 and 31 and pagamento_segunda_quinzena between 1 and 31));
alter table public.diarias
  add column vencimento_recebimento date,
  add column vencimento_origem text not null default 'manual',
  add constraint daily_due_origin_valid check (vencimento_origem in ('manual','calendario','nao_informado'));
alter table public.diarias drop constraint direct_diarias_pending_has_due;
alter table public.diarias add constraint direct_diarias_pending_has_due check (
  valor_centavos is null or data_pagamento is not null or vencimento_pagamento is not null
  or (pedido_escala_id is not null and vencimento_origem='nao_informado')) not valid;

create function direct_private.payment_due(service_date date, first_day integer, second_day integer)
returns date language plpgsql immutable set search_path='' as $$
declare base date; due_day integer; last_day integer;
begin
  if service_date is null or first_day is null or second_day is null then return null; end if;
  if first_day not between 1 and 31 or second_day not between 1 and 31 then raise exception 'Dia de pagamento inválido.'; end if;
  base := date_trunc('month', service_date)::date;
  due_day := first_day;
  if extract(day from service_date)>15 then base := (base+interval '1 month')::date; due_day := second_day; end if;
  last_day := extract(day from (base+interval '1 month - 1 day'));
  return base + (least(due_day,last_day)-1);
end $$;
revoke all on function direct_private.payment_due(date,integer,integer) from public,anon,authenticated;

update public.tarifas_redes set
  pagamento_primeira_quinzena=case when lower(rede) in ('fazendinha','hipermarket') then 20 else 30 end,
  pagamento_segunda_quinzena=case when lower(rede) in ('fazendinha','hipermarket') then 5 else 15 end
where lower(rede) in ('fazendinha','hipermarket','super lagoa','super do povo');

-- Retain paid history, batches and deadlines explicitly changed in the audit trail.
update public.diarias d set
  vencimento_pagamento=direct_private.payment_due(d.data,r.pagamento_primeira_quinzena,r.pagamento_segunda_quinzena),
  vencimento_recebimento=direct_private.payment_due(d.data,r.pagamento_primeira_quinzena,r.pagamento_segunda_quinzena),
  vencimento_origem=case when r.pagamento_primeira_quinzena is null then 'nao_informado' else 'calendario' end
from public.pedido_escalas e join public.pedidos p on p.id=e.pedido_id
join public.tarifas_redes r on lower(r.rede)=lower(p.supermercado)
where d.pedido_escala_id=e.id and d.data_pagamento is null and d.pagamento_lote_id is null
  and d.vencimento_pagamento=d.data and not exists (
    select 1 from public.direct_auditoria a where a.tabela='diarias' and a.registro_id=d.id
      and a.operacao='UPDATE' and (a.antes->>'vencimento_pagamento') is distinct from (a.depois->>'vencimento_pagamento'));

-- Must run after snapshot_contract, which snapshots rates but used the service date.
create function direct_private.snapshot_payment_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
declare due date;
begin
  if tg_op='INSERT' then
    if new.pedido_escala_id is not null then
      select direct_private.payment_due(new.data,r.pagamento_primeira_quinzena,r.pagamento_segunda_quinzena) into due
      from public.pedido_escalas e join public.pedidos p on p.id=e.pedido_id
      left join public.tarifas_redes r on lower(r.rede)=lower(p.supermercado) where e.id=new.pedido_escala_id;
      new.vencimento_pagamento:=due; new.vencimento_recebimento:=due;
      new.vencimento_origem:=case when due is null then 'nao_informado' else 'calendario' end;
    else
      new.vencimento_origem:='manual'; new.vencimento_recebimento:=null;
    end if;
  elsif pg_trigger_depth()=1 then
    -- Provenance and incoming deadline cannot be forged by a direct client update.
    new.vencimento_recebimento:=old.vencimento_recebimento;
    new.vencimento_origem:=case when new.vencimento_pagamento is distinct from old.vencimento_pagamento then 'manual' else old.vencimento_origem end;
  end if;
  return new;
end $$;
revoke all on function direct_private.snapshot_payment_calendar() from public,anon,authenticated;
create trigger zz_snapshot_payment_calendar before insert or update on public.diarias
for each row execute function direct_private.snapshot_payment_calendar();

create function direct_private.refresh_payment_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.pagamento_primeira_quinzena,new.pagamento_segunda_quinzena) is not distinct from
     (old.pagamento_primeira_quinzena,old.pagamento_segunda_quinzena) then return null; end if;
  update public.diarias d set
    vencimento_pagamento=direct_private.payment_due(d.data,new.pagamento_primeira_quinzena,new.pagamento_segunda_quinzena),
    vencimento_recebimento=direct_private.payment_due(d.data,new.pagamento_primeira_quinzena,new.pagamento_segunda_quinzena),
    vencimento_origem=case when new.pagamento_primeira_quinzena is null then 'nao_informado' else 'calendario' end
  from public.pedido_escalas e join public.pedidos p on p.id=e.pedido_id
  where d.pedido_escala_id=e.id and lower(p.supermercado)=lower(new.rede)
    and d.data_pagamento is null and d.pagamento_lote_id is null
    and d.vencimento_origem in ('calendario','nao_informado');
  return null;
end $$;
revoke all on function direct_private.refresh_payment_calendar() from public,anon,authenticated;
create trigger refresh_payment_calendar after update of pagamento_primeira_quinzena,pagamento_segunda_quinzena on public.tarifas_redes
for each row execute function direct_private.refresh_payment_calendar();

-- Fail the entire migration if month boundaries are calculated incorrectly.
do $$ begin
  if direct_private.payment_due('2026-09-15',20,5) <> '2026-09-20'::date
     or direct_private.payment_due('2026-09-16',20,5) <> '2026-10-05'::date
     or direct_private.payment_due('2026-09-29',30,15) <> '2026-10-15'::date
     or direct_private.payment_due('2026-02-15',30,15) <> '2026-02-28'::date
     or direct_private.payment_due('2028-02-15',30,15) <> '2028-02-29'::date
     or direct_private.payment_due('2026-12-31',20,5) <> '2027-01-05'::date
     or direct_private.payment_due('2026-01-31',20,31) <> '2026-02-28'::date
     or direct_private.payment_due('2026-09-29',null,null) is not null
  then raise exception 'Falha na validação do calendário.'; end if;
end $$;
