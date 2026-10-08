-- Ensaio de funções/RLS reais. Nenhum registro de negócio é mantido.
begin;
do $$
declare uid uuid; email text; r text; denied boolean; result jsonb; saved jsonb; response jsonb; snapshot jsonb; old bigint; candidate bigint; blocked bigint;o bigint; conflict_order bigint;first_scale bigint;selected bigint;last_scale bigint;day date:=(now() at time zone 'America/Fortaleza')::date;
begin
select u.id,u.email into uid,email from auth.users u join public.direct_admins a on a.email=u.email limit 1;if uid is null then raise exception 'Admin necessário.';end if;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
insert into public.direct_staff(email,role,active) values('usability-op@example.invalid','operacao',true),('usability-fin@example.invalid','financeiro',true),('usability-view@example.invalid','consulta',true);
insert into public.diaristas(nome,cpf) values('Pessoa João Busca','52998224725') returning id into old;
insert into public.diaristas(nome,cpf) values('Pessoa Substituta Busca','11144477735') returning id into candidate;
insert into public.diaristas(nome,cpf,bloqueada) values('Pessoa Bloqueada Busca','12345678909',true) returning id into blocked;
insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Super do Povo','Meireles','FLV',1,jsonb_build_array(jsonb_build_object('data',day,'inicio','00:00','fim','23:59'),jsonb_build_object('data',day+1,'inicio','00:00','fim','23:59'),jsonb_build_object('data',day+2,'inicio','00:00','fim','23:59'))) returning id into o;
insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o,old,day,true) returning id into first_scale;
insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o,old,day+1,true) returning id into selected;
insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o,old,day+2,true) returning id into last_scale;
execute 'set local role authenticated';result:=public.direct_search('joao');if not result @> jsonb_build_array(jsonb_build_object('kind','diarista','id',old)) or result::text like '%52998224725%' then raise exception 'Busca incompleta ou expôs CPF.';end if;
if not public.direct_search('529.982.247-25') @> jsonb_build_array(jsonb_build_object('kind','diarista','id',old)) then raise exception 'CPF formatado não encontra cadastro.';end if;
if public.direct_search('x')<>'[]'::jsonb then raise exception 'Busca curta deveria estar vazia.';end if;
saved:=public.direct_pending_save(jsonb_build_object('chave','pedido:'||o,'responsavel','Operação Direct','proxima_acao','Conferir resposta','adiada_ate',now()+interval '1 day'));
denied:=false;begin perform public.direct_pending_save(jsonb_build_object('chave','pedido:'||o));exception when serialization_failure then denied:=true;end;if not denied then raise exception 'Edição antiga sobrescreveu organização.';end if;
perform public.direct_pending_save(jsonb_build_object('chave','pedido:'||o,'expected_updated_at',saved->>'atualizado_em','adiada_ate',null,'responsavel','Operação Direct','proxima_acao','Retomada'));
denied:=false;begin perform public.direct_pending_save(jsonb_build_object('chave','cadastro:'||old,'adiada_ate',now()+interval '31 days'));exception when others then denied:=true;end;if not denied then raise exception 'Adiamento sem limite.';end if;
response:=public.direct_replacement_response(jsonb_build_object('escala_id',selected,'diarista_id',candidate,'resposta','confirmou','datas',jsonb_build_array(day+1,day+2)));
denied:=false;begin perform public.direct_replacement_response(jsonb_build_object('escala_id',selected,'diarista_id',candidate,'resposta','recusou'));exception when serialization_failure then denied:=true;end;if not denied then raise exception 'Resposta antiga sobrescreveu confirmação.';end if;
denied:=false;begin perform public.direct_replacement_response(jsonb_build_object('escala_id',selected,'diarista_id',blocked,'resposta','confirmou'));exception when others then denied:=true;end;if not denied then raise exception 'Cadastro bloqueado aceito.';end if;
if exists(select 1 from public.diarias where diarista_id=candidate) then raise exception 'Resposta gerou pagamento.';end if;
execute 'reset role';
update public.pedido_escalas set status='presente' where id=first_scale;
insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Super do Povo','Meireles','FLV',1,jsonb_build_array(jsonb_build_object('data',day+2,'inicio','00:00','fim','23:59'))) returning id into conflict_order;
insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(conflict_order,candidate,day+2,true);
update public.diaristas set bloqueada=true where id=candidate;
execute 'set local role authenticated';denied:=false;begin perform public.direct_replace_order_remaining(o,selected,candidate,'Troca solicitada pela pessoa',true);exception when others then denied:=true;end;execute 'reset role';
if not denied or exists(select 1 from public.pedido_escalas where pedido_id=o and diarista_id=candidate) or (select status from public.pedido_escalas where id=selected)<>'escalada' then raise exception 'Troca parcial não foi revertida.';end if;
update public.diaristas set bloqueada=false where id=candidate;
execute 'set local role authenticated';result:=public.direct_replace_order_remaining(o,selected,candidate,'Troca solicitada pela pessoa',true);execute 'reset role';
if jsonb_array_length(result)<>2 or (select status from public.pedido_escalas where id=first_scale)<>'presente' or (select count(*) from public.pedido_escalas where pedido_id=o and status='desistiu')<>2 or exists(select 1 from public.diarias where diarista_id=candidate) then raise exception 'Troca não preservou presença/histórico ou gerou pagamento.';end if;
if not exists(select 1 from public.direct_auditoria where tabela='substituicao_contatos') or not exists(select 1 from public.direct_auditoria where tabela='pendencia_acoes') then raise exception 'Faltou auditoria.';end if;
for r in select unnest(array['usability-op@example.invalid','usability-fin@example.invalid','usability-view@example.invalid','unknown@example.invalid']) loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',r,'role','authenticated')::text,true);execute 'set local role authenticated';
 if r='unknown@example.invalid' then denied:=false;begin perform public.direct_search('Busca');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Sem perfil acessou busca.';end if;
 else result:=public.direct_search('Busca');if r='usability-view@example.invalid' and exists(select 1 from jsonb_array_elements(result)e where e->>'kind'='diarista') then raise exception 'Consulta acessou cadastro.';end if;end if;
 if r<>'usability-op@example.invalid' then
  if exists(select 1 from public.substituicao_contatos) then raise exception 'Respostas acessíveis pelo perfil %',r;end if;
  denied:=false;begin perform public.direct_pending_save(jsonb_build_object('chave','pedido:'||o));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Perfil % alterou organização operacional.',r;end if;
 end if;
 if r in ('usability-view@example.invalid','unknown@example.invalid') and exists(select 1 from public.pendencia_acoes) then raise exception 'Perfil % leu organização.',r;end if;
 execute 'reset role';
end loop;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);execute 'set local role authenticated';snapshot:=public.direct_backup_snapshot_v8();execute 'reset role';
if snapshot->>'format'<>'direct-data-v8' or (select count(*) from jsonb_object_keys(snapshot->'tables'))<>30 or not snapshot->'tables'->'substituicao_contatos' @> jsonb_build_array(jsonb_build_object('escala_id',selected,'diarista_id',candidate,'datas',jsonb_build_array(day+1,day+2))) then raise exception 'Backup não inclui respostas e datas.';end if;
if has_function_privilege('anon','public.direct_search(text)','EXECUTE') or has_table_privilege('anon','public.pendencia_acoes','SELECT') or has_function_privilege('authenticated','direct_private.backup_snapshot_v8()','EXECUTE') then raise exception 'Privilégio indevido.';end if;
end $$;
select 'Busca, perfis, CAS, adiamento, auditoria, respostas sem pagamento, substituição restante atômica e backup v8: aprovados. Dados revertidos.' result;
rollback;
