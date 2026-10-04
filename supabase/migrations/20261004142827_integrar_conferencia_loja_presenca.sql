create or replace function public.direct_store_review_check(p_id bigint,p_aceitar boolean,p_motivo text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.loja_validacoes; e public.pedido_escalas;
begin
 if auth.uid() is null or coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para revisar.' using errcode='42501';end if;
 select * into v from public.loja_validacoes where id=p_id for update;if v.id is null or v.estado<>'pendente' then raise exception 'Conferência já revisada ou inexistente.';end if;
 if p_aceitar is null then raise exception 'Escolha aplicar ou recusar.';end if;
 if not p_aceitar then
  if length(trim(coalesce(p_motivo,''))) not between 8 and 500 then raise exception 'Explique a recusa (8 a 500 caracteres).';end if;
  update public.loja_validacoes set estado='recusada',motivo=trim(p_motivo),atualizado_em=now() where id=v.id;return jsonb_build_object('ok',true);
 end if;
 select * into e from public.pedido_escalas where id=v.escala_id for update;
 if e.status='desistiu' or not exists(select 1 from public.pedidos p join public.lojas s on lower(s.rede)=lower(p.supermercado) and lower(s.nome)=lower(p.unidade) where p.id=e.pedido_id and s.id=v.loja_id and p.situacao<>'cancelado') then raise exception 'Pedido/escala mudou. Revise a conferência.';end if;
 update public.pedido_escalas set status=v.presenca,
 falta_motivo=case when v.presenca='falta' and e.status<>'falta' then left(case when length(trim(v.observacao))>=5 then v.observacao else 'Falta informada pela loja no link privado' end,300) else e.falta_motivo end,
 atualizado_em=now() where id=e.id;
 if v.presenca='presente' then update public.pedido_escalas set loja_validacao='validado',loja_responsavel='Conferência por link da loja',loja_observacao=v.observacao where id=e.id;end if;
 update public.loja_validacoes set estado='aplicada',atualizado_em=now() where id=v.id;
 return jsonb_build_object('ok',true,'pedido_id',e.pedido_id);
end;$$;
