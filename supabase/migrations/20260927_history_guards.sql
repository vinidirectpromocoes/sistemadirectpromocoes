create or replace function public.direct_guard_paid_daily_delete()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.data_pagamento is not null then
    raise exception 'Esta diária já foi paga. Corrija o pagamento em vez de excluí-la.';
  end if;
  return old;
end;
$$;
create trigger guard_paid_daily_delete before delete on public.diarias
for each row execute function public.direct_guard_paid_daily_delete();
create or replace function public.direct_guard_diarista_history_delete()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.diarias where diarista_id = old.id) then
    raise exception 'Este cadastro tem diárias registradas. Bloqueie a diarista para preservar o histórico.';
  end if;
  return old;
end;
$$;
create trigger guard_diarista_history_delete before delete on public.diaristas
for each row execute function public.direct_guard_diarista_history_delete();
