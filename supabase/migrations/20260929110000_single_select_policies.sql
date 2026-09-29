-- Uma política SELECT por tabela evita avaliações permissivas redundantes.
-- As permissões de cada perfil permanecem iguais às anteriores.
drop policy if exists "admin manages staff" on public.direct_staff;
drop policy if exists "staff reads own or admin" on public.direct_staff;
create policy "staff select" on public.direct_staff for select to authenticated
  using (email = ((select auth.jwt())->>'email') or (select direct_private.is_admin()));
create policy "admin insert staff" on public.direct_staff for insert to authenticated
  with check ((select direct_private.is_admin()));
create policy "admin update staff" on public.direct_staff for update to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));
create policy "admin delete staff" on public.direct_staff for delete to authenticated
  using ((select direct_private.is_admin()));

drop policy if exists "finance writes daily" on public.diarias;
drop policy if exists "finance reads daily" on public.diarias;
drop policy if exists "operations reads daily history" on public.diarias;
create policy "daily select" on public.diarias for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro','operacao'));
create policy "daily insert" on public.diarias for insert to authenticated
  with check ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "daily update" on public.diarias for update to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'))
  with check ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "daily delete" on public.diarias for delete to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));

drop policy if exists "operations manages stores" on public.lojas;
drop policy if exists "staff reads stores" on public.lojas;
create policy "stores select" on public.lojas for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "stores insert" on public.lojas for insert to authenticated
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "stores update" on public.lojas for update to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "stores delete" on public.lojas for delete to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'));

drop policy if exists "operations manages scales" on public.pedido_escalas;
drop policy if exists "staff reads scales" on public.pedido_escalas;
create policy "scales select" on public.pedido_escalas for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "scales insert" on public.pedido_escalas for insert to authenticated
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "scales update" on public.pedido_escalas for update to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "scales delete" on public.pedido_escalas for delete to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'));

drop policy if exists "operations manages orders" on public.pedidos;
drop policy if exists "staff reads orders" on public.pedidos;
create policy "orders select" on public.pedidos for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "orders insert" on public.pedidos for insert to authenticated
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "orders update" on public.pedidos for update to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'))
  with check ((select direct_private.member_role()) in ('admin','operacao'));
create policy "orders delete" on public.pedidos for delete to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao'));

drop policy if exists "finance manages sector rates" on public.tarifas_setores;
drop policy if exists "staff reads sector rates" on public.tarifas_setores;
create policy "sector rates select" on public.tarifas_setores for select to authenticated
  using ((select direct_private.member_role()) is not null);
create policy "sector rates insert" on public.tarifas_setores for insert to authenticated
  with check ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "sector rates update" on public.tarifas_setores for update to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'))
  with check ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "sector rates delete" on public.tarifas_setores for delete to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));
