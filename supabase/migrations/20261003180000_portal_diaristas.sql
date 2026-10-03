-- Portal público: só vagas; dados pessoais e escala exigem conta confirmada e vínculo.
create table public.portal_cadastros (
 user_id uuid primary key references auth.users(id) on delete cascade,
 diarista_id bigint unique references public.diaristas(id) on delete restrict,
 nome text not null, cpf text not null check(public.direct_valid_cpf(cpf)), email text not null,
 dados jsonb not null default '{}'::jsonb,
 status text not null check(status in ('ativo','pendente','recusado')),
 criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
alter table public.portal_cadastros enable row level security;
revoke all on public.portal_cadastros from anon,authenticated;
grant select on public.portal_cadastros to authenticated;
create policy portal_own_or_operator on public.portal_cadastros for select to authenticated
 using(user_id=(select auth.uid()) or (select direct_private.member_role()) in ('admin','operacao'));

create function direct_private.portal_user() returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and (banned_until is null or banned_until<now())) then
  raise exception 'Entre com seu e-mail confirmado para continuar.';
 end if;
 return uid;
end $$;
revoke all on function direct_private.portal_user() from public,anon,authenticated;

create function public.direct_portal_register(p_dados jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=direct_private.portal_user(); w public.diaristas%rowtype; existing public.portal_cadastros%rowtype;
 v_nome text:=btrim(p_dados->>'nome'); v_cpf text:=regexp_replace(coalesce(p_dados->>'cpf',''),'\D','','g'); v_mail text;
begin
 if v_nome is null or length(v_nome) not between 3 and 180 or not public.direct_valid_cpf(v_cpf) then raise exception 'Confira o nome completo e o CPF válido.'; end if;
 if jsonb_typeof(p_dados) is distinct from 'object' or length(p_dados::text)>12000 then raise exception 'Cadastro inválido.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_cpf,0));
 select * into existing from public.portal_cadastros where user_id=uid for update;
 if existing.user_id is not null then
  if existing.cpf<>v_cpf then raise exception 'Este acesso já está vinculado a outro cadastro.'; end if;
  return jsonb_build_object('status',existing.status,'nome',existing.nome);
 end if;
 select email into v_mail from auth.users where id=uid;
 select * into w from public.diaristas where diaristas.cpf=v_cpf for update;
 if w.id is null then
  insert into public.diaristas(nome,cpf,setores,bairro,logradouro,numero,cep,complemento,transporte)
  values(v_nome,v_cpf,coalesce(p_dados->'setores','[]'::jsonb),coalesce(p_dados->>'bairro',''),coalesce(p_dados->>'logradouro',''),coalesce(p_dados->>'numero',''),regexp_replace(coalesce(p_dados->>'cep',''),'\D','','g'),coalesce(p_dados->>'complemento',''),coalesce(p_dados->>'transporte','')) returning * into w;
  insert into public.portal_cadastros(user_id,diarista_id,nome,cpf,email,dados,status) values(uid,w.id,v_nome,v_cpf,v_mail,p_dados,'ativo');
  return jsonb_build_object('status','ativo','nome',v_nome);
 end if;
 -- Não revela o nome do titular nem vincula por conhecimento do CPF.
 insert into public.portal_cadastros(user_id,nome,cpf,email,dados,status) values(uid,v_nome,v_cpf,v_mail,p_dados,'pendente');
 return jsonb_build_object('status','pendente','nome',v_nome);
end $$;

create function public.direct_portal_approve(p_user_id uuid,p_aprovar boolean) returns void language plpgsql security definer set search_path='' as $$
declare c public.portal_cadastros%rowtype; w public.diaristas%rowtype;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para conferir acessos.'; end if;
 select * into c from public.portal_cadastros where user_id=p_user_id for update;
 if c.status is distinct from 'pendente' then raise exception 'Solicitação já conferida ou não encontrada.'; end if;
 if p_aprovar is null then raise exception 'Informe a decisão de acesso.'; end if;
 if not p_aprovar then update public.portal_cadastros set status='recusado',atualizado_em=now() where user_id=p_user_id; return; end if;
 select * into w from public.diaristas where cpf=c.cpf for update;
 if w.id is null or w.bloqueada then raise exception 'Cadastro não encontrado ou bloqueado.'; end if;
 if exists(select 1 from public.portal_cadastros where diarista_id=w.id) then raise exception 'Esta pessoa já tem outro acesso vinculado. Confira com a Direct.'; end if;
 update public.portal_cadastros set diarista_id=w.id,status='ativo',atualizado_em=now() where user_id=p_user_id;
end $$;

create function public.direct_portal_orders() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(o.item order by o.first_date,o.id),'[]'::jsonb) from (
 select p.id,min(t->>'data') first_date,jsonb_build_object('id',p.id,'rede',p.supermercado,'loja',p.unidade,'setor',p.setor,
 'endereco',(select l.endereco from public.lojas l where lower(l.rede)=lower(p.supermercado) and lower(l.nome)=lower(p.unidade) limit 1),
 'valor_centavos',coalesce((select ts.valor_pago_centavos from public.tarifas_setores ts where lower(ts.rede)=lower(p.supermercado) and lower(ts.setor)=lower(p.setor)),
 (select ts.valor_pago_centavos from public.tarifas_setores ts where ts.rede='' and lower(ts.setor)=lower(p.setor)),
 (select tr.valor_padrao_centavos from public.tarifas_redes tr where lower(tr.rede)=lower(p.supermercado))),
 'turnos',jsonb_agg(jsonb_build_object('data',t->>'data','inicio',t->>'inicio','fim',t->>'fim','vagas',p.quantidade_diaristas-(select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))) order by t->>'data')) item
 from public.pedidos p cross join lateral jsonb_array_elements(p.turnos) t
 where p.situacao not in ('cancelado','concluido')
 and ((t->>'data')::date+(t->>'inicio')::time)>(now() at time zone 'America/Fortaleza')
 and (select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))<p.quantidade_diaristas
 group by p.id order by min(t->>'data'),p.id limit 200
 ) o;
$$;

create function public.direct_portal_me() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=direct_private.portal_user(); c public.portal_cadastros%rowtype; shifts jsonb;
begin
 select * into c from public.portal_cadastros where user_id=uid;
 if c.user_id is null then return jsonb_build_object('status','sem_cadastro'); end if;
 select coalesce(jsonb_agg(s.item order by s.data desc),'[]'::jsonb) into shifts from (
 select e.data,jsonb_build_object('id',e.id,'pedido_id',e.pedido_id,'rede',p.supermercado,'loja',p.unidade,'setor',p.setor,'data',e.data,'inicio',t->>'inicio','fim',t->>'fim','status',e.status,'confirmacao',e.confirmacao) item
 from public.pedido_escalas e join public.pedidos p on p.id=e.pedido_id cross join lateral jsonb_array_elements(p.turnos) t
 where e.diarista_id=c.diarista_id and t->>'data'=e.data::text order by e.data desc limit 100) s;
 return jsonb_build_object('status',case when exists(select 1 from public.diaristas where id=c.diarista_id and bloqueada) then 'bloqueado' else c.status end,'nome',c.nome,'escalas',shifts);
end $$;

create function public.direct_portal_accept(p_pedido_id bigint,p_datas date[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=direct_private.portal_user(); c public.portal_cadastros%rowtype; o public.pedidos%rowtype; d date; t jsonb; eid bigint; added int:=0;
begin
 select * into c from public.portal_cadastros where user_id=uid and status='ativo';
 if c.diarista_id is null then raise exception 'Conclua seu cadastro e aguarde a liberação da Direct, se solicitada.'; end if;
 if coalesce(cardinality(p_datas),0) not between 1 and 60 or array_position(p_datas,null) is not null then raise exception 'Selecione de 1 a 60 dias disponíveis.'; end if;
 select * into o from public.pedidos where id=p_pedido_id for update;
 if o.id is null or o.situacao in ('cancelado','concluido') then raise exception 'Pedido indisponível. Atualize as vagas.'; end if;
 perform 1 from public.diaristas where id=c.diarista_id and not bloqueada for update;
 if not found then raise exception 'Seu cadastro está bloqueado. Fale com a Direct.'; end if;
 for d in select distinct unnest(p_datas) order by 1 loop
  select value into t from jsonb_array_elements(o.turnos) where value->>'data'=d::text;
  if t is null or (d+(t->>'inicio')::time)<=(now() at time zone 'America/Fortaleza') then raise exception 'Uma data não está disponível ou o turno já começou. Atualize as vagas.'; end if;
  select id into eid from public.pedido_escalas where pedido_id=o.id and diarista_id=c.diarista_id and data=d and status not in ('falta','desistiu');
  if eid is not null then continue; end if;
  insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o.id,c.diarista_id,d,true) returning id into eid;
  update public.pedido_escalas set confirmacao='confirmou' where id=eid;
  added:=added+1;
 end loop;
 return jsonb_build_object('dias',added,'mensagem','Escala confirmada. A Direct acompanha a presença no dia da diária.');
end $$;

revoke all on function public.direct_portal_register(jsonb),public.direct_portal_approve(uuid,boolean),public.direct_portal_orders(),public.direct_portal_me(),public.direct_portal_accept(bigint,date[]) from public,anon,authenticated;
grant execute on function public.direct_portal_orders() to anon,authenticated;
grant execute on function public.direct_portal_register(jsonb),public.direct_portal_approve(uuid,boolean),public.direct_portal_me(),public.direct_portal_accept(bigint,date[]) to authenticated;
