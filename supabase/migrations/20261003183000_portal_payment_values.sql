create or replace function direct_private.portal_daily_value(p_rede text,p_loja text,p_setor text,p_data date) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(
 (select c.valor_pago_centavos from public.contratos c where lower(c.rede)=lower(p_rede) and (c.loja='' or lower(c.loja)=lower(p_loja)) and (c.setor='' or lower(c.setor)=lower(p_setor)) and c.inicio<=p_data and (c.fim is null or c.fim>=p_data) order by (case when c.loja<>'' then 2 else 0 end+case when c.setor<>'' then 1 else 0 end) desc,c.inicio desc,c.id desc limit 1),
 (select s.valor_pago_centavos from public.tarifas_setores s where lower(s.setor)=lower(p_setor) and (lower(s.rede)=lower(p_rede) or s.rede is null) and s.valor_pago_centavos is not null order by case when lower(s.rede)=lower(p_rede) then 0 else 1 end limit 1),
 (select tr.valor_padrao_centavos from public.tarifas_redes tr where lower(tr.rede)=lower(p_rede)));
$$;
revoke all on function direct_private.portal_daily_value(text,text,text,date) from public,anon,authenticated;

create or replace function public.direct_portal_orders() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(o.item order by o.first_date,o.id),'[]'::jsonb) from (
 select p.id,min(t->>'data') first_date,jsonb_build_object('id',p.id,'rede',p.supermercado,'loja',p.unidade,'setor',p.setor,
 'endereco',(select l.endereco || case when l.bairro<>'' and position(lower(l.bairro) in lower(l.endereco))=0 then ' · '||l.bairro else '' end || case when position(lower(l.cidade) in lower(l.endereco))=0 then ' · '||l.cidade||'/'||l.uf else '' end from public.lojas l where lower(l.rede)=lower(p.supermercado) and lower(l.nome)=lower(p.unidade) limit 1),
 'valor_centavos',case when count(distinct coalesce(direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date),-1))=1 then min(direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date)) else null end,
 'turnos',jsonb_agg(jsonb_build_object('data',t->>'data','inicio',t->>'inicio','fim',t->>'fim','valor_centavos',direct_private.portal_daily_value(p.supermercado,p.unidade,p.setor,(t->>'data')::date),'vagas',p.quantidade_diaristas-(select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))) order by t->>'data')) item
 from public.pedidos p cross join lateral jsonb_array_elements(p.turnos) t
 where p.situacao not in ('cancelado','concluido')
 and ((t->>'data')::date+(t->>'inicio')::time)>(now() at time zone 'America/Fortaleza')
 and (select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))<p.quantidade_diaristas
 group by p.id order by min(t->>'data'),p.id limit 200
 ) o;
$$;
