-- Catálogo único: Leitura IA e cadastro manual gravam em pedidos; vagas consultam essa base.
create or replace function public.direct_portal_orders_internal() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(o.item order by o.first_date,o.id),'[]'::jsonb) from (
 select p.id,min(t->>'data') first_date,jsonb_build_object('id',p.id,'rede',p.supermercado,'loja',p.unidade,'setor',p.setor,
 'endereco',(select l.endereco || case when l.bairro<>'' and position(lower(l.bairro) in lower(l.endereco))=0 then ' · '||l.bairro else '' end || case when position(lower(l.cidade) in lower(l.endereco))=0 then ' · '||l.cidade||'/'||l.uf else '' end from public.lojas l where lower(l.rede)=lower(p.supermercado) and lower(l.nome)=lower(p.unidade) limit 1),
 'valor_centavos',case when count(distinct coalesce(direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date),-1))=1 then min(direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date)) else null end,
 'turnos',jsonb_agg(jsonb_build_object('data',t->>'data','inicio',t->>'inicio','fim',t->>'fim','valor_centavos',direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date),'vagas',p.quantidade_diaristas-(select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))) order by t->>'data')) item
 from public.pedidos p cross join lateral jsonb_array_elements(p.turnos) t
 where p.situacao not in ('cancelado','concluido') and ((t->>'data')::date+(t->>'inicio')::time)>(now() at time zone 'America/Fortaleza')
 and not exists(select 1 from jsonb_array_elements(p.turnos) s
 where ((s->>'data')::date+(s->>'inicio')::time)>(now() at time zone 'America/Fortaleza')
 and (select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(s->>'data')::date and e.status not in ('falta','desistiu'))>=p.quantidade_diaristas)
 group by p.id
 ) o;
$$;
revoke all on function public.direct_portal_orders_internal() from public,anon,authenticated;

-- Evita colisão entre alias SQL e variável PL/pgSQL.
create or replace function public.direct_portal_take_order(p_pedido_id bigint,p_convite text,p_cpf text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if not exists(select 1 from jsonb_array_elements(o.turnos) s where ((s->>'data')::date+(s->>'inicio')::time)>(now() at time zone 'America/Fortaleza')) then raise exception 'Esta escala já terminou.';end if;
 if exists(select 1 from jsonb_array_elements(o.turnos) shift_row where ((shift_row->>'data')::date+(shift_row->>'inicio')::time)>(now() at time zone 'America/Fortaleza') and
 (select count(*) from public.pedido_escalas e where e.pedido_id=o.id and e.data=(shift_row->>'data')::date and e.status not in ('falta','desistiu') and e.diarista_id<>w.id)>=o.quantidade_diaristas) then raise exception 'A escala completa não está mais disponível. Fale com a Direct.';end if;
 for t in select value from jsonb_array_elements(o.turnos) where ((value->>'data')::date+(value->>'inicio')::time)>(now() at time zone 'America/Fortaleza') order by value->>'data' loop
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
create or replace function public.direct_portal_submit(p_dados jsonb,p_convite text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;w public.diaristas%rowtype;
 n text:=btrim(p_dados->>'nome');c text:=regexp_replace(coalesce(p_dados->>'cpf',''),'\D','','g');birth date;work boolean;travel boolean;phone text:=regexp_replace(coalesce(p_dados->>'telefone',''),'\D','','g');
begin
 if phone<>'' and phone !~ '^[0-9]{10,13}$' then raise exception 'Confira o telefone com DDD (10 a 13 números).';end if;
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
  insert into public.diaristas(nome,cpf,telefone,data_nascimento,setores,cep,logradouro,numero,complemento,bairro,cidade,uf,trabalhando,rede_trabalho,local_trabalho,disponibilidade,pode_se_deslocar,transporte,observacoes_locomocao)
  values(n,c,phone,birth,p_dados->'setores',p_dados->>'cep',btrim(p_dados->>'logradouro'),btrim(p_dados->>'numero'),coalesce(p_dados->>'complemento',''),btrim(p_dados->>'bairro'),btrim(p_dados->>'cidade'),p_dados->>'uf',work,case when work then p_dados->>'rede_trabalho' else '' end,case when work then btrim(p_dados->>'local_trabalho') else '' end,p_dados->'disponibilidade',travel,p_dados->>'transporte',coalesce(p_dados->>'observacoes_locomocao','')) returning * into w;
  insert into direct_private.portal_registros(diarista_id,convite_id) values(w.id,i.id);
 end if;
 update direct_private.portal_convites set diarista_id=w.id,cpf=c where id=i.id;
 return public.direct_portal_context(p_convite,'cadastro');
end $$;


-- Link de consulta compartilhado: não permite cadastro, leitura de pessoas ou confirmação.
create table direct_private.portal_vagas_link (
 id boolean primary key default true check(id),
 token text not null default encode(extensions.gen_random_bytes(32),'hex'),
 criado_em timestamptz not null default now()
);
alter table direct_private.portal_vagas_link enable row level security;
revoke all on direct_private.portal_vagas_link from public,anon,authenticated;
create function public.direct_portal_board_link() returns jsonb language plpgsql security definer set search_path='' as $$
declare t text;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para gerar link de vagas.';end if;
 insert into direct_private.portal_vagas_link(id) values(true) on conflict do nothing;
 select token into t from direct_private.portal_vagas_link where id;
 return jsonb_build_object('token',t);
end $$;
create function direct_private.portal_board_check(p_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or not exists(select 1 from direct_private.portal_vagas_link where token=p_token) then raise exception 'Use o link de vagas compartilhado pela Direct.';end if;
end $$;
create function public.direct_portal_board_orders(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform direct_private.portal_board_check(p_token);
 return public.direct_portal_orders_internal();
end $$;
create function public.direct_portal_board_context(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform direct_private.portal_board_check(p_token);
 return jsonb_build_object('whatsapp',(select whatsapp from direct_private.portal_config));
end $$;
revoke all on function public.direct_portal_board_link(),public.direct_portal_board_orders(text),public.direct_portal_board_context(text),direct_private.portal_board_check(text) from public,anon,authenticated;
grant execute on function public.direct_portal_board_link() to authenticated;
grant execute on function public.direct_portal_board_orders(text),public.direct_portal_board_context(text) to anon,authenticated;
notify pgrst,'reload schema';
