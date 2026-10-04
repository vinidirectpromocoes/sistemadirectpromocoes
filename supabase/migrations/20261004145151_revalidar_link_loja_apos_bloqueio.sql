create or replace function public.direct_store_submit(p_token text,p_dados jsonb,p_chave uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.lojas; data jsonb; r public.loja_solicitacoes;
begin
 s:=direct_private.store_token(p_token);perform 1 from direct_private.loja_links where loja_id=s.id for update;
 -- Recheck after acquiring the row lock: renewal/revocation may have won the race.
 s:=direct_private.store_token(p_token);
 data:=direct_private.store_draft(p_dados,s);
 if p_chave is null then raise exception 'Chave da solicitação ausente.';end if;
 select * into r from public.loja_solicitacoes where loja_id=s.id and chave=p_chave;
 if r.id is not null then if r.dados<>data then raise exception 'Esta solicitação já foi enviada com outros dados.';end if;return jsonb_build_object('id',r.id,'estado',r.estado);end if;
 if exists(select 1 from jsonb_array_elements(data->'turnos') x(value) where (x.value->>'data')::date<(now() at time zone 'America/Fortaleza')::date or (x.value->>'data')::date>(now() at time zone 'America/Fortaleza')::date+366) then raise exception 'Envie datas de hoje até um ano à frente.';end if;
 if (select count(*) from public.loja_solicitacoes where loja_id=s.id and criado_em>now()-interval '1 day')>=60 then raise exception 'Limite de solicitações atingido. Fale com a Direct.';end if;
 insert into public.loja_solicitacoes(loja_id,chave,dados) values(s.id,p_chave,data) returning * into r;
 return jsonb_build_object('id',r.id,'estado',r.estado);
end;$$;

create or replace function public.direct_store_check(p_token text,p_escala_id bigint,p_presenca text,p_observacao text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.lojas; e public.pedido_escalas; v public.loja_validacoes;
begin
 s:=direct_private.store_token(p_token);perform 1 from direct_private.loja_links where loja_id=s.id for update;
 -- Recheck after acquiring the row lock: renewal/revocation may have won the race.
 s:=direct_private.store_token(p_token);
 select esc.* into e from public.pedido_escalas esc join public.pedidos p on p.id=esc.pedido_id where esc.id=p_escala_id and lower(p.supermercado)=lower(s.rede) and lower(p.unidade)=lower(s.nome) and p.situacao<>'cancelado' for update of esc;
 if e.id is null or e.status='desistiu' then raise exception 'Atendimento não disponível nesta loja.';end if;
 if e.data>(now() at time zone 'America/Fortaleza')::date then raise exception 'Confira o atendimento após o dia da diária.';end if;
 if p_presenca not in ('presente','falta') or p_presenca is null or length(coalesce(p_observacao,''))>500 then raise exception 'Conferência inválida.';end if;
 select * into v from public.loja_validacoes where escala_id=e.id for update;
 if v.estado='aplicada' then raise exception 'Conferência já aplicada. Fale com a Direct para corrigir.';end if;
 insert into public.loja_validacoes(loja_id,escala_id,presenca,observacao) values(s.id,e.id,p_presenca,coalesce(p_observacao,'')) on conflict(escala_id) do update set presenca=excluded.presenca,observacao=excluded.observacao,estado='pendente',motivo='',atualizado_em=now() returning * into v;
 return jsonb_build_object('id',v.id,'estado',v.estado);
end;$$;
