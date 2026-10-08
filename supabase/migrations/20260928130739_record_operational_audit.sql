create schema if not exists direct_private;
revoke all on schema direct_private from public, anon, authenticated;

create table public.direct_auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id bigint not null,
  operacao text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  antes jsonb,
  depois jsonb,
  alterado_por uuid,
  email_autor text,
  alterado_em timestamptz not null default now()
);
create index direct_auditoria_recente on public.direct_auditoria (id desc);
alter table public.direct_auditoria enable row level security;
revoke all on public.direct_auditoria from anon, authenticated;
grant select on public.direct_auditoria to authenticated;
create policy "admin reads audit" on public.direct_auditoria for select to authenticated
  using ((select exists(select 1 from public.direct_admins where email = (select auth.jwt() ->> 'email'))));

create function direct_private.log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_before := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_id := new.id;
    v_after := to_jsonb(new);
  else
    v_id := new.id;
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    if v_before = v_after then return new; end if;
  end if;
  insert into public.direct_auditoria
    (tabela, registro_id, operacao, antes, depois, alterado_por, email_autor)
  values
    (tg_table_name, v_id, tg_op, v_before, v_after, auth.uid(), auth.jwt() ->> 'email');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function direct_private.log_change() from public, anon, authenticated;

create trigger audit_diarias after insert or update or delete on public.diarias
for each row execute function direct_private.log_change();
create trigger audit_financeiro after insert or update or delete on public.financeiro_lancamentos
for each row execute function direct_private.log_change();
create trigger audit_escalas after insert or update or delete on public.pedido_escalas
for each row execute function direct_private.log_change();
