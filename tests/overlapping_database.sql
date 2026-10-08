-- Teste real do trigger/RPC com dados sintéticos e rollback.
begin;
do $$
declare uid uuid; email text; worker bigint; first_order bigint; second_order bigint; third_order bigint; e1 bigint;e2 bigint; result jsonb; turn1 jsonb;turn2 jsonb;amount bigint;expense bigint;day date:=(now() at time zone 'America/Fortaleza')::date;v_cpf text;stem text;n int;digit int;
begin
select u.id,u.email into uid,email from auth.users u join public.direct_admins a on a.email=u.email limit 1;
if uid is null then raise exception 'Admin necessário para ensaio.';end if;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
-- Identidade sintética sem colidir com nenhum cadastro real.
loop
 stem:=floor(100000000+random()*899999999)::bigint::text;v_cpf:=stem;
 for n in 9..10 loop select (sum(substring(v_cpf,i,1)::int*(n+2-i))*10)%11 into digit from generate_series(1,n)i;v_cpf:=v_cpf||case when digit=10 then '0' else digit::text end;end loop;
 exit when not exists(select 1 from public.diaristas where diaristas.cpf=v_cpf);
end loop;
select jsonb_agg(jsonb_build_object('data',day+i,'inicio','07:00','fim','15:20') order by i),jsonb_agg(jsonb_build_object('data',day+i,'inicio','13:40','fim','22:00') order by i) into turn1,turn2 from generate_series(0,6)i;
execute 'set local role authenticated';
result:=public.direct_read_order_assignment(jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Balcao de Frios','quantidade_diaristas',1,'turnos',turn1),'Pessoa Sintética Sobreposição',v_cpf,true,gen_random_uuid());
first_order:=(result->>'pedido_id')::bigint;worker:=(result->>'diarista_id')::bigint;
result:=public.direct_read_order_assignment(jsonb_build_object('supermercado','Super do Povo','unidade','Meireles','setor','Balcao de Frios','quantidade_diaristas',1,'turnos',turn2),'Pessoa Sintética Sobreposição',v_cpf,true,gen_random_uuid());
second_order:=(result->>'pedido_id')::bigint;
if worker is distinct from (result->>'diarista_id')::bigint or (select count(*) from public.pedido_escalas where pedido_id in(first_order,second_order))<>14 then raise exception 'Não reutilizou cadastro com 14 escalas.';end if;
if exists(select 1 from public.diarias where diarista_id=worker) then raise exception 'Criou pagamento antes da presença.';end if;
-- A escala manual também aceita cadastro básico sem disponibilidade.
insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Super do Povo','Meireles','Balcao de Frios',1,turn1) returning id into third_order;
insert into public.pedido_escalas(pedido_id,diarista_id,data) values(third_order,worker,day);
select id into e1 from public.pedido_escalas where pedido_id=first_order and data=day;
select id into e2 from public.pedido_escalas where pedido_id=second_order and data=day;
update public.pedido_escalas set status='presente' where id in(e1,e2);
if (select count(*) from public.diarias where pedido_escala_id in(e1,e2))<>2 then raise exception 'Presenças de dois pedidos foram agrupadas incorretamente.';end if;
select valor_recebido_centavos,valor_centavos into amount,expense from public.diarias where pedido_escala_id=e1;
if amount is null or expense is null then raise exception 'Presença não congelou os valores.';end if;
-- Corrigir setor preserva as escalas e os registros financeiros congelados.
update public.pedidos set setor='Balconista de frios' where id=first_order;
if (select count(*) from public.pedido_escalas where pedido_id=first_order)<>7 or not exists(select 1 from public.diarias where pedido_escala_id=e1 and valor_recebido_centavos=amount and valor_centavos=expense) then raise exception 'Correção de setor alterou equipe ou valores.';end if;
begin
 update public.pedidos set quantidade_diaristas=2 where id=first_order;
 raise exception 'Quantidade com escala foi alterada indevidamente.';
exception when others then
 if sqlerrm not like 'Este pedido já possui escalas.%' then raise;end if;
end;
update public.pedido_escalas set status='falta',falta_motivo='Não compareceu ao segundo turno' where id=e2;
if (select status from public.pedido_escalas where id=e1)<>'presente' or (select count(*) from public.diarias where pedido_escala_id in(e1,e2))<>1 then raise exception 'Falta alterou a diária do outro pedido.';end if;
update public.pedido_escalas set status='presente' where id=e2;
if (select count(*) from public.diarias where pedido_escala_id in(e1,e2))<>2 then raise exception 'Reversão da falta não restaurou apenas a diária afetada.';end if;
execute 'reset role';
if has_function_privilege('anon','public.direct_read_order_assignment(jsonb,text,text,boolean,uuid,bigint,bigint)','EXECUTE') or has_table_privilege('anon','public.pedido_escalas','INSERT') then raise exception 'Permissão anônima indevida.';end if;
end $$;
select 'Dois pedidos, 14 escalas, cadastro reutilizado, escala manual, presença/falta e financeiro independente: aprovados. Dados revertidos.' result;
rollback;
