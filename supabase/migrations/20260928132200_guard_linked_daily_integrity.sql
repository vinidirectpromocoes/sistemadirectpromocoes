create or replace function public.direct_guard_manual_daily_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.pedido_escala_id is not null then
    if not exists (
      select 1 from public.pedido_escalas e
      where e.id = new.pedido_escala_id
        and e.diarista_id = new.diarista_id
        and e.data = new.data
        and e.status = 'presente'
    ) then
      raise exception 'A diária vinculada deve corresponder à diarista, data e presença da escala.';
    end if;
  elsif tg_op = 'INSERT' then
    if exists (select 1 from public.diaristas where id = new.diarista_id and bloqueada) then
      raise exception 'Desbloqueie a diarista antes de registrar uma nova diária.';
    end if;
  elsif new.diarista_id is distinct from old.diarista_id then
    if exists (select 1 from public.diaristas where id = new.diarista_id and bloqueada) then
      raise exception 'Desbloqueie a diarista antes de atribuir uma diária a ela.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger guard_manual_daily_insert on public.diarias;
create trigger guard_manual_daily_insert before insert or update on public.diarias
for each row execute function public.direct_guard_manual_daily_insert();
