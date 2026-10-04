-- Semana de segunda a domingo; sexta/sábado da semana seguinte.
alter table public.tarifas_redes add column pagamento_semanal_dia smallint;
alter table public.tarifas_redes add constraint network_weekly_calendar_valid check (
 pagamento_semanal_dia is null or (pagamento_semanal_dia in (5,6)
 and pagamento_primeira_quinzena is null and pagamento_segunda_quinzena is null));

create function direct_private.payment_due(service_date date, first_day integer, second_day integer, weekly_day integer)
returns date language plpgsql immutable set search_path='' as $$
begin
 if service_date is null then return null;end if;
 if weekly_day is null then return direct_private.payment_due(service_date,first_day,second_day);end if;
 if weekly_day not in (5,6) then raise exception 'O prazo semanal deve ser sexta-feira ou sábado.';end if;
 return service_date - (extract(isodow from service_date)::integer-1) + 7 + (weekly_day-1);
end $$;
revoke all on function direct_private.payment_due(date,integer,integer,integer) from public,anon,authenticated;

create or replace function direct_private.snapshot_payment_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
declare due date;
begin
 if tg_op='INSERT' then
  if new.pedido_escala_id is not null then
   select direct_private.payment_due(new.data,r.pagamento_primeira_quinzena,r.pagamento_segunda_quinzena,r.pagamento_semanal_dia) into due
   from public.pedido_escalas e join public.pedidos p on p.id=e.pedido_id
   left join public.tarifas_redes r on lower(r.rede)=lower(p.supermercado) where e.id=new.pedido_escala_id;
   new.vencimento_pagamento:=due;new.vencimento_recebimento:=due;
   new.vencimento_origem:=case when due is null then 'nao_informado' else 'calendario' end;
  else new.vencimento_origem:='manual';new.vencimento_recebimento:=null;end if;
 elsif pg_trigger_depth()=1 then
  new.vencimento_recebimento:=old.vencimento_recebimento;
  new.vencimento_origem:=case when new.vencimento_pagamento is distinct from old.vencimento_pagamento then 'manual' else old.vencimento_origem end;
 end if;
 return new;
end $$;
revoke all on function direct_private.snapshot_payment_calendar() from public,anon,authenticated;

create or replace function direct_private.refresh_payment_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.pagamento_primeira_quinzena,new.pagamento_segunda_quinzena,new.pagamento_semanal_dia) is not distinct from
 (old.pagamento_primeira_quinzena,old.pagamento_segunda_quinzena,old.pagamento_semanal_dia) then return null;end if;
 update public.diarias d set
  vencimento_pagamento=direct_private.payment_due(d.data,new.pagamento_primeira_quinzena,new.pagamento_segunda_quinzena,new.pagamento_semanal_dia),
  vencimento_recebimento=direct_private.payment_due(d.data,new.pagamento_primeira_quinzena,new.pagamento_segunda_quinzena,new.pagamento_semanal_dia),
  vencimento_origem=case when new.pagamento_primeira_quinzena is null and new.pagamento_semanal_dia is null then 'nao_informado' else 'calendario' end
 from public.pedido_escalas e join public.pedidos p on p.id=e.pedido_id
 where d.pedido_escala_id=e.id and lower(p.supermercado)=lower(new.rede)
 and d.data_pagamento is null and d.pagamento_lote_id is null
 and d.vencimento_origem in ('calendario','nao_informado');
 return null;
end $$;
revoke all on function direct_private.refresh_payment_calendar() from public,anon,authenticated;
drop trigger refresh_payment_calendar on public.tarifas_redes;
create trigger refresh_payment_calendar after update of pagamento_primeira_quinzena,pagamento_segunda_quinzena,pagamento_semanal_dia on public.tarifas_redes
for each row execute function direct_private.refresh_payment_calendar();

-- Configuração autorizada: sábado é o limite, pagamento na sexta permanece válido.
update public.tarifas_redes set pagamento_primeira_quinzena=null,pagamento_segunda_quinzena=null,pagamento_semanal_dia=6
where lower(rede) in ('pinheiro','variedades');

do $$ begin
 if direct_private.payment_due('2026-09-28',null,null,6)<>'2026-10-10'::date
 or direct_private.payment_due('2026-10-04',null,null,6)<>'2026-10-10'::date
 or direct_private.payment_due('2026-10-05',null,null,6)<>'2026-10-17'::date
 or direct_private.payment_due('2026-12-31',null,null,6)<>'2027-01-09'::date
 or direct_private.payment_due('2026-09-29',null,null,5)<>'2026-10-09'::date
 or direct_private.payment_due('2026-09-29',30,15,null)<>'2026-10-15'::date
 then raise exception 'Falha na validação do calendário semanal.';end if;
end $$;
