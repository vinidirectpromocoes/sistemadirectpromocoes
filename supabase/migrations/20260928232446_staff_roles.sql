-- Contas individuais da equipe; o administrador atual continua em direct_admins.
create table public.direct_staff (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('operacao', 'financeiro', 'consulta')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.direct_staff enable row level security;
revoke all on public.direct_staff from anon, authenticated;
grant select, insert, update, delete on public.direct_staff to authenticated;
create policy "staff reads own or admin" on public.direct_staff for select to authenticated
  using (email = (select auth.jwt()->>'email') or (select direct_private.is_admin()));
create policy "admin manages staff" on public.direct_staff for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

create function direct_private.member_role()
returns text language sql stable security definer set search_path = '' as $$
  select case when direct_private.is_admin() then 'admin'
    else (select s.role from public.direct_staff s
      where s.email = (select auth.jwt()->>'email') and s.active) end
$$;
revoke all on function direct_private.member_role() from public, anon, authenticated;
grant execute on function direct_private.member_role() to authenticated;

drop policy "admin manages diaristas" on public.diaristas;
create policy "staff reads workers" on public.diaristas for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "operations writes workers" on public.diaristas for insert to authenticated
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "operations updates workers" on public.diaristas for update to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "admin removes workers" on public.diaristas for delete to authenticated
  using ((select direct_private.member_role()) = 'admin');

drop policy "admin manages diarias" on public.diarias;
create policy "finance reads daily" on public.diarias for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "finance writes daily" on public.diarias for all to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'))
  with check ((select direct_private.member_role()) in ('admin','financeiro'));

drop policy "admin manages finance" on public.financeiro_lancamentos;
create policy "finance manages entries" on public.financeiro_lancamentos for all to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'))
  with check ((select direct_private.member_role()) in ('admin','financeiro'));

drop policy "admin manages pedidos" on public.pedidos;
create policy "staff reads orders" on public.pedidos for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "operations manages orders" on public.pedidos for all to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));

drop policy "admin manages pedido escalas" on public.pedido_escalas;
create policy "staff reads scales" on public.pedido_escalas for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "operations manages scales" on public.pedido_escalas for all to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));

drop policy "admin manages lojas" on public.lojas;
create policy "staff reads stores" on public.lojas for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "operations manages stores" on public.lojas for all to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));

drop policy "admin manages network rates" on public.tarifas_redes;
create policy "staff reads network rates" on public.tarifas_redes for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "finance updates network rates" on public.tarifas_redes for update to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'))
  with check ((select direct_private.member_role()) in ('admin','financeiro'));
drop policy "admin manages sector rates" on public.tarifas_setores;
create policy "staff reads sector rates" on public.tarifas_setores for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "finance manages sector rates" on public.tarifas_setores for all to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'))
  with check ((select direct_private.member_role()) in ('admin','financeiro'));

drop policy "admin manages pending readings" on public.leituras_pendentes;
create policy "operations manages readings" on public.leituras_pendentes for all to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));

drop policy "admin reads audit" on public.direct_auditoria;
create policy "management reads audit" on public.direct_auditoria for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));

-- O gatilho precisa criar/remover a diária ao alterar presença sem dar acesso financeiro à operação.
alter function public.direct_sync_pedido_presenca() security definer;
