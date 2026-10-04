-- Catálogo único: Leitura IA e cadastro manual gravam em pedidos; vagas consultam essa base.
create or replace function public.direct_portal_orders_internal() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(o.item order by o.first_date,o.id),'[]'::jsonb) from (
 select p.id,min(t->>'data') first_date,jsonb_build_object('id',p.id,'rede',p.supermercado,'loja',p.unidade,'setor',p.setor,
 'endereco',(select l.endereco || case when l.bairro<>'' and position(lower(l.bairro) in lower(l.endereco))=0 then ' · '||l.bairro else '' end || case when position(lower(l.cidade) in lower(l.endereco))=0 then ' · '||l.cidade||'/'||l.uf else '' end from public.lojas l where lower(l.rede)=lower(p.supermercado) and lower(l.nome)=lower(p.unidade) limit 1),
 'valor_centavos',case when count(distinct coalesce(direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date),-1))=1 then min(direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date)) else null end,
 'turnos',jsonb_agg(jsonb_build_object('data',t->>'data','inicio',t->>'inicio','fim',t->>'fim','valor_centavos',direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date),'vagas',p.quantidade_diaristas-(select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))) order by t->>'data')) item
 from public.pedidos p cross join lateral jsonb_array_elements(p.turnos) t
 where p.situacao not in ('cancelado','concluido')
 and not exists(select 1 from jsonb_array_elements(p.turnos) s
 where ((s->>'data')::date+(s->>'inicio')::time)<=(now() at time zone 'America/Fortaleza')
 or (select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(s->>'data')::date and e.status not in ('falta','desistiu'))>=p.quantidade_diaristas)
 group by p.id
 ) o;
$$;
revoke all on function public.direct_portal_orders_internal() from public,anon,authenticated;

create function public.direct_portal_vacancies() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para acompanhar as vagas.';end if;
 return public.direct_portal_orders_internal();
end $$;
create function public.direct_portal_vacancies_invite(p_diarista_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c text;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para gerar links.';end if;
 select cpf into c from public.diaristas where id=p_diarista_id and not bloqueada for update;
 if c is null then raise exception 'Escolha um diarista cadastrado e não bloqueado.';end if;
 return public.direct_portal_create_invite(c,30);
end $$;
revoke all on function public.direct_portal_vacancies(),public.direct_portal_vacancies_invite(bigint) from public,anon,authenticated;
grant execute on function public.direct_portal_vacancies(),public.direct_portal_vacancies_invite(bigint) to authenticated;
notify pgrst,'reload schema';
