-- A desistência abre as vagas planejadas do mesmo diarista, a partir do dia escolhido.
-- Presenças, faltas, dias anteriores e substituições já concluídas mantêm seu histórico.
create function public.direct_withdraw_order_remaining(
 p_pedido_id bigint,p_escala_id bigint,p_motivo text,p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.pedidos%rowtype;s public.pedido_escalas%rowtype;reason text;changed integer;
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then
  raise exception 'Sem permissão para registrar desistência.' using errcode='42501';
 end if;
 select * into o from public.pedidos where id=p_pedido_id for update;
 select * into s from public.pedido_escalas where id=p_escala_id and pedido_id=p_pedido_id for update;
 if o.id is null or s.id is null then raise exception 'Escala não encontrada.';end if;
 if p_expected_updated_at is not null and s.atualizado_em is distinct from p_expected_updated_at then
  raise exception 'A escala mudou depois da leitura. Confira novamente.' using errcode='40001';
 end if;
 if o.situacao in ('cancelado','concluido') then raise exception 'Desistência disponível apenas em pedido aberto.';end if;
 if s.status not in ('escalada','desistiu') then raise exception 'Desistência disponível apenas antes da presença ou falta.';end if;
 if s.substituida_por_escala_id is not null then raise exception 'Esta escala já tem substituição registrada.';end if;
 reason:=case when s.status='desistiu' then s.desistencia_motivo else btrim(coalesce(p_motivo,'')) end;
 if length(coalesce(reason,'')) not between 5 and 300 then raise exception 'Informe o motivo da desistência com 5 a 300 caracteres.';end if;
 update public.pedido_escalas set status='desistiu',desistencia_motivo=reason
 where pedido_id=p_pedido_id and diarista_id=s.diarista_id and data>=s.data
  and status='escalada' and substituida_por_escala_id is null;
 get diagnostics changed=row_count;
 select * into s from public.pedido_escalas where id=p_escala_id;
 return to_jsonb(s)||jsonb_build_object('desistencias_registradas',changed);
end $$;
revoke all on function public.direct_withdraw_order_remaining(bigint,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.direct_withdraw_order_remaining(bigint,bigint,text,timestamptz) to authenticated;

-- Inclui também dias ainda sem escala; dias já atendidos ou preenchidos são preservados.
-- Tudo ocorre na mesma transação: um erro em qualquer dia desfaz o lote inteiro.
create or replace function public.direct_replace_order_remaining(
 p_pedido_id bigint,p_escala_id bigint,p_diarista_id bigint,p_motivo text,p_disponibilidade_confirmada boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.pedidos%rowtype;old public.pedido_escalas%rowtype;s public.pedido_escalas%rowtype;
 replacement public.pedido_escalas%rowtype;t jsonb;day date;result jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para substituir.' using errcode='42501';end if;
 select * into o from public.pedidos where id=p_pedido_id for update;
 select * into old from public.pedido_escalas where id=p_escala_id and pedido_id=p_pedido_id for update;
 if o.id is null or old.id is null then raise exception 'Escala não encontrada.';end if;
 if o.situacao in ('cancelado','concluido') or old.status='presente' then raise exception 'Substituição disponível apenas antes da presença e em pedido aberto.';end if;
 if p_diarista_id=old.diarista_id then raise exception 'Escolha outra pessoa para substituir.';end if;
 for t in select value from jsonb_array_elements(o.turnos) where (value->>'data')::date>=old.data order by value->>'data' loop
  day:=(t->>'data')::date;
  select * into s from public.pedido_escalas where pedido_id=p_pedido_id and diarista_id=old.diarista_id and data=day for update;
  if s.id is not null then
   if s.status='presente' then continue;end if;
   if s.substituida_por_escala_id is not null then
    select * into replacement from public.pedido_escalas where id=s.substituida_por_escala_id;
    if s.id=p_escala_id and replacement.diarista_id<>p_diarista_id then raise exception 'Esta escala já tem substituição registrada.';end if;
    if replacement.diarista_id=p_diarista_id then result:=result||jsonb_build_array(to_jsonb(replacement));end if;
    continue;
   end if;
   result:=result||jsonb_build_array(public.direct_replace_order_worker(p_pedido_id,s.id,p_diarista_id,p_motivo,p_disponibilidade_confirmada));
  else
   if (select count(*) from public.pedido_escalas where pedido_id=p_pedido_id and data=day and status not in ('falta','desistiu'))>=o.quantidade_diaristas then continue;end if;
   insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada)
   values(p_pedido_id,p_diarista_id,day,coalesce(p_disponibilidade_confirmada,false)) returning * into replacement;
   result:=result||jsonb_build_array(to_jsonb(replacement));
  end if;
 end loop;
 if jsonb_array_length(result)=0 then raise exception 'Nenhum dia para substituir.';end if;
 return result;
end $$;
revoke all on function public.direct_replace_order_remaining(bigint,bigint,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.direct_replace_order_remaining(bigint,bigint,bigint,text,boolean) to authenticated;

-- Desistências pendentes registradas antes desta melhoria também liberam os demais dias ao substituir.
create or replace function public.direct_replace_order_worker(p_pedido_id bigint,p_escala_id bigint,p_diarista_id bigint,p_motivo text,p_disponibilidade_confirmada boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.pedidos%rowtype; old_scale public.pedido_escalas%rowtype; replacement public.pedido_escalas%rowtype;
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para substituir.'; end if;
 select * into o from public.pedidos where id=p_pedido_id for update;
 select * into old_scale from public.pedido_escalas where id=p_escala_id and pedido_id=p_pedido_id for update;
 if o.id is null or old_scale.id is null then raise exception 'Escala não encontrada.'; end if;
 if o.situacao in ('concluido','cancelado') or old_scale.status='presente' then raise exception 'Substituição disponível apenas antes da presença e em pedido aberto.'; end if;
 if p_diarista_id=old_scale.diarista_id then raise exception 'Escolha outra pessoa para substituir.'; end if;
 if old_scale.substituida_por_escala_id is not null then
  select * into replacement from public.pedido_escalas where id=old_scale.substituida_por_escala_id;
  if replacement.diarista_id=p_diarista_id then return to_jsonb(replacement); end if;
  raise exception 'Esta escala já tem substituição registrada.';
 end if;
 if old_scale.status='desistiu' then
  perform public.direct_withdraw_order_remaining(p_pedido_id,p_escala_id,'',null);
 end if;
 if old_scale.status='escalada' then
  update public.pedido_escalas set status='desistiu',desistencia_motivo=p_motivo where id=old_scale.id;
 end if;
 insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada)
 values(p_pedido_id,p_diarista_id,old_scale.data,coalesce(p_disponibilidade_confirmada,false)) returning * into replacement;
 -- The insert trigger may have selected another vacant slot; pin this substitution to its chosen origin.
 update public.pedido_escalas set substituida_por_escala_id=null where substituida_por_escala_id=replacement.id and id<>old_scale.id;
 update public.pedido_escalas set substituida_por_escala_id=replacement.id where id=old_scale.id;
 return to_jsonb(replacement);
end $$;
revoke execute on function public.direct_replace_order_worker(bigint,bigint,bigint,text,boolean) from public,anon;
grant execute on function public.direct_replace_order_worker(bigint,bigint,bigint,text,boolean) to authenticated;
