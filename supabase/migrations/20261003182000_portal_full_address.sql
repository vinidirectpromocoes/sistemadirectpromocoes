create or replace function public.direct_portal_orders() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(o.item order by o.first_date,o.id),'[]'::jsonb) from (
 select p.id,min(t->>'data') first_date,jsonb_build_object('id',p.id,'rede',p.supermercado,'loja',p.unidade,'setor',p.setor,
 'endereco',(select l.endereco || case when l.bairro<>'' and position(lower(l.bairro) in lower(l.endereco))=0 then ' · '||l.bairro else '' end || case when position(lower(l.cidade) in lower(l.endereco))=0 then ' · '||l.cidade||'/'||l.uf else '' end from public.lojas l where lower(l.rede)=lower(p.supermercado) and lower(l.nome)=lower(p.unidade) limit 1),
 'valor_centavos',coalesce((select ts.valor_pago_centavos from public.tarifas_setores ts where lower(ts.rede)=lower(p.supermercado) and lower(ts.setor)=lower(p.setor)),
 (select ts.valor_pago_centavos from public.tarifas_setores ts where ts.rede='' and lower(ts.setor)=lower(p.setor)),
 (select tr.valor_padrao_centavos from public.tarifas_redes tr where lower(tr.rede)=lower(p.supermercado))),
 'turnos',jsonb_agg(jsonb_build_object('data',t->>'data','inicio',t->>'inicio','fim',t->>'fim','vagas',p.quantidade_diaristas-(select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))) order by t->>'data')) item
 from public.pedidos p cross join lateral jsonb_array_elements(p.turnos) t
 where p.situacao not in ('cancelado','concluido')
 and ((t->>'data')::date+(t->>'inicio')::time)>(now() at time zone 'America/Fortaleza')
 and (select count(*) from public.pedido_escalas e where e.pedido_id=p.id and e.data=(t->>'data')::date and e.status not in ('falta','desistiu'))<p.quantidade_diaristas
 group by p.id order by min(t->>'data'),p.id limit 200
 ) o;
$$;
