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
 if exists(select 1 from jsonb_array_elements(o.turnos) shift_row where ((shift_row->>'data')::date+(shift_row->>'inicio')::time)<=(now() at time zone 'America/Fortaleza') or
 (select count(*) from public.pedido_escalas e where e.pedido_id=o.id and e.data=(shift_row->>'data')::date and e.status not in ('falta','desistiu') and e.diarista_id<>w.id)>=o.quantidade_diaristas) then raise exception 'A escala completa não está mais disponível. Fale com a Direct.';end if;
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
