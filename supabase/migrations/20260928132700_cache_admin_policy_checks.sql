create function public.direct_current_email()
returns text language sql stable security invoker set search_path = '' as $$
  select auth.jwt() ->> 'email'
$$;

create function public.direct_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.direct_admins
    where email = (select auth.jwt() ->> 'email')
  )
$$;

revoke all on function public.direct_current_email(), public.direct_is_admin()
  from public, anon, authenticated;
grant execute on function public.direct_current_email(), public.direct_is_admin()
  to authenticated;

drop policy "admin can read own membership" on public.direct_admins;
create policy "admin can read own membership" on public.direct_admins for select to authenticated
  using (email = (select public.direct_current_email()));

drop policy "admin manages diaristas" on public.diaristas;
create policy "admin manages diaristas" on public.diaristas for all to authenticated
  using ((select public.direct_is_admin())) with check ((select public.direct_is_admin()));

drop policy "admin manages diarias" on public.diarias;
create policy "admin manages diarias" on public.diarias for all to authenticated
  using ((select public.direct_is_admin())) with check ((select public.direct_is_admin()));

drop policy "admin manages finance" on public.financeiro_lancamentos;
create policy "admin manages finance" on public.financeiro_lancamentos for all to authenticated
  using ((select public.direct_is_admin())) with check ((select public.direct_is_admin()));

drop policy "admin manages pedidos" on public.pedidos;
create policy "admin manages pedidos" on public.pedidos for all to authenticated
  using ((select public.direct_is_admin())) with check ((select public.direct_is_admin()));

drop policy "admin manages lojas" on public.lojas;
create policy "admin manages lojas" on public.lojas for all to authenticated
  using ((select public.direct_is_admin())) with check ((select public.direct_is_admin()));

drop policy "admin manages pedido escalas" on public.pedido_escalas;
create policy "admin manages pedido escalas" on public.pedido_escalas for all to authenticated
  using ((select public.direct_is_admin())) with check ((select public.direct_is_admin()));

drop policy "admin reads audit" on public.direct_auditoria;
create policy "admin reads audit" on public.direct_auditoria for select to authenticated
  using ((select public.direct_is_admin()));
