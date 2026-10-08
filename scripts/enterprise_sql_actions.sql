create function public.direct_empresa_converter_proposta(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();r public.empresa_registros;d jsonb;s public.lojas;oid bigint;shifts jsonb;
begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin converte propostas.' using errcode='42501';end if;
 r:=direct_private.empresa_get((p->>'id')::bigint,'proposta');select * into r from public.empresa_registros where id=r.id for update;d:=r.dados;
 if r.status='convertida' then return jsonb_build_object('pedido_id',(d->>'pedido_convertido_id')::bigint,'repetido',true);end if;
 if r.status<>'aprovada' or r.versao<>coalesce((p->>'versao')::bigint,0) then raise exception 'Atualize e escolha uma proposta aprovada.';end if;
 if (d->>'valor_unitario_centavos')::bigint<=0 or (d->>'custo_unitario_centavos')::bigint<=0 then raise exception 'Confira os valores contratados.';end if;
 select * into s from public.lojas where id=r.loja_id;
 select jsonb_agg(jsonb_build_object('data',(d->>'inicio')::date+i,'inicio',d->>'hora_inicio','fim',d->>'hora_fim') order by i) into shifts from generate_series(0,(d->>'dias')::int-1) i;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos,situacao,observacoes) values(s.rede,s.nome,d->>'setor',(d->>'pessoas')::int,shifts,'novo',left('Proposta #'||r.id||' · '||(d->>'condicoes'),500)) returning id into oid;
 update public.empresa_registros set status='convertida',pedido_id=oid,dados=d||jsonb_build_object('pedido_convertido_id',oid),versao=versao+1,atualizado_em=clock_timestamp() where id=r.id;
 if r.campanha_id is not null then insert into public.empresa_registros(tipo,titulo,status,dados,pedido_id,campanha_id,cliente_id,chave,autor) values('vinculo','Pedido #'||oid,'ativo',jsonb_build_object('pedido_id',oid,'campanha_id',r.campanha_id,'cliente_id',r.cliente_id),oid,r.campanha_id,r.cliente_id,'proposta:vinculo:'||r.id,auth.jwt()->>'email');end if;
 return jsonb_build_object('pedido_id',oid,'proposta_id',r.id);
end;$$;
create function direct_private.empresa_quote_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb;begin
 if new.pedido_escala_id is null then return new;end if;
 select r.dados into d from public.empresa_registros r join public.pedido_escalas s on s.pedido_id=r.pedido_id where r.tipo='proposta' and r.status='convertida' and s.id=new.pedido_escala_id;
 if d is not null then new.valor_centavos:=(d->>'custo_unitario_centavos')::bigint;new.valor_recebido_centavos:=(d->>'valor_unitario_centavos')::bigint;end if;return new;
end;$$;
-- PostgreSQL orders BEFORE triggers by name: run after tariff/contract snapshots.
create trigger zzz_empresa_quote before insert on public.diarias for each row execute function direct_private.empresa_quote_snapshot();

create function direct_private.empresa_finance_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.empresa_registros;begin
 if old.empresa_registro_id is null then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'Preserve a despesa aprovada e seu lançamento.';end if;
 if new.empresa_registro_id is distinct from old.empresa_registro_id or new.tipo<>old.tipo or new.valor_centavos<>old.valor_centavos or new.vencimento<>old.vencimento or new.categoria<>old.categoria or new.contraparte<>old.contraparte or new.descricao<>old.descricao then raise exception 'Os dados da despesa aprovada estão preservados.';end if;
 if exists(select 1 from public.empresa_extrato where destino_tipo='lancamento' and destino_id=old.id and estado='conciliado') and (new.data_pagamento is distinct from old.data_pagamento or new.forma_pagamento<>old.forma_pagamento) then raise exception 'Pagamento já conciliado. Preserve a conferência do extrato.';end if;
 return new;
end;$$;
create trigger empresa_finance_guard before update or delete on public.financeiro_lancamentos for each row execute function direct_private.empresa_finance_guard();
create function direct_private.empresa_finance_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.empresa_registro_id is not null then
 update public.empresa_registros set status=case when new.data_pagamento is null then 'aprovada' else 'paga' end,
 dados=case when new.data_pagamento is null then dados-'data_pagamento'-'forma' else dados||jsonb_build_object('data_pagamento',new.data_pagamento,'forma',new.forma_pagamento) end,
 versao=versao+1,atualizado_em=clock_timestamp() where id=new.empresa_registro_id and (status is distinct from case when new.data_pagamento is null then 'aprovada' else 'paga' end or dados->>'data_pagamento' is distinct from new.data_pagamento::text or coalesce(dados->>'forma','')<>new.forma_pagamento);
 end if;return new;end;$$;
create trigger empresa_finance_sync after insert or update on public.financeiro_lancamentos for each row execute function direct_private.empresa_finance_sync();

create function public.direct_empresa_compartilhar_relatorio(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();r public.empresa_registros;code text;
begin
 if member not in ('admin','operacao') then raise exception 'Seu perfil não pode compartilhar relatórios.' using errcode='42501';end if;
 r:=direct_private.empresa_get((p->>'id')::bigint,'relatorio');if r.status<>'aprovado' or r.versao<>(p->>'versao')::bigint then raise exception 'Escolha um relatório aprovado e atualizado.';end if;
 insert into direct_private.empresa_compartilhamentos(registro_id) values(r.id) on conflict(registro_id) do nothing;
 select codigo into code from direct_private.empresa_compartilhamentos where registro_id=r.id;return jsonb_build_object('codigo',code);
end;$$;
create function public.direct_empresa_relatorio_publico(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.empresa_registros;code text:=p->>'codigo';begin
 if coalesce(code,'') !~ '^[A-Za-z0-9_-]{24}$' then raise exception 'Link de relatório inválido.' using errcode='42501';end if;
 select rec.* into r from direct_private.empresa_compartilhamentos c join public.empresa_registros rec on rec.id=c.registro_id where c.codigo=code and rec.status='aprovado';
 if r.id is null then raise exception 'Relatório não disponível.' using errcode='42501';end if;
 return jsonb_build_object('titulo',r.titulo,'inicio',r.dados->>'inicio','fim',r.dados->>'fim','resumo',r.dados->>'resumo','resultado',r.dados->>'resultado','versao',r.versao,'aprovado_em',r.atualizado_em);
end;$$;

create function public.direct_empresa_extrato(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();account bigint:=(p->>'conta_id')::bigint;page int:=greatest(1,coalesce((p->>'pagina')::int,1));begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin consulta extratos.' using errcode='42501';end if;perform direct_private.empresa_get(account,'conta');
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.empresa_extrato where conta_id=account order by data desc,id desc limit 50 offset (page-1)*50)x),'total',(select count(*) from public.empresa_extrato where conta_id=account),'pagina',page);
end;$$;
create function public.direct_empresa_importar_extrato(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();account public.empresa_registros;r jsonb;line public.empresa_extrato;token text;canonical text;seen jsonb:='{}';occurrence int;amount bigint;day date;description text;identifier text;key text;inserted int:=0;skipped int:=0;
begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin importa extratos.' using errcode='42501';end if;
 account:=direct_private.empresa_get((p->>'conta_id')::bigint,'conta');if account.status<>'ativo' or jsonb_typeof(p->'linhas')<>'array' or jsonb_array_length(p->'linhas') not between 1 and 500 then raise exception 'Escolha uma conta ativa e importe até 500 linhas.';end if;
 perform 1 from public.empresa_registros where id=account.id for update;
 for r in select * from jsonb_array_elements(p->'linhas') loop
  if jsonb_typeof(r)<>'object' or jsonb_typeof(r->'valor_centavos')<>'number' or (r->>'valor_centavos') !~ '^-?[0-9]+$' or (r->>'data') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Linha de extrato inválida.';end if;
  day:=(r->>'data')::date;amount:=(r->>'valor_centavos')::bigint;description:=trim(coalesce(r->>'descricao',''));identifier:=coalesce(r->>'identificador','');
  if amount=0 or abs(amount)>1000000000 or length(description)>500 or length(identifier)>180 then raise exception 'Confira valor e textos do extrato.';end if;
  canonical:=jsonb_build_array(day,amount,description)::text;occurrence:=coalesce((seen->>canonical)::int,0)+1;seen:=seen||jsonb_build_object(canonical,occurrence);token:=case when identifier<>'' then identifier else canonical||'#'||occurrence end;key:=md5(account.id||':'||token);
  select * into line from public.empresa_extrato where chave=key;
  if line.id is not null then if line.data<>day or line.valor_centavos<>amount or line.descricao<>description then raise exception 'Identificador bancário já utilizado com outros dados.';end if;skipped:=skipped+1;
  else insert into public.empresa_extrato(conta_id,chave,data,valor_centavos,descricao,identificador) values(account.id,key,day,amount,description,identifier);inserted:=inserted+1;end if;
 end loop;return jsonb_build_object('importadas',inserted,'repetidas',skipped);
end;$$;
create function public.direct_empresa_conciliar(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();line public.empresa_extrato;target text:=p->>'destino_tipo';rid bigint:=nullif(p->>'destino_id','')::bigint;entry public.financeiro_lancamentos;batch public.pagamento_lotes;
begin
 if member not in ('admin','financeiro') then raise exception 'Somente Financeiro/Admin confere o extrato.' using errcode='42501';end if;
 select * into line from public.empresa_extrato where id=(p->>'id')::bigint for update;
 if line.id is null or line.versao<>coalesce((p->>'versao')::bigint,0) or line.estado<>'pendente' then raise exception 'Linha já conferida ou alterada. Atualize o extrato.';end if;
 if target='ignorar' then if length(coalesce(p->>'motivo',''))<8 then raise exception 'Explique por que a linha não será vinculada.';end if;
 elsif target='cobranca' then if line.valor_centavos<=0 then raise exception 'Escolha uma entrada para recebimento.';end if;perform direct_private.direct_receive_invoice(rid,line.valor_centavos,line.data,'Extrato conferido');
 elsif target='lancamento' then
  select * into entry from public.financeiro_lancamentos where id=rid for update;
  if entry.id is null or entry.valor_centavos<>abs(line.valor_centavos) or (entry.tipo='receita')<>(line.valor_centavos>0) or (entry.data_pagamento is not null and entry.data_pagamento<>line.data) then raise exception 'Confira valor, sentido e data do lançamento.';end if;
  if exists(select 1 from public.empresa_extrato where destino_tipo=target and destino_id=rid and estado='conciliado') then raise exception 'Lançamento já conciliado.';end if;
  update public.financeiro_lancamentos set data_pagamento=line.data,forma_pagamento=case when data_pagamento is null then 'Extrato conferido' else forma_pagamento end,atualizado_em=clock_timestamp() where id=rid;
 elsif target='lote_pagamento' then
  select * into batch from public.pagamento_lotes where id=rid for update;
  if batch.id is null or batch.status<>'pago' or line.valor_centavos>=0 or batch.valor_centavos<>-line.valor_centavos or batch.data_pagamento<>line.data then raise exception 'Escolha o lote pago com o mesmo valor e data.';end if;
  if exists(select 1 from public.empresa_extrato where destino_tipo=target and destino_id=rid and estado='conciliado') then raise exception 'Lote já conciliado.';end if;
 else raise exception 'Vínculo inválido.';end if;
 update public.empresa_extrato set estado=case when target='ignorar' then 'ignorada' else 'conciliado' end,destino_tipo=target,destino_id=case when target='ignorar' then null else rid end,motivo=coalesce(p->>'motivo',''),versao=versao+1,atualizado_em=clock_timestamp() where id=line.id returning * into line;return to_jsonb(line);
end;$$;

create function public.direct_empresa_anexos(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform direct_private.empresa_role();perform direct_private.empresa_get((p->>'registro_id')::bigint);return (select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.empresa_anexos a where registro_id=(p->>'registro_id')::bigint);end;$$;
create function public.direct_empresa_anexo(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare member text:=direct_private.empresa_role();r public.empresa_registros;result public.empresa_anexos;path text:=p->>'caminho';size bigint;
begin
 r:=direct_private.empresa_get((p->>'registro_id')::bigint);if not(direct_private.empresa_contract()->'entities'->r.tipo->'write' ? member) or r.tipo in ('acesso','conta','frase','leitura_aviso') then raise exception 'Seu perfil não pode anexar esta evidência.' using errcode='42501';end if;
 if path !~ ('^'||r.id||'/[a-f0-9]{64}$') or (p->>'sha256') !~ '^[a-f0-9]{64}$' or path<>r.id||'/'||(p->>'sha256') or length(coalesce(p->>'nome','')) not between 1 and 120 or p->>'mime' not in ('image/jpeg','image/png','image/webp') then raise exception 'Anexo inválido.';end if;
 perform 1 from public.empresa_registros where id=r.id for update;
 select (metadata->>'size')::bigint into size from storage.objects where bucket_id='direct-evidencias' and name=path and owner_id=auth.uid()::text;
 if size is null or size not between 1 and 1048576 or size<>(p->>'bytes')::bigint then raise exception 'Faça o envio da imagem antes de registrar o anexo.';end if;
 select * into result from public.empresa_anexos where caminho=path;if result.id is not null then return to_jsonb(result);end if;
 if (select count(*) from public.empresa_anexos where registro_id=r.id)>=8 then raise exception 'Use até 8 fotos por registro.';end if;
 insert into public.empresa_anexos(registro_id,nome,mime,bytes,caminho,sha256,autor) values(r.id,p->>'nome',p->>'mime',size,path,p->>'sha256',auth.jwt()->>'email') returning * into result;return to_jsonb(result);
end;$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('direct-evidencias','direct-evidencias',false,1048576,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy empresa_storage_read on storage.objects for select to authenticated using(bucket_id='direct-evidencias' and exists(select 1 from public.empresa_registros r where r.id::text=(storage.foldername(name))[1]));
create policy empresa_storage_insert on storage.objects for insert to authenticated with check(bucket_id='direct-evidencias' and owner_id=(select auth.uid())::text and exists(select 1 from public.empresa_registros r where r.id::text=(storage.foldername(name))[1] and (direct_private.empresa_contract()->'entities'->r.tipo->'write' ? (select direct_private.member_role()))));
-- Unregistered uploads can be removed by their owner after a failed metadata save.
create policy empresa_storage_cleanup on storage.objects for delete to authenticated using(bucket_id='direct-evidencias' and owner_id=(select auth.uid())::text and not exists(select 1 from public.empresa_anexos where caminho=name));

create function public.direct_empresa_historico(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform direct_private.empresa_role();return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.empresa_registros r where r.cliente_id=(p->>'cliente_id')::bigint and tipo in ('contato','oportunidade','relatorio','campanha','feedback','vinculo','tarefa','proposta') and direct_private.empresa_visible(r) order by id desc limit 100)x);end;$$;
create function public.direct_empresa_alertas(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare day date:=coalesce(nullif(p->>'data','')::date,(now() at time zone 'America/Fortaleza')::date);begin perform direct_private.empresa_role();return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(
 select id,tipo,titulo,case when tipo='tarefa' then 'Prazo vencido ou vence hoje' when tipo='contato' then 'Retorno agendado' else 'Vencido ou próximo da validade' end motivo,coalesce(dados->>'supervisor',dados->>'responsavel',dados->>'conferido_por','') responsavel from public.empresa_registros r where direct_private.empresa_visible(r) and ((tipo='tarefa' and status not in ('concluida','cancelada') and (dados->>'prazo')::timestamptz::date<=day) or (tipo='contato' and (dados->>'retorno')::date<=day) or (tipo in ('qualificacao','lote') and status not in ('revogada','arquivado') and (dados->>'validade')::date<=day+coalesce((dados->>'antecedencia_dias')::int,0))) order by id desc limit 100)x);end;$$;
