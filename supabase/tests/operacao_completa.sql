begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='marcosvinidirect@gmail.com'),'email','marcosvinidirect@gmail.com','role','authenticated')::text,true);
insert into public.direct_staff(email,role) values ('qa-operacao@example.invalid','operacao'),('qa-financeiro@example.invalid','financeiro'),('qa-consulta@example.invalid','consulta');

do $$ declare w bigint;p bigint;e bigint;c public.contratos; i bigint;day date:=(now() at time zone 'America/Fortaleza')::date-1;begin
 insert into public.diaristas(nome,cpf,setores,cep,logradouro,numero,bairro,transporte,disponibilidade) values('QA temporário','52998224725','["Operador de caixa"]','60000000','Rua de teste','1','Meireles','Ônibus',(select jsonb_agg(jsonb_build_object('dia',d,'inicio','00:00','fim','23:59')) from unnest(array['segunda','terca','quarta','quinta','sexta','sabado','domingo'])d)) returning id into w;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Super do Povo','Meireles','Operador de caixa',1,jsonb_build_array(jsonb_build_object('data',day,'inicio','07:00','fim','15:20'))) returning id into p;
 c:=public.direct_create_contract(jsonb_build_object('rede','Super do Povo','loja','Meireles','setor','Operador de caixa','inicio',day,'valor_recebido_centavos',15000,'valor_pago_centavos',9500));
 insert into public.pedido_escalas(pedido_id,diarista_id,data) values(p,w,day) returning id into e;
 update public.pedido_escalas set confirmacao='confirmou',confirmacao_em='2099-01-01' where id=e;
 if (select confirmacao_em from public.pedido_escalas where id=e)>now()+interval '1 minute' then raise exception 'timestamp confirmation spoof';end if;
 update public.pedido_escalas set status='presente' where id=e;
 if not exists(select 1 from public.diarias where pedido_escala_id=e and contrato_id=c.id and valor_centavos=9500 and valor_recebido_centavos=15000) then raise exception 'snapshot not applied';end if;
 update public.pedido_escalas set loja_validacao='validado',loja_responsavel='Responsável QA',chegada_em=day+time '07:05'+interval '3 hours',saida_em=day+time '15:20'+interval '3 hours' where id=e;
 insert into public.ocorrencias(pedido_id,escala_id,tipo,descricao) values(p,e,'elogio','Bom atendimento registrado');
 i:=public.direct_create_invoice('Super do Povo',day,day,day+30,'QA-ROLLBACK');
 perform public.direct_review_invoice(i,jsonb_build_object('conferencia','contestada','responsavel','QA Financeiro','motivo','Conferência de horário pendente'));
 if (select valor_centavos from public.cobrancas where id=i)<>15000 then raise exception 'review changed amount';end if;
 perform set_config('direct.qa.escala',e::text,true);perform set_config('direct.qa.cobranca',i::text,true);
end $$;
set local role authenticated;
-- Administração consegue ler o contrato e alterar metadados autorizados.
do $$ begin if (select count(*) from public.contratos)=0 then raise exception 'admin contract read';end if;end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email','qa-operacao@example.invalid','role','authenticated')::text,true);
set local role authenticated;
do $$ declare e bigint:=current_setting('direct.qa.escala')::bigint;begin
 if (select count(*) from public.contratos)<>0 then raise exception 'operation leaks contracts';end if;
 if (select count(*) from public.ocorrencias)=0 then raise exception 'operation occurrence read';end if;
 begin perform public.direct_create_contract('{"rede":"Super do Povo","inicio":"2026-01-01"}'::jsonb);raise exception 'operation contract accepted';exception when raise_exception then if sqlerrm='operation contract accepted' then raise;end if;end;
 update public.pedido_escalas set loja_observacao='Conferência de operação QA' where id=e;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email','qa-financeiro@example.invalid','role','authenticated')::text,true);
set local role authenticated;
do $$ declare n int;begin
 if (select count(*) from public.contratos)=0 then raise exception 'finance contract read';end if;
 update public.pedido_escalas set loja_observacao='Tentativa negada' where id=current_setting('direct.qa.escala')::bigint;get diagnostics n=row_count;if n<>0 then raise exception 'finance changed scale';end if;
 perform public.direct_review_invoice(current_setting('direct.qa.cobranca')::bigint,'{"conferencia":"conferida","responsavel":"QA Financeiro"}'::jsonb);
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email','qa-consulta@example.invalid','role','authenticated')::text,true);
set local role authenticated;
do $$ declare n int;begin
 if (select count(*) from public.contratos)<>0 or (select count(*) from public.ocorrencias)<>0 then raise exception 'consultation sensitive leak';end if;
 update public.pedido_escalas set confirmacao='recusou' where id=current_setting('direct.qa.escala')::bigint;get diagnostics n=row_count;if n<>0 then raise exception 'consultation writes scale';end if;
 begin perform public.direct_review_invoice(current_setting('direct.qa.cobranca')::bigint,'{"conferencia":"conferida","responsavel":"QA"}'::jsonb);raise exception 'consultation review accepted';exception when raise_exception then if sqlerrm='consultation review accepted' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.contratos;raise exception 'anon read contract';exception when insufficient_privilege then null;end;
 begin perform public.direct_create_contract('{}'::jsonb);raise exception 'anon rpc';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: snapshot, timestamps, validation, occurrence, review and admin/operation/finance/consultation/anon permissions' as result;
rollback;
