-- Cadastro privado sem Auth: o convite identifica a pessoa, sem conta no sistema.
alter table public.diaristas add column data_nascimento date, add column rede_trabalho text not null default '';
alter table public.diaristas drop constraint direct_diaristas_valid_fields;
alter table public.diaristas add constraint direct_diaristas_valid_fields check (
 length(btrim(nome)) between 1 and 180 and (cep='' or cep ~ '^[0-9]{8}$')
 and length(logradouro)<=180 and length(numero)<=30 and length(bairro)<=100 and length(complemento)<=120
 and length(btrim(cidade)) between 1 and 80 and uf ~ '^[A-Z]{2}$'
 and length(local_trabalho)<=180 and length(rede_trabalho)<=100 and length(transporte)<=80 and length(observacoes_locomocao)<=300
 and (data_nascimento is null or data_nascimento between date '1900-01-01' and current_date));
alter table direct_private.portal_convites add column diarista_id bigint references public.diaristas(id) on delete set null,
 add column success_vagas_hash bytea unique;
update direct_private.portal_convites i set diarista_id=c.diarista_id from public.portal_cadastros c where c.user_id=i.usado_por and c.status='ativo';
create index portal_convites_diarista_idx on direct_private.portal_convites(diarista_id);
create table direct_private.portal_config(id boolean primary key default true check(id),whatsapp text not null default '',grupo_url text not null default '');
insert into direct_private.portal_config default values;
alter table direct_private.portal_config enable row level security;
revoke all on direct_private.portal_config from public,anon,authenticated;

create or replace function direct_private.portal_invite(p_token text,p_tipo text) returns direct_private.portal_convites language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_tipo is null or p_tipo not in ('cadastro','vagas') then raise exception 'Peça à Direct um link privado válido.';end if;
 select * into i from direct_private.portal_convites where ativo and expira_em>now() and
 ((p_tipo='cadastro' and cadastro_hash=extensions.digest(p_token,'sha256')) or
 (p_tipo='vagas' and (vagas_hash=extensions.digest(p_token,'sha256') or success_vagas_hash=extensions.digest(p_token,'sha256'))));
 if i.id is null then raise exception 'Este convite venceu ou foi desativado. Peça um novo link à Direct.';end if;
 return i;
end $$;
create or replace function public.direct_portal_create_invite(p_cpf text default null,p_dias integer default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare c text:=encode(extensions.gen_random_bytes(32),'hex');v text:=encode(extensions.gen_random_bytes(32),'hex');i direct_private.portal_convites%rowtype;wid bigint;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para gerar links privados.';end if;
 if p_dias is null or p_dias not between 1 and 90 then raise exception 'Informe validade de 1 a 90 dias.';end if;
 if p_cpf is not null and not public.direct_valid_cpf(p_cpf) then raise exception 'Confira o CPF do convite.';end if;
 -- O vínculo de CPF já existente depende do convite emitido pela equipe, nunca de consulta pública.
 if p_cpf is not null then select id into wid from public.diaristas where cpf=p_cpf and not bloqueada;end if;
 insert into direct_private.portal_convites(cadastro_hash,vagas_hash,cpf,diarista_id,criado_por,expira_em)
 values(extensions.digest(c,'sha256'),extensions.digest(v,'sha256'),p_cpf,wid,auth.uid(),now()+p_dias*interval '1 day') returning * into i;
 return jsonb_build_object('cadastro_token',c,'vagas_token',v,'expira_em',i.expira_em);
end $$;

create function public.direct_portal_settings(p_whatsapp text default null,p_grupo_url text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg direct_private.portal_config%rowtype;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão.';end if;
 if p_whatsapp is not null or p_grupo_url is not null then
  if direct_private.member_role()<>'admin' then raise exception 'Somente o administrador configura os contatos.';end if;
  if p_whatsapp is null or p_grupo_url is null or (p_whatsapp<>'' and p_whatsapp !~ '^55[0-9]{10,11}$') or (p_grupo_url<>'' and p_grupo_url !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,100}$') then raise exception 'Confira o WhatsApp com DDD e o link de convite do grupo.';end if;
  update direct_private.portal_config set whatsapp=p_whatsapp,grupo_url=p_grupo_url;
 end if;
 select * into cfg from direct_private.portal_config;
 return jsonb_build_object('whatsapp',cfg.whatsapp,'grupo_url',cfg.grupo_url);
end $$;

create function public.direct_portal_context(p_convite text,p_tipo text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;cfg direct_private.portal_config%rowtype;v text;blocked boolean:=false;
begin
 i:=direct_private.portal_invite(p_convite,p_tipo);
 if i.diarista_id is not null then
  select bloqueada into blocked from public.diaristas where id=i.diarista_id;
  if p_tipo='cadastro' then
   -- Segundo token derivado do segredo do cadastro; os links de vagas originais continuam válidos.
   v:=encode(extensions.hmac('vagas',p_convite,'sha256'),'hex');
   update direct_private.portal_convites set success_vagas_hash=extensions.digest(v,'sha256') where id=i.id;
  end if;
 end if;
 select * into cfg from direct_private.portal_config;
 return jsonb_build_object('cadastrado',i.diarista_id is not null,'bloqueado',blocked,'vagas_token',v,
 'whatsapp',cfg.whatsapp,'grupo_url',cfg.grupo_url,
 'setores',(select coalesce(jsonb_agg(setor order by setor),'[]'::jsonb) from (select distinct setor from public.tarifas_setores) s),
 'redes',(select coalesce(jsonb_agg(rede order by rede),'[]'::jsonb) from public.tarifas_redes));
end $$;

create function public.direct_portal_submit(p_dados jsonb,p_convite text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;w public.diaristas%rowtype;
 n text:=btrim(p_dados->>'nome');c text:=regexp_replace(coalesce(p_dados->>'cpf',''),'\D','','g');birth date;work boolean;travel boolean;
begin
 i:=direct_private.portal_invite(p_convite,'cadastro');
 select * into i from direct_private.portal_convites where id=i.id for update;
 if jsonb_typeof(p_dados) is distinct from 'object' or length(p_dados::text)>12000 or n is null or length(n) not between 3 and 180 or not public.direct_valid_cpf(c) then raise exception 'Confira o nome completo e o CPF válido.';end if;
 if i.cpf is not null and i.cpf<>c then raise exception 'O CPF não corresponde ao convite enviado pela Direct.';end if;
 if i.diarista_id is not null then
  if not exists(select 1 from public.diaristas where id=i.diarista_id and cpf=c and not bloqueada) then raise exception 'Este link pertence a outro cadastro ou está bloqueado. Fale com a Direct.';end if;
  return public.direct_portal_context(p_convite,'cadastro');
 end if;
 if (p_dados->>'data_nascimento') is null or (p_dados->>'data_nascimento') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Informe sua data de nascimento.';end if;
 birth:=(p_dados->>'data_nascimento')::date;
 if birth not between date '1900-01-01' and current_date then raise exception 'Confira a data de nascimento.';end if;
 if not coalesce(public.direct_valid_sectors(p_dados->'setores'),false) or not coalesce(public.direct_valid_slots(p_dados->'disponibilidade'),false) then raise exception 'Marque os setores e os dias com horários disponíveis.';end if;
 if jsonb_typeof(p_dados->'trabalhando') is distinct from 'boolean' or jsonb_typeof(p_dados->'pode_se_deslocar') is distinct from 'boolean' or (p_dados->'consentimento') is distinct from 'true'::jsonb then raise exception 'Responda sobre trabalho, locomoção e confirme as informações.';end if;
 work:=(p_dados->>'trabalhando')::boolean;travel:=(p_dados->>'pode_se_deslocar')::boolean;
 if coalesce(p_dados->>'cep','') !~ '^\d{8}$' or length(btrim(coalesce(p_dados->>'numero',''))) not between 1 and 30 or length(btrim(coalesce(p_dados->>'logradouro',''))) not between 1 and 180 or length(btrim(coalesce(p_dados->>'bairro',''))) not between 1 and 100 or length(btrim(coalesce(p_dados->>'cidade',''))) not between 1 and 80 or coalesce(p_dados->>'uf','') !~ '^[A-Z]{2}$' then raise exception 'Confira o CEP, endereço, cidade e número da casa.';end if;
 if length(btrim(coalesce(p_dados->>'transporte',''))) not between 1 and 80 or (not travel and length(btrim(coalesce(p_dados->>'observacoes_locomocao',''))) not between 1 and 300) then raise exception 'Informe os meios de transporte e as regiões que pode atender.';end if;
 if work and (length(btrim(coalesce(p_dados->>'local_trabalho',''))) not between 1 and 180 or length(btrim(coalesce(p_dados->>'rede_trabalho',''))) not between 1 and 100) then raise exception 'Informe onde trabalha e a empresa ou rede.';end if;
 perform pg_advisory_xact_lock(hashtextextended(c,0));
 select * into w from public.diaristas where cpf=c for update;
 if w.id is not null then
  if i.cpf is null or w.bloqueada then raise exception 'Este CPF já tem cadastro. Peça à Direct um link vinculado ao seu CPF.';end if;
 else
  insert into public.diaristas(nome,cpf,data_nascimento,setores,cep,logradouro,numero,complemento,bairro,cidade,uf,trabalhando,rede_trabalho,local_trabalho,disponibilidade,pode_se_deslocar,transporte,observacoes_locomocao)
  values(n,c,birth,p_dados->'setores',p_dados->>'cep',btrim(p_dados->>'logradouro'),btrim(p_dados->>'numero'),coalesce(p_dados->>'complemento',''),btrim(p_dados->>'bairro'),btrim(p_dados->>'cidade'),p_dados->>'uf',work,case when work then p_dados->>'rede_trabalho' else '' end,case when work then btrim(p_dados->>'local_trabalho') else '' end,p_dados->'disponibilidade',travel,p_dados->>'transporte',coalesce(p_dados->>'observacoes_locomocao','')) returning * into w;
 end if;
 update direct_private.portal_convites set diarista_id=w.id,cpf=c where id=i.id;
 return public.direct_portal_context(p_convite,'cadastro');
end $$;

create function direct_private.portal_same_employer(w public.diaristas,rede text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(w.trabalhando,false) and (
 lower(translate(w.rede_trabalho,'áàãâéêíóôõúç','aaaaeeiooouc'))=lower(translate(rede,'áàãâéêíóôõúç','aaaaeeiooouc')) or
 position(lower(translate(rede,'áàãâéêíóôõúç','aaaaeeiooouc')) in lower(translate(w.local_trabalho,'áàãâéêíóôõúç','aaaaeeiooouc')))>0);
$$;
create or replace function public.direct_portal_orders(p_convite text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;w public.diaristas%rowtype;result jsonb;
begin
 i:=direct_private.portal_invite(p_convite,'vagas');
 if i.diarista_id is not null then select * into w from public.diaristas where id=i.diarista_id;if w.bloqueada then return '[]'::jsonb;end if;end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from jsonb_array_elements(public.direct_portal_orders_internal()) item
 join public.pedidos p on p.id=(item->>'id')::bigint where jsonb_array_length(item->'turnos')=jsonb_array_length(p.turnos)
 and not coalesce(direct_private.portal_same_employer(w,p.supermercado),false);
 return result;
end $$;
create function public.direct_portal_take_order(p_pedido_id bigint,p_convite text,p_cpf text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;w public.diaristas%rowtype;o public.pedidos%rowtype;t jsonb;eid bigint;added int:=0;
begin
 i:=direct_private.portal_invite(p_convite,'vagas');
 select * into i from direct_private.portal_convites where id=i.id for update;
 if i.diarista_id is null then raise exception 'Você precisa estar cadastrado. Peça à Direct seu link privado de cadastro.';end if;
 select * into o from public.pedidos where id=p_pedido_id for update;
 select * into w from public.diaristas where id=i.diarista_id for update;
 if w.id is null or w.bloqueada then raise exception 'Cadastro bloqueado ou não encontrado. Fale com a Direct.';end if;
 if not public.direct_valid_cpf(coalesce(p_cpf,'')) or p_cpf<>w.cpf then raise exception 'Confira seu CPF. Use o link privado enviado para você.';end if;
 if o.id is null or o.situacao in ('cancelado','concluido') then raise exception 'Pedido indisponível. Fale com a Direct.';end if;
 if direct_private.portal_same_employer(w,o.supermercado) then raise exception 'Funcionário de supermercado não pode fazer diária na mesma empresa em que trabalha.';end if;
 if exists(select 1 from jsonb_array_elements(o.turnos) t where ((t->>'data')::date+(t->>'inicio')::time)<=(now() at time zone 'America/Fortaleza') or
 (select count(*) from public.pedido_escalas e where e.pedido_id=o.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu') and e.diarista_id<>w.id)>=o.quantidade_diaristas) then raise exception 'A escala completa não está mais disponível. Fale com a Direct.';end if;
 for t in select value from jsonb_array_elements(o.turnos) order by value->>'data' loop
  select id into eid from public.pedido_escalas where pedido_id=o.id and diarista_id=w.id and data=(t->>'data')::date;
  if eid is not null then
   if not exists(select 1 from public.pedido_escalas where id=eid and status in ('escalada','presente')) then raise exception 'Há um registro anterior de falta ou desistência. Fale com a Direct.';end if;
   continue;
  end if;
  insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o.id,w.id,(t->>'data')::date,true) returning id into eid;
  update public.pedido_escalas set confirmacao='confirmou' where id=eid;
  added:=added+1;
 end loop;
 return jsonb_build_object('dias',added,'mensagem','Escala confirmada. A Direct acompanha sua presença no dia da diária.');
end $$;
-- Desliga o fluxo antigo de criação de contas. Contas da equipe permanecem protegidas.
revoke all on function public.direct_portal_register(jsonb,text),public.direct_portal_accept(bigint,text),public.direct_portal_me(),public.direct_portal_approve(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.direct_portal_signup_prepare(text,text,text,text),public.direct_portal_signup_finish(text,uuid,uuid),public.direct_portal_signup_release(text,uuid) from public,anon,authenticated,service_role;
drop policy portal_own_or_operator on public.portal_cadastros;
create policy portal_staff_history on public.portal_cadastros for select to authenticated using((select direct_private.member_role()) in ('admin','operacao'));
revoke all on function public.direct_portal_settings(text,text),public.direct_portal_context(text,text),public.direct_portal_submit(jsonb,text),public.direct_portal_take_order(bigint,text,text) from public,anon,authenticated;
revoke all on function direct_private.portal_same_employer(public.diaristas,text) from public,anon,authenticated;
grant execute on function public.direct_portal_settings(text,text) to authenticated;
grant execute on function public.direct_portal_context(text,text),public.direct_portal_submit(jsonb,text),public.direct_portal_take_order(bigint,text,text) to anon,authenticated;
