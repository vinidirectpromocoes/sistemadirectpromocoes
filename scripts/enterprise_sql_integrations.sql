-- Dynamic networks preserve all validation and names already bound to private links.
alter table public.lojas drop constraint direct_lojas_valid_fields;
alter table public.lojas add constraint direct_lojas_valid_fields check (
 length(btrim(rede)) between 1 and 180 and length(btrim(nome)) between 1 and 120
 and length(btrim(endereco)) between 1 and 250 and length(bairro)<=100
 and length(btrim(cidade)) between 1 and 80 and uf='CE' and length(observacao)<=400
 and length(fonte_url)<=500 and (fonte_url='' or fonte_url ~ '^https://[^[:space:]]+$'));
create function direct_private.empresa_network_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='lojas' then
  if tg_op='UPDATE' and new.rede=old.rede then return new;end if;
  if new.rede not in ('Super do Povo','Super Lagoa','Fazendinha','Hipermarket','Pinheiro','Variedades') and not exists(select 1 from public.empresa_registros where tipo='rede' and status='ativo' and titulo=new.rede) and not exists(select 1 from public.lojas where rede=new.rede) then raise exception 'Cadastre primeiro a rede na área Empresa.';end if;
 else
  if tg_op='UPDATE' and old.tipo='rede' and new.titulo<>old.titulo and exists(select 1 from public.lojas where rede=old.titulo) then raise exception 'Preserve o nome da rede vinculada às lojas e links existentes.';end if;
 end if;return new;end;$$;
create trigger empresa_network_guard before insert or update on public.lojas for each row execute function direct_private.empresa_network_guard();
create trigger empresa_network_catalog before insert or update on public.empresa_registros for each row execute function direct_private.empresa_network_guard();
create function public.direct_empresa_diarias_pendentes(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin confere pagamentos.' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select d.id,d.data,d.local,d.setor,d.valor_centavos,d.diarista_id,w.nome from public.diarias d join public.diaristas w on w.id=d.diarista_id where d.data_pagamento is null and d.pagamento_lote_id is null and d.valor_centavos>0 and (nullif(p->>'diarista_id','') is null or d.diarista_id=(p->>'diarista_id')::bigint) order by d.data,d.id limit 500)x);end;$$;
create function public.direct_empresa_registrar_pagamento(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();r public.empresa_registros;snapshot jsonb;ids bigint[];bid bigint;day date;method text:=trim(coalesce(p->>'forma',''));begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin registra pagamentos.' using errcode='42501';end if;
 r:=direct_private.empresa_get((p->>'id')::bigint,'pagamento_revisao');select * into r from public.empresa_registros where id=r.id for update;
 if r.status='registrado' then return jsonb_build_object('lote_id',r.dados->'lote_id','repetido',true);end if;
 if r.status<>'aprovado' or r.versao<>coalesce((p->>'versao')::bigint,0) then raise exception 'Escolha uma conferência aprovada e atualizada.';end if;
 if coalesce(p->>'data_pagamento','') !~ '^\d{4}-\d{2}-\d{2}$' or length(method) not between 1 and 80 then raise exception 'Confira a data e a forma de pagamento.';end if;day:=(p->>'data_pagamento')::date;
 select array_agg(value::text::bigint) into ids from jsonb_array_elements(r.dados->'diaria_ids');perform 1 from public.diarias where id=any(ids) for update;
 select jsonb_agg(jsonb_build_object('id',id,'diarista_id',diarista_id,'valor_centavos',valor_centavos,'data_pagamento',data_pagamento) order by id) into snapshot from public.diarias where id=any(ids);
 if snapshot is distinct from r.dados->'diarias_snapshot' then raise exception 'As diárias mudaram; prepare uma nova conferência.';end if;
 bid:=direct_private.direct_pay_daily_batch(r.diarista_id,ids,day,method);
 update public.empresa_registros set status='registrado',dados=dados||jsonb_build_object('lote_id',bid,'data_registro',day,'forma_registro',method),versao=versao+1,atualizado_em=clock_timestamp() where id=r.id;
 return jsonb_build_object('lote_id',bid,'valor_centavos',r.dados->'valor_conferido_centavos');end;$$;
revoke all on function direct_private.empresa_network_guard(),public.direct_empresa_diarias_pendentes(jsonb),public.direct_empresa_registrar_pagamento(jsonb) from public,anon,authenticated;
grant execute on function public.direct_empresa_diarias_pendentes(jsonb),public.direct_empresa_registrar_pagamento(jsonb) to authenticated;

create function public.direct_empresa_configurar_rede(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();r public.empresa_registros;income bigint;cost bigint;begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin configura valores.' using errcode='42501';end if;r:=direct_private.empresa_get((p->>'rede_id')::bigint,'rede');
 if jsonb_typeof(p->'valor_recebido_centavos')<>'number' or jsonb_typeof(p->'valor_padrao_centavos')<>'number' or p->>'valor_recebido_centavos' !~ '^[0-9]+$' or p->>'valor_padrao_centavos' !~ '^[0-9]+$' then raise exception 'Informe valores em centavos.';end if;
 income:=(p->>'valor_recebido_centavos')::bigint;cost:=(p->>'valor_padrao_centavos')::bigint;if income not between 1 and 1000000000 or cost not between 1 and 1000000000 then raise exception 'Informe valores válidos maiores que zero.';end if;
 insert into public.tarifas_redes(rede,valor_recebido_centavos,valor_padrao_centavos) values(r.titulo,income,cost) on conflict(rede) do update set valor_recebido_centavos=excluded.valor_recebido_centavos,valor_padrao_centavos=excluded.valor_padrao_centavos,atualizado_em=clock_timestamp();return jsonb_build_object('ok',true);end;$$;
revoke all on function public.direct_empresa_configurar_rede(jsonb) from public,anon,authenticated;grant execute on function public.direct_empresa_configurar_rede(jsonb) to authenticated;
create function public.direct_empresa_candidatos_extrato(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();line public.empresa_extrato;begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin confere extratos.' using errcode='42501';end if;
 select * into line from public.empresa_extrato where id=(p->>'id')::bigint;if line.id is null then raise exception 'Linha não encontrada.';end if;
 return jsonb_build_object('lancamento',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select f.id,f.descricao titulo from public.financeiro_lancamentos f where f.valor_centavos=abs(line.valor_centavos) and (f.tipo='receita')=(line.valor_centavos>0) and (f.data_pagamento is null or f.data_pagamento=line.data) and not exists(select 1 from public.empresa_extrato e where e.destino_tipo='lancamento' and e.destino_id=f.id and e.estado='conciliado') order by f.id limit 100)x),
 'cobranca',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select c.id,c.rede||' · '||c.periodo_inicio||' a '||c.periodo_fim titulo from public.cobrancas c where line.valor_centavos>0 and c.status='aberta' and c.valor_centavos-coalesce((select sum(r.valor_centavos) from public.cobranca_recebimentos r where r.cobranca_id=c.id and not r.estornado),0)>=line.valor_centavos order by c.vencimento limit 100)x),
 'lote_pagamento',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select b.id,w.nome||' · '||b.quantidade||' diária(s)' titulo from public.pagamento_lotes b join public.diaristas w on w.id=b.diarista_id where line.valor_centavos<0 and b.status='pago' and b.valor_centavos=-line.valor_centavos and b.data_pagamento=line.data and not exists(select 1 from public.empresa_extrato e where e.destino_tipo='lote_pagamento' and e.destino_id=b.id and e.estado='conciliado') order by b.id limit 100)x));end;$$;
revoke all on function public.direct_empresa_candidatos_extrato(jsonb) from public,anon,authenticated;grant execute on function public.direct_empresa_candidatos_extrato(jsonb) to authenticated;
create or replace function public.direct_empresa_alertas(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();today date:=coalesce(nullif(p->>'data','')::date,(now() at time zone 'America/Fortaleza')::date);result jsonb;begin
 with records as(select r.*,case r.tipo when 'tarefa' then (r.dados->>'prazo')::timestamptz::date when 'contato' then (r.dados->>'retorno')::date else (r.dados->>'validade')::date end deadline,case r.tipo when 'tarefa' then 'tarefa_vencida' when 'qualificacao' then 'qualificacao_vencida' when 'lote' then 'lote_vencido' end rulekind from public.empresa_registros r where r.tipo in ('tarefa','qualificacao','lote','contato') and r.status not in ('concluida','cancelada','revogada','arquivado') and direct_private.empresa_visible(r)),alerts as(
 select r.id,r.tipo,r.titulo,case when r.deadline<today then 'Prazo vencido' else 'Prazo próximo ou vence hoje' end||coalesce((select ' · '||string_agg(q.dados->>'acao',' · ') from public.empresa_registros q where q.tipo='regra' and q.status='ativo' and q.dados->>'tipo'=r.rulekind),'') motivo,concat_ws(', ',coalesce(r.dados->>'supervisor',r.dados->>'responsavel',r.dados->>'conferido_por'),(select string_agg(q.dados->>'responsavel',', ') from public.empresa_registros q where q.tipo='regra' and q.status='ativo' and q.dados->>'tipo'=r.rulekind)) responsavel from records r where deadline<=today+greatest(coalesce((r.dados->>'antecedencia_dias')::int,0),coalesce((select max((q.dados->>'antecedencia_dias')::int) from public.empresa_registros q where q.tipo='regra' and q.status='ativo' and q.dados->>'tipo'=r.rulekind),0))
 union all select c.id,'cobranca','Cobrança · '||c.rede,q.dados->>'acao',q.dados->>'responsavel' from public.cobrancas c join public.empresa_registros q on q.tipo='regra' and q.status='ativo' and q.dados->>'tipo'='cobranca_atrasada' where member in ('admin','financeiro') and c.status='aberta' and c.vencimento<=today+(q.dados->>'antecedencia_dias')::int and c.valor_centavos>coalesce((select sum(x.valor_centavos) from public.cobranca_recebimentos x where x.cobranca_id=c.id and not x.estornado),0) and (direct_private.empresa_scope(null) or exists(select 1 from public.cobranca_itens i join public.empresa_registros v on v.pedido_id=i.pedido_id and v.tipo='vinculo' where i.cobranca_id=c.id and direct_private.empresa_visible(v)))) select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from(select * from alerts order by titulo limit 100)x;return result;end;$$;
revoke all on function public.direct_empresa_alertas(jsonb) from public,anon,authenticated;grant execute on function public.direct_empresa_alertas(jsonb) to authenticated;
