drop policy "staff reads workers" on public.diaristas;
create policy "authorized team reads workers" on public.diaristas for select to authenticated
  using ((select direct_private.member_role()) in ('admin','operacao','financeiro'));
