-- Verificação real das permissões e da proteção do histórico; somente dados sintéticos com rollback.
begin;
do $$
<<checks>>
declare uid uuid; email text; v_cpf text; stem text; n int; digit int; worker bigint; replacement bigint; oid bigint; sid bigint; new_sid bigint; result jsonb; denied boolean; version timestamptz;day date:=(now() at time zone 'America/Fortaleza')::date; fin text:='reading-fin-'||gen_random_uuid()||'@example.invalid';
begin
 select u.id,u.email into uid,email from auth.users u join public.direct_admins a on a.email=u.email limit 1;
 if uid is null then raise exception 'Admin necessário para ensaio.';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
 insert into public.direct_staff(email,role,active) values(fin,'financeiro',true);
 for n in 1..2 loop
  loop
   stem:=floor(100000000+random()*899999999)::bigint::text;v_cpf:=stem;
   for digit in 9..10 loop select (sum(substring(v_cpf,i,1)::int*(digit+2-i))*10)%11 into worker from generate_series(1,digit)i;v_cpf:=v_cpf||case when worker=10 then '0' else worker::text end;end loop;
   exit when not exists(select 1 from public.diaristas where cpf=v_cpf);
  end loop;
  execute 'set local role authenticated';
  if n=1 then
   result:=public.direct_read_order_assignment(jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Balconista de frios','quantidade_diaristas',1,'turnos',jsonb_build_array(jsonb_build_object('data',day,'inicio','07:00','fim','15:20'))),'Pessoa Sintética Diálogo',v_cpf,true,gen_random_uuid());
   oid:=(result->>'pedido_id')::bigint;
   select id,atualizado_em into sid,version from public.pedido_escalas where pedido_id=oid;
  else insert into public.diaristas(nome,cpf) values('Pessoa Sintética Substituta',v_cpf) returning id into replacement;end if;
  execute 'reset role';
 end loop;
 execute 'set local role authenticated';
 denied:=false;begin perform public.direct_read_replace_worker(oid,sid,replacement,'Teste de disponibilidade',true,'2000-01-01');exception when serialization_failure then denied:=true;end;
 if not denied or (select status from public.pedido_escalas where id=sid)<>'escalada' then raise exception 'Substituição com versão antiga foi aplicada.';end if;
 execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',fin,'role','authenticated')::text,true);execute 'set local role authenticated';
 denied:=false;begin perform public.direct_read_replace_worker(oid,sid,replacement,'Teste de disponibilidade',true,version);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Financeiro substituiu uma escala.';end if;
 execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);execute 'set local role authenticated';
 result:=public.direct_read_replace_worker(oid,sid,replacement,'Teste de disponibilidade',true,version);
 select substituida_por_escala_id into new_sid from public.pedido_escalas where id=sid;
 if new_sid is null or (select status from public.pedido_escalas where id=sid)<>'desistiu' or (select diarista_id from public.pedido_escalas where id=new_sid)<>replacement then raise exception 'Substituição incompleta.';end if;
 denied:=false;begin delete from public.pedido_escalas where id=new_sid;exception when others then denied:=sqlerrm like 'Esta escala faz parte de uma substituição%';end;
 if not denied or not exists(select 1 from public.pedido_escalas where id=new_sid) or (select substituida_por_escala_id from public.pedido_escalas where id=sid) is distinct from new_sid then raise exception 'Apagou o histórico da substituição.';end if;
 if has_function_privilege('anon','public.direct_read_replace_worker(bigint,bigint,bigint,text,boolean,timestamptz)','EXECUTE') then raise exception 'Substituição exposta sem autenticação.';end if;
end $$;
rollback;
