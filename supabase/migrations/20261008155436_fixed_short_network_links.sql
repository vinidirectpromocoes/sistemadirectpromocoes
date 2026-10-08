-- Fixed network capabilities: 96 random bits, with compatible legacy URLs.
alter table direct_private.rede_links alter column expira_em drop not null;
alter table direct_private.rede_links alter column expira_em drop default;
alter table direct_private.rede_links add column codigo text not null default translate(encode(extensions.gen_random_bytes(12),'base64'),'+/','-_') unique check(codigo ~ '^[A-Za-z0-9_-]{16}$');
update direct_private.rede_links set expira_em=null;
insert into direct_private.rede_links(rede) select min(rede) from public.lojas group by lower(trim(rede)) on conflict(lower(trim(rede))) do nothing;

create or replace function direct_private.network_token(p_token text) returns text language plpgsql security invoker set search_path='' as $$
declare network text;
begin
 if coalesce(p_token,'') !~ '^([A-Za-z0-9_-]{16}|[a-f0-9]{64})$' then raise exception 'Link inválido. Peça o link da rede à Direct.' using errcode='42501';end if;
 select rede into network from direct_private.rede_links where codigo=p_token or (token=p_token and ativo);
 if network is null then raise exception 'Link inválido. Peça o link da rede à Direct.' using errcode='42501';end if;
 return network;
end;$$;

create or replace function public.direct_network_links() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para links das redes.' using errcode='42501';end if;
 insert into direct_private.rede_links(rede) select min(rede) from public.lojas group by lower(trim(rede)) on conflict(lower(trim(rede))) do nothing;
 return (select coalesce(jsonb_agg(jsonb_build_object('rede',s.rede,'lojas',s.lojas,'codigo',x.codigo,'token',case when x.ativo then x.token else null end,'ativo',true,'expira_em',null) order by s.rede),'[]'::jsonb) from (select min(rede) rede,count(*) lojas from public.lojas group by lower(trim(rede))) s join direct_private.rede_links x on lower(trim(x.rede))=lower(trim(s.rede)));
end;$$;

create or replace function public.direct_network_link(p_rede text,p_acao text default 'consultar') returns jsonb language plpgsql security definer set search_path='' as $$
declare link direct_private.rede_links; network text;
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para links das redes.' using errcode='42501';end if;
 if p_acao is distinct from 'consultar' then raise exception 'O link da rede é fixo e não precisa de renovação.';end if;
 select min(rede) into network from public.lojas where lower(trim(rede))=lower(trim(p_rede));
 if network is null then raise exception 'Rede sem lojas cadastradas.';end if;
 insert into direct_private.rede_links(rede) values(network) on conflict(lower(trim(rede))) do nothing;
 select * into link from direct_private.rede_links where lower(trim(rede))=lower(trim(network));
 return jsonb_build_object('rede',network,'codigo',link.codigo,'token',case when link.ativo then link.token else null end,'ativo',true,'expira_em',null);
end;$$;

create or replace function public.direct_network_submit(p_token text,p_loja_id bigint,p_dados jsonb,p_chave uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.lojas; data jsonb; r public.loja_solicitacoes;
begin
 perform direct_private.network_token(p_token);
 perform 1 from direct_private.rede_links where token=p_token or codigo=p_token for update;
 s:=direct_private.network_store(p_token,p_loja_id);
 -- Serialize with other requests to the same store, including its older portal.
 perform 1 from public.lojas where id=s.id for update;
 s:=direct_private.network_store(p_token,p_loja_id);
 data:=direct_private.store_draft(p_dados,s);
 if p_chave is null then raise exception 'Chave da solicitação ausente.';end if;
 select * into r from public.loja_solicitacoes where loja_id=s.id and chave=p_chave;
 if r.id is not null then if r.dados<>data then raise exception 'Esta solicitação já foi enviada com outros dados.';end if;return jsonb_build_object('id',r.id,'estado',r.estado);end if;
 if exists(select 1 from jsonb_array_elements(data->'turnos') x(value) where (x.value->>'data')::date<(now() at time zone 'America/Fortaleza')::date or (x.value->>'data')::date>(now() at time zone 'America/Fortaleza')::date+366) then raise exception 'Envie datas de hoje até um ano à frente.';end if;
 if (select count(*) from public.loja_solicitacoes where loja_id=s.id and criado_em>now()-interval '1 day')>=60 then raise exception 'Limite de solicitações atingido. Fale com a Direct.';end if;
 insert into public.loja_solicitacoes(loja_id,chave,dados) values(s.id,p_chave,data) returning * into r;
 return jsonb_build_object('id',r.id,'estado',r.estado);
end;$$;

create or replace function public.direct_network_check(p_token text,p_loja_id bigint,p_escala_id bigint,p_presenca text,p_observacao text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.lojas; e public.pedido_escalas; v public.loja_validacoes;
begin
 perform direct_private.network_token(p_token);perform 1 from direct_private.rede_links where token=p_token or codigo=p_token for update;
 -- Recheck after acquiring the row lock: renewal/revocation may have won the race.
 s:=direct_private.network_store(p_token,p_loja_id);
 select esc.* into e from public.pedido_escalas esc join public.pedidos p on p.id=esc.pedido_id where esc.id=p_escala_id and lower(p.supermercado)=lower(s.rede) and lower(p.unidade)=lower(s.nome) and p.situacao<>'cancelado' for update of esc;
 if e.id is null or e.status='desistiu' then raise exception 'Atendimento não disponível nesta loja.';end if;
 if e.data>(now() at time zone 'America/Fortaleza')::date then raise exception 'Confira o atendimento após o dia da diária.';end if;
 if p_presenca not in ('presente','falta') or p_presenca is null or length(coalesce(p_observacao,''))>500 then raise exception 'Conferência inválida.';end if;
 select * into v from public.loja_validacoes where escala_id=e.id for update;
 if v.estado='aplicada' then raise exception 'Conferência já aplicada. Fale com a Direct para corrigir.';end if;
 insert into public.loja_validacoes(loja_id,escala_id,presenca,observacao) values(s.id,e.id,p_presenca,coalesce(p_observacao,'')) on conflict(escala_id) do update set presenca=excluded.presenca,observacao=excluded.observacao,estado='pendente',motivo='',atualizado_em=now() returning * into v;
 return jsonb_build_object('id',v.id,'estado',v.estado);
end;$$;
