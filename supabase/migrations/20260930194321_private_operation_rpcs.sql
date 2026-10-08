alter function public.direct_create_contract(jsonb) set schema direct_private;
alter function public.direct_review_invoice(bigint,jsonb) set schema direct_private;
create function public.direct_create_contract(p jsonb) returns public.contratos language sql security invoker set search_path='' as $$ select direct_private.direct_create_contract(p) $$;
create function public.direct_review_invoice(p_id bigint,p jsonb) returns void language sql security invoker set search_path='' as $$ select direct_private.direct_review_invoice(p_id,p) $$;
revoke execute on function public.direct_create_contract(jsonb),public.direct_review_invoice(bigint,jsonb),direct_private.direct_create_contract(jsonb),direct_private.direct_review_invoice(bigint,jsonb) from public,anon;
grant usage on schema direct_private to authenticated;
grant execute on function public.direct_create_contract(jsonb),public.direct_review_invoice(bigint,jsonb),direct_private.direct_create_contract(jsonb),direct_private.direct_review_invoice(bigint,jsonb) to authenticated;
