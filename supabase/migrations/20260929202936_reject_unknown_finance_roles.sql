-- NULL NOT IN (...) avalia para NULL. Rejeita explicitamente usuários sem perfil.
do $migration$
declare
  fn record;
  definition text;
begin
  for fn in
    select p.oid from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'direct_private' and p.proname in (
        'direct_create_invoice', 'direct_receive_invoice', 'direct_void_invoice_receipt',
        'direct_cancel_invoice', 'direct_pay_daily_batch', 'direct_reopen_payment_batch'
      )
  loop
    definition := pg_get_functiondef(fn.oid);
    if position('if direct_private.member_role() not in' in definition) > 0 then
      execute replace(definition,
        'if direct_private.member_role() not in',
        'if coalesce(direct_private.member_role(), '''') not in');
    end if;
  end loop;
end;
$migration$;
