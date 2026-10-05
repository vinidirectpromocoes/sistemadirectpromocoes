alter table public.substituicao_contatos add column datas jsonb not null default '[]'::jsonb check(jsonb_typeof(datas)='array');
create trigger audit_pending after insert or update or delete on public.pendencia_acoes for each row execute function direct_private.log_change();
create trigger audit_replacement_contacts after insert or update or delete on public.substituicao_contatos for each row execute function direct_private.log_change();
create or replace function public.direct_replacement_response(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.substituicao_contatos;old public.substituicao_contatos;s public.pedido_escalas;dates jsonb;begin
if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão.' using errcode='42501';end if;
if coalesce(p->>'resposta','') not in ('aguardando','confirmou','recusou') then raise exception 'Resposta inválida.';end if;
select e.* into s from public.pedido_escalas e join public.pedidos o on o.id=e.pedido_id where e.id=(p->>'escala_id')::bigint and e.status<>'presente' and e.substituida_por_escala_id is null and o.situacao not in ('cancelado','concluido');
if s.id is null then raise exception 'Substituição indisponível.';end if;
if not exists(select 1 from public.diaristas where id=(p->>'diarista_id')::bigint and not bloqueada) then raise exception 'Cadastro indisponível.';end if;
dates:=coalesce(p->'datas',jsonb_build_array(s.data));
if jsonb_typeof(dates)<>'array' or jsonb_array_length(dates) not between 1 and 90 or not dates @> jsonb_build_array(s.data) then raise exception 'Confira as datas da resposta.';end if;
if exists(select 1 from jsonb_array_elements_text(dates) d where not exists(select 1 from public.pedido_escalas e where e.pedido_id=s.pedido_id and e.diarista_id=s.diarista_id and e.data::text=d and e.data>=s.data and e.status<>'presente' and e.substituida_por_escala_id is null)) or (select count(distinct d) from jsonb_array_elements_text(dates)d)<>jsonb_array_length(dates) then raise exception 'Datas indisponíveis para esta substituição.';end if;
perform pg_advisory_xact_lock(hashtextextended('direct-replacement:'||s.id||':'||(p->>'diarista_id'),0));
select * into old from public.substituicao_contatos where escala_id=s.id and diarista_id=(p->>'diarista_id')::bigint for update;
if old.id is not null and ((p->>'expected_updated_at') is null or old.atualizado_em<>(p->>'expected_updated_at')::timestamptz) then raise exception 'Outra pessoa alterou a resposta. Atualize antes de salvar.' using errcode='40001';end if;
insert into public.substituicao_contatos(escala_id,diarista_id,resposta,datas) values(s.id,(p->>'diarista_id')::bigint,p->>'resposta',dates) on conflict(escala_id,diarista_id) do update set resposta=excluded.resposta,datas=excluded.datas,atualizado_em=clock_timestamp() returning * into result;return to_jsonb(result);end;$$;
revoke all on function public.direct_replacement_response(jsonb) from public,anon,authenticated;grant execute on function public.direct_replacement_response(jsonb) to authenticated;
