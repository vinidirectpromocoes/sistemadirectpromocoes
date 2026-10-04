begin;
do $$
declare uid uuid; email text; r text; denied boolean; sample jsonb; model_id bigint; amount integer;
begin
 select u.id,u.email into uid,email from auth.users u join public.direct_admins a on a.email=u.email limit 1;
 if uid is null then raise exception 'Admin inexistente.';end if;
 if has_table_privilege('anon','public.pedido_modelos','SELECT') or has_function_privilege('authenticated','direct_private.validate_pedido_modelo()','EXECUTE') then raise exception 'Privilégio indevido.';end if;
 sample:=jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Repositor de FLV','quantidade_diaristas',1,'turnos',jsonb_build_array(jsonb_build_object('data','2030-12-31','inicio','07:00','fim','15:20')));
 insert into public.direct_staff(email,role,active) values ('automation-operation@example.invalid','operacao',true),('automation-finance@example.invalid','financeiro',true),('automation-view@example.invalid','consulta',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
 execute 'set local role authenticated';insert into public.pedido_modelos(nome,dados) values ('QA MODELO TRANSACIONAL',sample) returning id into model_id;execute 'reset role';
 for r in select unnest(array['automation-finance@example.invalid','automation-view@example.invalid','unknown@example.invalid']) loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',r,'role','authenticated')::text,true);execute 'set local role authenticated';
  select count(*) into amount from public.pedido_modelos;if amount<>0 then raise exception 'Perfil % leu modelos.',r;end if;
  denied:=false;begin insert into public.pedido_modelos(nome,dados) values ('MODELO INDEVIDO',sample);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Perfil % escreveu modelo.',r;end if;execute 'reset role';
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email','automation-operation@example.invalid','role','authenticated')::text,true);execute 'set local role authenticated';
 if not exists(select 1 from public.pedido_modelos where id=model_id) then raise exception 'Operação não lê modelos.';end if;
 update public.pedido_modelos set nome='QA MODELO ATUALIZADO' where id=model_id;
 denied:=false;begin insert into public.pedido_modelos(nome,dados) values ('QA INVÁLIDO',sample||'{"quantidade_diaristas":0}'::jsonb);exception when others then denied:=true;end;
 if not denied then raise exception 'Modelo aceitou quantidade inválida.';end if;
 denied:=false;begin insert into public.pedido_modelos(nome,dados) values ('QA INVÁLIDO',jsonb_set(sample,'{turnos,0,inicio}','"99:00"'));exception when others then denied:=true;end;
 if not denied then raise exception 'Modelo aceitou horário inválido.';end if;
 delete from public.pedido_modelos where id=model_id;execute 'reset role';
end $$;
select 'Modelos: admin/operação permitidos; financeiro/consulta/desconhecido/anon negados; quantidade e horário inválidos rejeitados. Tudo revertido.' result;
rollback;
