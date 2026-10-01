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
      if old_scale.status='falta' then raise exception 'Já há uma falta registrada neste pedido. Revise a escala no pedido.'; end if;
      continue;
    end if;
    insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada)
    values(o.id,w.id,(t->>'data')::date,true) returning id into scale_id;
    created_ids:=created_ids||to_jsonb(scale_id);
  end loop;
  update public.pedidos set situacao=case when not exists (
    select 1 from jsonb_array_elements(o.turnos) shift
    where (select count(*) from public.pedido_escalas e
      where e.pedido_id=o.id and e.data=(shift->>'data')::date and e.status<>'falta') < o.quantidade_diaristas
  ) then 'confirmado' else 'em_selecao' end, atualizado_em=now()
  where id=o.id returning * into o;
  if p_pendencia_id is not null then update public.leituras_pendentes set status='resolvido',atualizado_em=now()
    where id=p_pendencia_id and tipo='pedido' and dados->'diarista_escalado'->>'cpf'=p_cpf; end if;
  return jsonb_build_object('requires_registration',false,'pedido_id',o.id,'diarista_id',w.id,'nome',w.nome,'cadastro_criado',worker_created,'pedido_criado',order_created,'escalas_criadas',created_ids,'dias',jsonb_array_length(o.turnos),'situacao',o.situacao);
end $$;
revoke execute on function public.direct_read_order_assignment(jsonb,text,text,boolean,uuid,bigint,bigint) from public,anon;
grant execute on function public.direct_read_order_assignment(jsonb,text,text,boolean,uuid,bigint,bigint) to authenticated;

-- Reconcile previously imported readings only when every requested vacancy is staffed.
update public.pedidos p set situacao='confirmado', atualizado_em=now()
where p.situacao in ('novo','em_selecao') and p.chave_operacao is not null
  and jsonb_array_length(p.turnos)>0
  and not exists (
    select 1 from jsonb_array_elements(p.turnos) shift
    where (select count(*) from public.pedido_escalas e
      where e.pedido_id=p.id and e.data=(shift->>'data')::date and e.status<>'falta') < p.quantidade_diaristas
  );
