-- Only derived staffing status may change. Business records and financial history are preserved.
create temporary table order_lifecycle_preservation(tabela text primary key,digest text) on commit drop;
do $$declare t text;v text;begin foreach t in array array['diaristas','diarias','pedido_escalas','lojas','financeiro_lancamentos','cobrancas','cobranca_itens','cobranca_recebimentos','pagamento_lotes'] loop execute format('select md5(coalesce(jsonb_agg(to_jsonb(r) order by id),''[]'')::text) from public.%I r',t) into v;insert into order_lifecycle_preservation values(t,v);end loop;end$$;
insert into order_lifecycle_preservation select 'pedidos',md5(coalesce(jsonb_agg(to_jsonb(r)-'situacao'-'atualizado_em' order by id),'[]')::text) from public.pedidos r;

create function direct_private.order_lifecycle(p_id bigint) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare o public.pedidos;day date:=(now() at time zone 'America/Fortaleza')::date;vacancies bigint;pending bigint;ended boolean;missing bigint;target_status text;
begin
 select * into o from public.pedidos where id=p_id;if o.id is null then return null;end if;
 select coalesce(sum(greatest(0,o.quantidade_diaristas-(select count(*) from public.pedido_escalas s where s.pedido_id=o.id and s.data=(t->>'data')::date and s.status not in ('falta','desistiu')))),0) into vacancies from jsonb_array_elements(o.turnos)t where (t->>'data')::date>=day;
 select count(*) into pending from public.pedido_escalas where pedido_id=o.id and data<day and status='escalada';
 select count(*)>0 and max((t->>'data')::date)<day into ended from jsonb_array_elements(o.turnos)t;
 select coalesce(sum(greatest(0,o.quantidade_diaristas-(select count(*) from public.pedido_escalas s where s.pedido_id=o.id and s.data=(t->>'data')::date and s.status='presente'))),0) into missing from jsonb_array_elements(o.turnos)t where (t->>'data')::date<day;
 target_status:=case when o.situacao in ('concluido','cancelado') then o.situacao when vacancies=0 then 'confirmado' when exists(select 1 from public.pedido_escalas where pedido_id=o.id) then 'em_selecao' else 'novo' end;
 return jsonb_build_object('situacao',target_status,'periodo_finalizado',ended,'encerravel',ended and pending=0 and o.situacao not in ('concluido','cancelado'),'presencas_pendentes',pending,'vagas_atuais',vacancies,'dias_nao_atendidos',missing,'presencas',(select count(*) from public.pedido_escalas where pedido_id=o.id and status='presente'),'faltas',(select count(*) from public.pedido_escalas where pedido_id=o.id and status='falta'),'dias_desistencia',(select count(*) from public.pedido_escalas where pedido_id=o.id and status='desistiu'));
end;$$;
revoke all on function direct_private.order_lifecycle(bigint) from public,anon;grant execute on function direct_private.order_lifecycle(bigint) to authenticated;

create or replace function public.direct_sync_order_staffing() returns trigger language plpgsql security invoker set search_path='' as $$
declare oid bigint;o public.pedidos;target text;
begin oid:=case when tg_op='DELETE' then old.pedido_id else new.pedido_id end;select * into o from public.pedidos where id=oid for update;
 if o.id is null or o.situacao in ('cancelado','concluido') then return null;end if;
 target:=direct_private.order_lifecycle(oid)->>'situacao';if target<>o.situacao then update public.pedidos set situacao=target,atualizado_em=now() where id=oid;end if;return null;
end;$$;
revoke all on function public.direct_sync_order_staffing() from public,anon,authenticated;

create function direct_private.guard_order_closure() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.situacao not in ('cancelado','concluido') and new.situacao not in ('cancelado','concluido') then new.situacao:=direct_private.order_lifecycle(old.id)->>'situacao';end if;
 if new.situacao='concluido' and (tg_op='INSERT' or old.situacao<>'concluido') then
  if tg_op='UPDATE' then perform id from public.pedido_escalas where pedido_id=new.id order by id for update;end if;
  if exists(select 1 from jsonb_array_elements(new.turnos)t where (t->>'data')::date>=(now() at time zone 'America/Fortaleza')::date) then raise exception 'Encerre somente após o último dia do pedido.';end if;
  if exists(select 1 from public.pedido_escalas where pedido_id=new.id and status='escalada') then raise exception 'Confira as presenças pendentes antes de encerrar.';end if;
 end if;return new;
end;$$;
revoke all on function direct_private.guard_order_closure() from public,anon,authenticated;
create trigger guard_order_closure before insert or update of situacao on public.pedidos for each row execute function direct_private.guard_order_closure();

create function direct_private.guard_order_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.data<(now() at time zone 'America/Fortaleza')::date and exists(select 1 from public.pedido_escalas s where s.pedido_id=new.pedido_id and s.data=new.data and s.status in ('falta','desistiu')) then raise exception 'Dias anteriores ficam no histórico; não é possível repor no passado.';end if;
 elsif old.status is distinct from new.status and exists(select 1 from public.pedidos where id=old.pedido_id and situacao in ('concluido','cancelado')) then raise exception 'Pedido encerrado; preserve o histórico de presença e ocorrências.';end if;return new;
end;$$;
revoke all on function direct_private.guard_order_history() from public,anon,authenticated;
create trigger guard_order_history before insert or update of status on public.pedido_escalas for each row execute function direct_private.guard_order_history();

create function public.direct_close_order(p_id bigint,p_expected_updated_at timestamptz,p_expected_scales jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.pedidos;actual jsonb;info jsonb;
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para encerrar pedido.' using errcode='42501';end if;
 select * into o from public.pedidos where id=p_id for update;if o.id is null then raise exception 'Pedido não encontrado.';end if;
 if o.situacao='concluido' then return to_jsonb(o);end if;
 perform id from public.pedido_escalas where pedido_id=p_id order by id for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'atualizado_em',atualizado_em) order by id),'[]') into actual from public.pedido_escalas where pedido_id=p_id;
 if p_expected_updated_at is distinct from o.atualizado_em or p_expected_scales is distinct from actual then raise exception 'O pedido ou as presenças mudaram. Atualize e confira novamente.' using errcode='40001';end if;
 info:=direct_private.order_lifecycle(p_id);
 if not (info->>'periodo_finalizado')::boolean then raise exception 'Encerre somente após o último dia do pedido.';end if;
 if o.situacao='cancelado' then raise exception 'Pedido cancelado; preserve o histórico.';end if;
 if (info->>'presencas_pendentes')::int>0 then raise exception 'Confira as presenças pendentes antes de encerrar.';end if;
 update public.pedidos set situacao='concluido',atualizado_em=now() where id=p_id returning * into o;return to_jsonb(o);
end;$$;
revoke all on function public.direct_close_order(bigint,timestamptz,jsonb) from public,anon;grant execute on function public.direct_close_order(bigint,timestamptz,jsonb) to authenticated;

update public.pedidos p set situacao=direct_private.order_lifecycle(p.id)->>'situacao',atualizado_em=now() where situacao not in ('cancelado','concluido') and situacao is distinct from direct_private.order_lifecycle(p.id)->>'situacao';
do $$declare r record;v text;begin for r in select * from order_lifecycle_preservation loop if r.tabela='pedidos' then select md5(coalesce(jsonb_agg(to_jsonb(p)-'situacao'-'atualizado_em' order by id),'[]')::text) into v from public.pedidos p;else execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),''[]'')::text) from public.%I t',r.tabela) into v;end if;if v is distinct from r.digest then raise exception 'Preservation failed: %',r.tabela;end if;end loop;end$$;
