drop policy "finance reads daily" on public.diarias;
create policy "operations reads daily history" on public.diarias for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro','operacao'));
