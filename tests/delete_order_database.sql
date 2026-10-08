-- Teste real de exclusão, RLS e atomicidade; dados sintéticos revertidos.
begin;
do $$
<<test_data>>
declare uid uuid; email text; worker bigint; first_order bigint; second_order bigint; third_order bigint; history_order bigint;
 result jsonb; before_other jsonb; after_other jsonb; turnos jsonb; d date:=(now() at time zone 'America/Fortaleza')::date;
 cpf text; stem text; n int; digit int; denied boolean; r text; op text:='delete-op-'||gen_random_uuid()||'@example.invalid';
 fin text:='delete-fin-'||gen_random_uuid()||'@example.invalid'; vw text:='delete-view-'||gen_random_uuid()||'@example.invalid';
begin
 select u.id,u.email into uid,email from auth.users u join public.direct_admins a on a.email=u.email limit 1;
 if uid is null then raise exception 'Admin necessário para ensaio.';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
 insert into public.direct_staff(email,role,active) values(op,'operacao',true),(fin,'financeiro',true),(vw,'consulta',true);
 loop
  stem:=floor(100000000+random()*899999999)::bigint::text;cpf:=stem;
  for n in 9..10 loop select (sum(substring(cpf,i,1)::int*(n+2-i))*10)%11 into digit from generate_series(1,n)i;cpf:=cpf||case when digit=10 then '0' else digit::text end;end loop;
  exit when not exists(select 1 from public.diaristas w where w.cpf=test_data.cpf);
 end loop;
 select jsonb_agg(jsonb_build_object('data',d+i,'inicio','07:00','fim','15:20') order by i) into turnos from generate_series(0,6)i;
 execute 'set local role authenticated';
 result:=public.direct_read_order_assignment(jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Balconista de frios','quantidade_diaristas',1,'turnos',turnos),'Pessoa Sintética Exclusão',cpf,true,gen_random_uuid());
 first_order:=(result->>'pedido_id')::bigint;worker:=(result->>'diarista_id')::bigint;
 result:=public.direct_read_order_assignment(jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Balconista de frios','quantidade_diaristas',1,'turnos',turnos),'Pessoa Sintética Exclusão',cpf,true,gen_random_uuid());
 second_order:=(result->>'pedido_id')::bigint;
 select jsonb_agg(to_jsonb(e) order by e.id) into before_other from public.pedido_escalas e where pedido_id=second_order;
 denied:=false;begin perform public.direct_delete_order(first_order,'2000-01-01');exception when serialization_failure then denied:=true;end;
 if not denied or (select count(*) from public.pedido_escalas where pedido_id=first_order)<>7 then raise exception 'Versão antiga excluiu dados.';end if;
 result:=public.direct_delete_order(first_order,(select atualizado_em from public.pedidos where id=first_order));
 if result->>'ok'<>'true' or (result->>'escalas_removidas')::int<>7 or exists(select 1 from public.pedidos where id=first_order) or exists(select 1 from public.pedido_escalas where pedido_id=first_order) or not exists(select 1 from public.diaristas where id=worker) then raise exception 'Exclusão incompleta ou apagou cadastro.';end if;
 select jsonb_agg(to_jsonb(e) order by e.id) into after_other from public.pedido_escalas e where pedido_id=second_order;
 if before_other is distinct from after_other then raise exception 'Alterou outro pedido.';end if;
 denied:=false;begin perform public.direct_delete_order(first_order);exception when others then denied:=sqlerrm like 'Pedido não encontrado%';end;if not denied then raise exception 'Repetição retornou sucesso falso.';end if;
 -- Histórico impede exclusão antes de remover qualquer uma das outras seis escalas.
 for r in select unnest(array['presente','falta','desistiu']) loop
  result:=public.direct_read_order_assignment(jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Balconista de frios','quantidade_diaristas',1,'turnos',turnos),'Pessoa Sintética Exclusão',cpf,true,gen_random_uuid());history_order:=(result->>'pedido_id')::bigint;
  update public.pedido_escalas set status=r,falta_motivo=case when r='falta' then 'Ensaio de falta' else falta_motivo end,desistencia_motivo=case when r='desistiu' then 'Ensaio de desistência' else desistencia_motivo end where pedido_id=history_order and data=d;
  denied:=false;begin perform public.direct_delete_order(history_order);exception when others then denied:=sqlerrm like 'Este pedido possui histórico%';end;
  if not denied or (select count(*) from public.pedido_escalas where pedido_id=history_order)<>7 then raise exception 'Histórico não foi protegido atomicamente.';end if;
 end loop;
 result:=public.direct_read_order_assignment(jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Balconista de frios','quantidade_diaristas',1,'turnos',turnos),'Pessoa Sintética Exclusão',cpf,true,gen_random_uuid());third_order:=(result->>'pedido_id')::bigint;
 execute 'reset role';
 for r in select unnest(array[fin,vw,'unknown-delete@example.invalid']) loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',r,'role','authenticated')::text,true);execute 'set local role authenticated';
  denied:=false;begin perform public.direct_delete_order(third_order);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Perfil não operacional conseguiu excluir.';end if;execute 'reset role';
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',op,'role','authenticated')::text,true);execute 'set local role authenticated';
 result:=public.direct_delete_order(third_order);execute 'reset role';
 if (result->>'escalas_removidas')::int<>7 then raise exception 'Operação não exclui escala planejada.';end if;
 if has_function_privilege('anon','public.direct_delete_order(bigint,timestamptz)','EXECUTE') then raise exception 'RPC acessível sem autenticação.';end if;
 if not exists(select 1 from public.direct_auditoria where tabela='pedidos' and operacao='DELETE') then raise exception 'Exclusão sem auditoria.';end if;
end $$;
select 'Exclusão atômica, sete escalas, cadastro/outro pedido preservados, histórico, versão, admin/operação e negativas de perfil: aprovados. Dados revertidos.' result;
rollback;
