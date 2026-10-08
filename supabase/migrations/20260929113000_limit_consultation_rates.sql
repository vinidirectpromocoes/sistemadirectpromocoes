-- O perfil de consulta acessa pedidos e lojas, sem valores comerciais.
drop policy if exists "staff reads network rates" on public.tarifas_redes;
create policy "authorized team reads network rates" on public.tarifas_redes for select to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao','financeiro'));
drop policy if exists "sector rates select" on public.tarifas_setores;
create policy "authorized team reads sector rates" on public.tarifas_setores for select to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao','financeiro'));
