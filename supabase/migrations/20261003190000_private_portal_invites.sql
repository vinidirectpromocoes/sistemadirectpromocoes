-- Dois links exclusivos por convite. Sem convite não se cadastra nem se lista vagas.
create table direct_private.portal_convites (
 id uuid primary key default gen_random_uuid(),
 cadastro_hash bytea not null unique, vagas_hash bytea not null unique,
 cpf text check(cpf is null or public.direct_valid_cpf(cpf)),
 usado_por uuid references auth.users(id) on delete restrict,
 criado_por uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default now(), expira_em timestamptz not null,
 ativo boolean not null default true
);
alter table direct_private.portal_convites enable row level security;
revoke all on direct_private.portal_convites from public,anon,authenticated;

create function public.direct_portal_create_invite(p_cpf text default null,p_dias integer default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare c text:=encode(extensions.gen_random_bytes(32),'hex');v text:=encode(extensions.gen_random_bytes(32),'hex');i direct_private.portal_convites%rowtype;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para gerar links privados.';end if;
 if p_dias is null or p_dias not between 1 and 90 then raise exception 'Informe validade de 1 a 90 dias.';end if;
 if p_cpf is not null and not public.direct_valid_cpf(p_cpf) then raise exception 'Confira o CPF do convite.';end if;
 insert into direct_private.portal_convites(cadastro_hash,vagas_hash,cpf,criado_por,expira_em)
 values(extensions.digest(c,'sha256'),extensions.digest(v,'sha256'),p_cpf,auth.uid(),now()+p_dias*interval '1 day') returning * into i;
 return jsonb_build_object('cadastro_token',c,'vagas_token',v,'expira_em',i.expira_em);
end $$;

create function direct_private.portal_invite(p_token text,p_tipo text) returns direct_private.portal_convites language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_tipo not in ('cadastro','vagas') then raise exception 'Peça à Direct um link privado válido.';end if;
 select * into i from direct_private.portal_convites where ativo and expira_em>now() and
 case when p_tipo='cadastro' then cadastro_hash else vagas_hash end=extensions.digest(p_token,'sha256');
 if i.id is null then raise exception 'Este convite venceu ou foi desativado. Peça um novo link à Direct.';end if;
 return i;
end $$;
revoke all on function direct_private.portal_invite(text,text) from public,anon,authenticated;

create function public.direct_portal_invite_status(p_token text,p_tipo text) returns boolean language plpgsql security definer set search_path='' as $$
begin perform direct_private.portal_invite(p_token,p_tipo);return true;end $$;

-- Cadastro anterior passa a ser interno: só o wrapper confere e consome o convite.
alter function public.direct_portal_register(jsonb) rename to direct_portal_register_internal;
revoke all on function public.direct_portal_register_internal(jsonb) from public,anon,authenticated;
create function public.direct_portal_register(p_dados jsonb,p_convite text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=direct_private.portal_user();i direct_private.portal_convites%rowtype;result jsonb;
begin
 i:=direct_private.portal_invite(p_convite,'cadastro');
 select * into i from direct_private.portal_convites where id=i.id for update;
 if i.usado_por is not null and i.usado_por<>uid then raise exception 'Este convite pertence a outro acesso. Peça seu próprio link à Direct.';end if;
 if i.cpf is not null and i.cpf<>regexp_replace(coalesce(p_dados->>'cpf',''),'\D','','g') then raise exception 'O CPF não corresponde ao convite enviado pela Direct.';end if;
 result:=public.direct_portal_register_internal(p_dados);
 if i.cpf is not null and result->>'status'='pendente' then
  if exists(select 1 from public.portal_cadastros c join public.diaristas w on w.cpf=c.cpf where c.user_id=uid and not w.bloqueada and not exists(select 1 from public.portal_cadastros another where another.diarista_id=w.id)) then
   update public.portal_cadastros c set diarista_id=w.id,status='ativo',atualizado_em=now() from public.diaristas w where c.user_id=uid and w.cpf=c.cpf;
   result:=jsonb_set(result,'{status}','"ativo"');
  end if;
 end if;
 update direct_private.portal_convites set usado_por=uid where id=i.id;
 return result;
end $$;

-- Só pedidos com vaga em TODOS os dias e ainda não iniciados aparecem.
alter function public.direct_portal_orders() rename to direct_portal_orders_internal;
revoke all on function public.direct_portal_orders_internal() from public,anon,authenticated;
create function public.direct_portal_orders(p_convite text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;result jsonb;
begin
 i:=direct_private.portal_invite(p_convite,'vagas');
 if auth.uid() is not null and i.usado_por is not null and i.usado_por<>auth.uid() then raise exception 'Use o link exclusivo enviado para você.';end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from jsonb_array_elements(public.direct_portal_orders_internal()) item
 join public.pedidos p on p.id=(item->>'id')::bigint
 where jsonb_array_length(item->'turnos')=jsonb_array_length(p.turnos);
 return result;
end $$;

alter function public.direct_portal_accept(bigint,date[]) rename to direct_portal_accept_internal;
revoke all on function public.direct_portal_accept_internal(bigint,date[]) from public,anon,authenticated;
create function public.direct_portal_accept(p_pedido_id bigint,p_convite text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=direct_private.portal_user();i direct_private.portal_convites%rowtype;c public.portal_cadastros%rowtype;o public.pedidos%rowtype;dates date[];
begin
 i:=direct_private.portal_invite(p_convite,'vagas');
 select * into i from direct_private.portal_convites where id=i.id for update;
 select * into c from public.portal_cadastros where user_id=uid and status='ativo';
 if c.diarista_id is null then raise exception 'Conclua seu cadastro e aguarde a liberação da Direct, se solicitada.';end if;
 if (i.usado_por is not null and i.usado_por<>uid) or (i.cpf is not null and i.cpf<>c.cpf) then raise exception 'Use o link exclusivo enviado para você.';end if;
 select * into o from public.pedidos where id=p_pedido_id for update;
 if o.id is null or o.situacao in ('cancelado','concluido') then raise exception 'Pedido indisponível. Atualize as vagas.';end if;
 select array_agg((value->>'data')::date order by value->>'data') into dates from jsonb_array_elements(o.turnos);
 -- Não reduz a escala às vagas restantes. Qualquer impedimento reverte toda a operação.
 if exists(select 1 from jsonb_array_elements(o.turnos) t where ((t->>'data')::date+(t->>'inicio')::time)<=(now() at time zone 'America/Fortaleza') or
 (select count(*) from public.pedido_escalas e where e.pedido_id=o.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu') and e.diarista_id<>c.diarista_id)>=o.quantidade_diaristas) then raise exception 'A escala completa não está mais disponível. Fale com a Direct.';end if;
 update direct_private.portal_convites set usado_por=uid where id=i.id;
 return public.direct_portal_accept_internal(o.id,dates);
end $$;

revoke all on function public.direct_portal_create_invite(text,integer),public.direct_portal_invite_status(text,text),public.direct_portal_register(jsonb,text),public.direct_portal_orders(text),public.direct_portal_accept(bigint,text) from public,anon,authenticated;
grant execute on function public.direct_portal_invite_status(text,text),public.direct_portal_orders(text) to anon,authenticated;
grant execute on function public.direct_portal_create_invite(text,integer),public.direct_portal_register(jsonb,text),public.direct_portal_accept(bigint,text) to authenticated;
