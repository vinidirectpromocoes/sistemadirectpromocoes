create function direct_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.direct_admins
    where email = (select auth.jwt() ->> 'email')
  )
$$;

revoke all on function direct_private.is_admin() from public, anon, authenticated;
grant usage on schema direct_private to authenticated;
grant execute on function direct_private.is_admin() to authenticated;

drop policy "admin manages diaristas" on public.diaristas;
create policy "admin manages diaristas" on public.diaristas for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

drop policy "admin manages diarias" on public.diarias;
create policy "admin manages diarias" on public.diarias for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

drop policy "admin manages finance" on public.financeiro_lancamentos;
create policy "admin manages finance" on public.financeiro_lancamentos for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

drop policy "admin manages pedidos" on public.pedidos;
create policy "admin manages pedidos" on public.pedidos for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

drop policy "admin manages lojas" on public.lojas;
create policy "admin manages lojas" on public.lojas for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

drop policy "admin manages pedido escalas" on public.pedido_escalas;
create policy "admin manages pedido escalas" on public.pedido_escalas for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

drop policy "admin reads audit" on public.direct_auditoria;
create policy "admin reads audit" on public.direct_auditoria for select to authenticated
  using ((select direct_private.is_admin()));

drop function public.direct_is_admin();
