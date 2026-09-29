-- A API chama wrappers invoker; as transações privilegiadas ficam fora do esquema exposto.
alter function public.direct_create_invoice(text,date,date,date,text) set schema direct_private;
alter function public.direct_receive_invoice(bigint,bigint,date,text) set schema direct_private;
alter function public.direct_void_invoice_receipt(bigint,text) set schema direct_private;
alter function public.direct_cancel_invoice(bigint,text) set schema direct_private;
alter function public.direct_pay_daily_batch(bigint,bigint[],date,text) set schema direct_private;
alter function public.direct_reopen_payment_batch(bigint,text) set schema direct_private;

grant usage on schema direct_private to authenticated;
revoke execute on function direct_private.direct_create_invoice(text,date,date,date,text),
  direct_private.direct_receive_invoice(bigint,bigint,date,text), direct_private.direct_void_invoice_receipt(bigint,text),
  direct_private.direct_cancel_invoice(bigint,text), direct_private.direct_pay_daily_batch(bigint,bigint[],date,text),
  direct_private.direct_reopen_payment_batch(bigint,text) from public, anon;
grant execute on function direct_private.direct_create_invoice(text,date,date,date,text),
  direct_private.direct_receive_invoice(bigint,bigint,date,text), direct_private.direct_void_invoice_receipt(bigint,text),
  direct_private.direct_cancel_invoice(bigint,text), direct_private.direct_pay_daily_batch(bigint,bigint[],date,text),
  direct_private.direct_reopen_payment_batch(bigint,text) to authenticated;

create function public.direct_create_invoice(p_rede text, p_inicio date, p_fim date, p_vencimento date, p_numero_nota text default '')
returns bigint language sql security invoker set search_path = '' as $$
  select direct_private.direct_create_invoice(p_rede,p_inicio,p_fim,p_vencimento,p_numero_nota)
$$;
create function public.direct_receive_invoice(p_id bigint, p_valor_centavos bigint, p_data date, p_forma text default '')
returns bigint language sql security invoker set search_path = '' as $$
  select direct_private.direct_receive_invoice(p_id,p_valor_centavos,p_data,p_forma)
$$;
create function public.direct_void_invoice_receipt(p_id bigint, p_motivo text)
returns boolean language sql security invoker set search_path = '' as $$
  select direct_private.direct_void_invoice_receipt(p_id,p_motivo)
$$;
create function public.direct_cancel_invoice(p_id bigint, p_motivo text)
returns boolean language sql security invoker set search_path = '' as $$
  select direct_private.direct_cancel_invoice(p_id,p_motivo)
$$;
create function public.direct_pay_daily_batch(p_diarista_id bigint, p_diaria_ids bigint[], p_data date, p_forma text default '')
returns bigint language sql security invoker set search_path = '' as $$
  select direct_private.direct_pay_daily_batch(p_diarista_id,p_diaria_ids,p_data,p_forma)
$$;
create function public.direct_reopen_payment_batch(p_id bigint, p_motivo text)
returns boolean language sql security invoker set search_path = '' as $$
  select direct_private.direct_reopen_payment_batch(p_id,p_motivo)
$$;

revoke execute on function public.direct_create_invoice(text,date,date,date,text),
  public.direct_receive_invoice(bigint,bigint,date,text), public.direct_void_invoice_receipt(bigint,text),
  public.direct_cancel_invoice(bigint,text), public.direct_pay_daily_batch(bigint,bigint[],date,text),
  public.direct_reopen_payment_batch(bigint,text) from public, anon;
grant execute on function public.direct_create_invoice(text,date,date,date,text),
  public.direct_receive_invoice(bigint,bigint,date,text), public.direct_void_invoice_receipt(bigint,text),
  public.direct_cancel_invoice(bigint,text), public.direct_pay_daily_batch(bigint,bigint[],date,text),
  public.direct_reopen_payment_batch(bigint,text) to authenticated;
