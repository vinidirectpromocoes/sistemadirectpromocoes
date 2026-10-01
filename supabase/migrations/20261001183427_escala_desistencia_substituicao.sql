alter table public.pedido_escalas drop constraint pedido_escalas_status_check;
alter table public.pedido_escalas add constraint pedido_escalas_status_check check(status in ('escalada','presente','falta','desistiu'));
alter table public.pedido_escalas add column desistencia_motivo text, add column desistencia_em timestamptz, add column desistencia_por text;
create or replace function public.direct_validate_pedido_escala()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.pedidos%rowtype;
  v_worker public.diaristas%rowtype;
  v_shift jsonb;
  v_day text;
  v_activating boolean;
begin
  if tg_op = 'UPDATE' then
    if new.disponibilidade_pedido_confirmada is distinct from old.disponibilidade_pedido_confirmada then raise exception 'A disponibilidade informada no pedido é um registro de origem e não pode ser trocada.'; end if;
    if (new.pedido_id, new.diarista_id, new.data) is distinct from (old.pedido_id, old.diarista_id, old.data) then
      raise exception 'A diarista e a data da escala não podem ser alteradas. Exclua a escala pendente e crie outra.';
    end if;
    if old.status='desistiu' and new.status<>'desistiu' then raise exception 'Preserve a desistência registrada. Escolha uma substituição.'; end if;
    if new.status='desistiu' and old.status not in ('escalada','desistiu') then raise exception 'Desistência disponível apenas antes da presença ou falta.'; end if;
    if new.status = old.status then return new; end if;
    if old.status = 'presente' and new.status <> 'presente' and exists (
      select 1 from public.diarias where pedido_escala_id = old.id and data_pagamento is not null
    ) then
      raise exception 'A diária já foi paga. Corrija o pagamento antes de alterar a presença.';
    end if;
    if new.status in ('presente', 'falta') and new.data > (now() at time zone 'America/Fortaleza')::date then
      raise exception 'Presença ou falta só pode ser registrada a partir da data da diária.';
    end if;
    v_activating := old.status = 'falta' and new.status <> 'falta';
  else
    if new.status <> 'escalada' then
      raise exception 'Uma nova escala deve começar como escalada.';
    end if;
    v_activating := true;
  end if;

  select * into v_order from public.pedidos where id = new.pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  select t into v_shift from jsonb_array_elements(v_order.turnos) t where t->>'data' = new.data::text;
  if v_shift is null then raise exception 'A data escolhida não consta no pedido.'; end if;

  if v_activating then
    if v_order.situacao in ('concluido', 'cancelado') then
      raise exception 'Não é possível escalar uma diarista em pedido encerrado.';
    end if;
    select * into v_worker from public.diaristas where id = new.diarista_id for update;
    if not found or v_worker.bloqueada then
      raise exception 'Escolha uma diarista cadastrada e não bloqueada.';
    end if;
    v_day := (array['segunda','terca','quarta','quinta','sexta','sabado','domingo'])[extract(isodow from new.data)::integer];
    if not new.disponibilidade_pedido_confirmada and not exists (
      select 1 from jsonb_array_elements(v_worker.disponibilidade) slot
      where slot->>'dia' = v_day
        and (slot->>'inicio')::time <= (v_shift->>'inicio')::time
        and (slot->>'fim')::time >= (v_shift->>'fim')::time
    ) then
      raise exception 'A diarista não está disponível nesse dia e horário.';
    end if;
    if exists (
      select 1 from public.pedido_escalas e
      join public.pedidos p on p.id = e.pedido_id
      cross join lateral jsonb_array_elements(p.turnos) t
      where e.diarista_id = new.diarista_id and e.data = new.data and e.status not in ('falta','desistiu')
        and (tg_op = 'INSERT' or e.id <> new.id)
        and t->>'data' = e.data::text
        and (t->>'inicio')::time < (v_shift->>'fim')::time
        and (v_shift->>'inicio')::time < (t->>'fim')::time
    ) then
      raise exception 'A diarista já está escalada em outro pedido nesse horário.';
    end if;
    if (
      select count(*) from public.pedido_escalas
      where pedido_id = new.pedido_id and data = new.data and status not in ('falta','desistiu')
    ) >= v_order.quantidade_diaristas then
      raise exception 'A quantidade de diaristas deste dia já foi preenchida.';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;
revoke execute on function public.direct_validate_pedido_escala() from public,anon,authenticated;


create function direct_private.record_withdrawal() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.desistencia_motivo:=null;new.desistencia_em:=null;new.desistencia_por:=null;
 elsif new.status='desistiu' and old.status<>'desistiu' then
  if length(btrim(coalesce(new.desistencia_motivo,''))) not between 5 and 300 then raise exception 'Informe o motivo da desistência com 5 a 300 caracteres.'; end if;
  new.desistencia_em:=now();new.desistencia_por:=(select auth.jwt()->>'email');
 elsif (new.desistencia_motivo,new.desistencia_em,new.desistencia_por) is distinct from (old.desistencia_motivo,old.desistencia_em,old.desistencia_por) then
  raise exception 'Histórico da desistência não pode ser alterado diretamente.';
 end if;
 return new;
end $$;
create trigger record_withdrawal before insert or update on public.pedido_escalas for each row execute function direct_private.record_withdrawal();
revoke execute on function direct_private.record_withdrawal() from public,anon,authenticated;
create or replace function direct_private.link_substitute()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_absence bigint;
begin
  select id into v_absence from public.pedido_escalas
    where pedido_id = new.pedido_id and data = new.data and status in ('falta','desistiu')
      and substituida_por_escala_id is null and id <> new.id
    order by id limit 1 for update;
  if v_absence is not null then
    update public.pedido_escalas set substituida_por_escala_id = new.id where id = v_absence;
  end if;
  return null;
end;
$$;
create or replace function direct_private.guard_substitute_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.substituida_por_escala_id is not null and
     (new.status not in ('falta','desistiu') or not exists (
       select 1 from public.pedido_escalas s
       where s.id = new.substituida_por_escala_id and s.pedido_id = new.pedido_id
         and s.data = new.data and s.status not in ('falta','desistiu')
     )) then
    raise exception 'A substituta deve estar ativa no mesmo pedido e dia da falta.';
  end if;
  return new;
end;
$$;
create or replace function public.direct_read_order_assignment(p_pedido jsonb,p_nome text,p_cpf text,p_confirmar_cadastro boolean,p_chave uuid,p_pedido_id bigint default null,p_pendencia_id bigint default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.diaristas%rowtype; o public.pedidos%rowtype; t jsonb; old_scale public.pedido_escalas%rowtype;
  worker_created boolean:=false; order_created boolean:=false; created_ids jsonb:='[]'::jsonb; scale_id bigint;
begin
  if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para cadastrar e escalar.'; end if;
  if p_chave is null or p_nome is null or length(btrim(p_nome)) not between 1 and 180 or p_cpf is null or not public.direct_valid_cpf(p_cpf) then raise exception 'Confira o nome e o CPF do diarista escalado.'; end if;
  if jsonb_typeof(p_pedido) is distinct from 'object' or jsonb_typeof(p_pedido->'turnos') is distinct from 'array' then raise exception 'Pedido inválido.'; end if;
  if not exists(select 1 from public.lojas where lower(rede)=lower(p_pedido->>'supermercado') and lower(nome)=lower(p_pedido->>'unidade')) then raise exception 'Confira a rede e a loja do pedido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_cpf,0));
  select * into w from public.diaristas where cpf=p_cpf for update;
  if w.id is not null then
    if lower(regexp_replace(btrim(w.nome),'\s+',' ','g'))<>lower(regexp_replace(btrim(p_nome),'\s+',' ','g')) then raise exception 'O CPF pertence a %. Confira o nome informado.',w.nome; end if;
    if w.bloqueada then raise exception 'A pessoa informada está bloqueada. Revise o cadastro antes de escalar.'; end if;
  else
    if p_confirmar_cadastro is distinct from true then return jsonb_build_object('requires_registration',true,'nome',p_nome,'cpf',p_cpf); end if;
    insert into public.diaristas(nome,cpf) values(btrim(p_nome),p_cpf) returning * into w;
    worker_created:=true;
  end if;
  if p_pedido_id is not null then select * into o from public.pedidos where id=p_pedido_id for update;
    if o.id is null then raise exception 'O pedido não existe mais. Leia a mensagem novamente.'; end if;
  else select * into o from public.pedidos where chave_operacao=p_chave for update; end if;
  if o.id is null then
    insert into public.pedidos(supermercado,unidade,contato,setor,quantidade_diaristas,turnos,situacao,observacoes,chave_operacao)
    values(p_pedido->>'supermercado',coalesce(p_pedido->>'unidade',''),coalesce(p_pedido->>'contato',''),p_pedido->>'setor',(p_pedido->>'quantidade_diaristas')::integer,p_pedido->'turnos','novo',coalesce(p_pedido->>'observacoes',''),p_chave) returning * into o;
    order_created:=true;
  elsif (o.supermercado,o.unidade,o.setor,o.quantidade_diaristas,o.turnos) is distinct from
    (p_pedido->>'supermercado',p_pedido->>'unidade',p_pedido->>'setor',(p_pedido->>'quantidade_diaristas')::integer,p_pedido->'turnos') then
    raise exception 'Confira o pedido existente: rede, loja, setor ou datas não correspondem.';
  end if;
  if o.situacao in ('cancelado','concluido') then raise exception 'Não é possível escalar em pedido encerrado.'; end if;
  for t in select value from jsonb_array_elements(o.turnos) loop
    select * into old_scale from public.pedido_escalas where pedido_id=o.id and diarista_id=w.id and data=(t->>'data')::date;
    if old_scale.id is not null then
      if old_scale.status in ('falta','desistiu') then raise exception 'Já há uma falta registrada neste pedido. Revise a escala no pedido.'; end if;
      continue;
    end if;
    insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada)
    values(o.id,w.id,(t->>'data')::date,true) returning id into scale_id;
    created_ids:=created_ids||to_jsonb(scale_id);
  end loop;
  update public.pedidos set situacao=case when not exists (
    select 1 from jsonb_array_elements(o.turnos) shift
    where (select count(*) from public.pedido_escalas e
      where e.pedido_id=o.id and e.data=(shift->>'data')::date and e.status not in ('falta','desistiu')) < o.quantidade_diaristas
  ) then 'confirmado' else 'em_selecao' end, atualizado_em=now()
  where id=o.id returning * into o;
  if p_pendencia_id is not null then update public.leituras_pendentes set status='resolvido',atualizado_em=now()
    where id=p_pendencia_id and tipo='pedido' and dados->'diarista_escalado'->>'cpf'=p_cpf; end if;
  return jsonb_build_object('requires_registration',false,'pedido_id',o.id,'diarista_id',w.id,'nome',w.nome,'cadastro_criado',worker_created,'pedido_criado',order_created,'escalas_criadas',created_ids,'dias',jsonb_array_length(o.turnos),'situacao',o.situacao);
end $$;
revoke execute on function public.direct_read_order_assignment(jsonb,text,text,boolean,uuid,bigint,bigint) from public,anon;
grant execute on function public.direct_read_order_assignment(jsonb,text,text,boolean,uuid,bigint,bigint) to authenticated;


create function public.direct_sync_order_staffing() returns trigger language plpgsql security invoker set search_path='' as $$
declare oid bigint; o public.pedidos%rowtype; target text;
begin
 oid:=case when tg_op='DELETE' then old.pedido_id else new.pedido_id end;
 select * into o from public.pedidos where id=oid for update;
 if o.id is null or o.situacao in ('cancelado','concluido') then return null; end if;
 target:=case when not exists(select 1 from jsonb_array_elements(o.turnos) t where
  (select count(*) from public.pedido_escalas e where e.pedido_id=oid and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))<o.quantidade_diaristas)
  then 'confirmado' when exists(select 1 from public.pedido_escalas where pedido_id=oid) then 'em_selecao' else 'novo' end;
 if target<>o.situacao then update public.pedidos set situacao=target,atualizado_em=now() where id=oid; end if;
 return null;
end $$;
create trigger sync_order_staffing after insert or update of status or delete on public.pedido_escalas for each row execute function public.direct_sync_order_staffing();
revoke execute on function public.direct_sync_order_staffing() from public,anon,authenticated;

create function public.direct_replace_order_worker(p_pedido_id bigint,p_escala_id bigint,p_diarista_id bigint,p_motivo text,p_disponibilidade_confirmada boolean default false)
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
