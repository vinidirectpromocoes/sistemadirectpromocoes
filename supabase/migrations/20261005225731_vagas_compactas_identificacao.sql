-- O link compartilhado autoriza somente consulta e confirmação de escala.
-- Nome + CPF nunca retornam ficha, CPF, telefone ou identificador da pessoa.
create table direct_private.portal_identity_limits (
 chave bytea primary key,
 janela timestamptz not null,
 tentativas integer not null check(tentativas>0)
);
alter table direct_private.portal_identity_limits enable row level security;
revoke all on direct_private.portal_identity_limits from public,anon,authenticated;

create function direct_private.portal_identity_rate(p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 v_janela timestamptz:=date_trunc('minute',clock_timestamp());k bytea;hits integer;ip text;scope text;
begin
 ip:=coalesce(nullif(split_part(headers->>'x-forwarded-for',',',1),''),'sem-ip');
 delete from direct_private.portal_identity_limits where portal_identity_limits.janela<v_janela-interval '1 day';
 foreach scope in array array['link','ip:'||left(ip,200)] loop
  k:=extensions.digest(p_token||':'||scope,'sha256');
  insert into direct_private.portal_identity_limits as l(chave,janela,tentativas) values(k,v_janela,1)
  on conflict(chave) do update set janela=excluded.janela,
   tentativas=case when l.janela=excluded.janela then l.tentativas+1 else 1 end
  returning tentativas into hits;
  if hits>(case when scope='link' then 600 else 60 end) then
   raise exception 'Muitas conferências seguidas. Aguarde um minuto e tente novamente.';
  end if;
 end loop;
end $$;

create function direct_private.portal_identity(p_token text,p_tipo text,p_nome text,p_cpf text) returns bigint
language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;w public.diaristas%rowtype;
 c text:=regexp_replace(coalesce(p_cpf,''),'[^0-9]','','g');n text;
begin
 if p_tipo='painel' then perform direct_private.portal_board_check(p_token);
 elsif p_tipo='vagas' then i:=direct_private.portal_invite(p_token,'vagas');
 else raise exception 'Use o link de vagas enviado pela Direct.';end if;
 perform direct_private.portal_identity_rate(p_token);
 if length(coalesce(p_nome,''))>180 or length(coalesce(p_cpf,''))>18 or not public.direct_valid_cpf(c) then return null;end if;
 n:=translate(lower(regexp_replace(btrim(coalesce(p_nome,'')),'\s+',' ','g')),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc');
 if length(n)<5 or position(' ' in n)=0 then return null;end if;
 select * into w from public.diaristas where cpf=c and
 translate(lower(regexp_replace(btrim(nome),'\s+',' ','g')),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')=n;
 if w.id is null or (p_tipo='vagas' and i.diarista_id is distinct from w.id) then return null;end if;
 if w.bloqueada then raise exception 'Cadastro indisponível para pegar diárias. Fale com a Direct.';end if;
 return w.id;
end $$;

create function public.direct_portal_check_worker(p_token text,p_tipo text,p_nome text,p_cpf text,p_pedido_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare wid bigint;w public.diaristas%rowtype;o public.pedidos%rowtype;
begin
 wid:=direct_private.portal_identity(p_token,p_tipo,p_nome,p_cpf);
 if wid is null then return jsonb_build_object('autorizado',false,'mensagem','Você ainda não está cadastrado na nossa base de diaristas. Por favor, realize seu cadastro para ficar apto a pegar diárias conosco. Confira também se o nome completo e o CPF estão corretos.');end if;
 select * into w from public.diaristas where id=wid;
 select * into o from public.pedidos where id=p_pedido_id;
 if o.id is null or not exists(select 1 from jsonb_array_elements(public.direct_portal_orders_internal()) item where (item->>'id')::bigint=o.id) then
  return jsonb_build_object('autorizado',false,'mensagem','Esta escala não está mais disponível. Escolha uma vaga atual.');end if;
 if direct_private.portal_same_employer(w,o.supermercado) then
  return jsonb_build_object('autorizado',false,'mensagem','Funcionário de supermercado não pode fazer diária na mesma empresa em que trabalha.');end if;
 return jsonb_build_object('autorizado',true,'mensagem','Autorizado a pegar esta vaga');
exception when raise_exception then return jsonb_build_object('autorizado',false,'mensagem',sqlerrm);
end $$;

create function public.direct_portal_claim_order(p_token text,p_tipo text,p_nome text,p_cpf text,p_pedido_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare wid bigint;w public.diaristas%rowtype;o public.pedidos%rowtype;t jsonb;eid bigint;added integer:=0;
begin
 wid:=direct_private.portal_identity(p_token,p_tipo,p_nome,p_cpf);
 if wid is null then return jsonb_build_object('confirmado',false,'mensagem','Você ainda não está cadastrado na nossa base de diaristas. Por favor, realize seu cadastro para ficar apto a pegar diárias conosco. Confira também se o nome completo e o CPF estão corretos.');end if;
 -- O bloqueio no pedido serializa confirmações simultâneas: ninguém ocupa a última vaga duas vezes.
 select * into o from public.pedidos where id=p_pedido_id for update;
 select * into w from public.diaristas where id=wid for update;
 if w.id is null or w.bloqueada then raise exception 'Cadastro indisponível para pegar diárias. Fale com a Direct.';end if;
 if o.id is null or o.situacao in ('cancelado','concluido') then raise exception 'Pedido indisponível. Escolha outra vaga.';end if;
 if direct_private.portal_same_employer(w,o.supermercado) then raise exception 'Funcionário de supermercado não pode fazer diária na mesma empresa em que trabalha.';end if;
 if not exists(select 1 from jsonb_array_elements(o.turnos) s where ((s->>'data')::date+(s->>'inicio')::time)>(now() at time zone 'America/Fortaleza')) then raise exception 'Esta escala já terminou.';end if;
 if exists(select 1 from jsonb_array_elements(o.turnos) s where ((s->>'data')::date+(s->>'inicio')::time)>(now() at time zone 'America/Fortaleza') and
  (select count(*) from public.pedido_escalas e where e.pedido_id=o.id and e.data=(s->>'data')::date and e.status not in ('falta','desistiu') and e.diarista_id<>wid)>=o.quantidade_diaristas) then raise exception 'A escala completa não está mais disponível. Escolha outra vaga.';end if;
 for t in select value from jsonb_array_elements(o.turnos) where ((value->>'data')::date+(value->>'inicio')::time)>(now() at time zone 'America/Fortaleza') order by value->>'data' loop
  select id into eid from public.pedido_escalas where pedido_id=o.id and diarista_id=wid and data=(t->>'data')::date;
  if eid is not null then
   if not exists(select 1 from public.pedido_escalas where id=eid and status in ('escalada','presente')) then raise exception 'Há um registro anterior de falta ou desistência. Fale com a Direct.';end if;
  else
   insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o.id,wid,(t->>'data')::date,true) returning id into eid;
   added:=added+1;
  end if;
  update public.pedido_escalas set confirmacao='confirmou' where id=eid and status='escalada';
 end loop;
 return jsonb_build_object('confirmado',true,'dias',added,'mensagem','Escala confirmada! Você está escalado em todos os dias. A presença será registrada pela Direct no dia da diária.');
end $$;
revoke all on function direct_private.portal_identity_rate(text),direct_private.portal_identity(text,text,text,text),
 public.direct_portal_check_worker(text,text,text,text,bigint),public.direct_portal_claim_order(text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.direct_portal_check_worker(text,text,text,text,bigint),public.direct_portal_claim_order(text,text,text,text,bigint) to anon,authenticated;
notify pgrst,'reload schema';
