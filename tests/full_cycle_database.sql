-- Ciclo real de RPCs, RLS e triggers, com dados sintéticos e rollback obrigatório.
begin;
do $$
declare
 uid uuid:=gen_random_uuid(); email text:='ciclo-sintetico@example.invalid';
 claims text; invite jsonb; result jsonb; board text; worker bigint;
 o1 bigint; o2 bigint; o3 bigint; e1 bigint; e2 bigint; e3 bigint;
 daily_ids bigint[]; batch bigint; current_day date:=(now() at time zone 'America/Fortaleza')::date;
 expected_due date:=direct_private.payment_due((now() at time zone 'America/Fortaleza')::date,30,15);
 start_time time:=((now() at time zone 'America/Fortaleza')+interval '3 minutes')::time;
 finish_time time:=((now() at time zone 'America/Fortaleza')+interval '4 minutes')::time;
 payload jsonb:='{"nome":"Ciclo sintético completo","telefone":"(85) 99999-1234","cpf":"52998224725","data_nascimento":"1990-04-10","cep":"61600000","logradouro":"Rua sintética","numero":"12","bairro":"Centro","cidade":"Caucaia","uf":"CE","setores":["FLV"],"disponibilidade":[{"dia":"segunda","inicio":"00:00","fim":"23:59"}],"trabalhando":false,"rede_trabalho":"","local_trabalho":"","pode_se_deslocar":true,"observacoes_locomocao":"","transporte":"Ônibus","consentimento":true}';
begin
 if start_time>finish_time or extract(hour from finish_time+interval '10 minutes')=0 then raise exception 'Execute este ensaio antes dos últimos quatorze minutos do dia em Fortaleza.';end if;
 insert into auth.users(id,email,email_confirmed_at) values(uid,email,now());
 insert into public.direct_staff(email,role,active) values(email,'operacao',true);
 claims:=jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text;
 perform set_config('request.jwt.claims',claims,true);
 insert into public.tarifas_redes(rede,valor_recebido_centavos,valor_padrao_centavos,pagamento_primeira_quinzena,pagamento_segunda_quinzena)
 values('Ciclo sintético',13400,9000,30,15);
 -- Mesma origem de dados dos pedidos manuais e importados pela leitura.
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos)
 values('Ciclo sintético','Escala completa','FLV',1,jsonb_build_array(
 jsonb_build_object('data',current_day,'inicio',to_char(start_time,'HH24:MI'),'fim',to_char(finish_time,'HH24:MI')),
 jsonb_build_object('data',current_day+1,'inicio','07:00','fim','15:20'))) returning id into o1;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos)
 values('Ciclo sintético','Segundo pedido','FLV',1,jsonb_build_array(jsonb_build_object('data',current_day,'inicio',to_char(start_time+interval '5 minutes','HH24:MI'),'fim',to_char(finish_time+interval '5 minutes','HH24:MI')))) returning id into o2;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos)
 values('Ciclo sintético','Terceiro pedido','FLV',1,jsonb_build_array(jsonb_build_object('data',current_day,'inicio',to_char(start_time+interval '10 minutes','HH24:MI'),'fim',to_char(finish_time+interval '10 minutes','HH24:MI')))) returning id into o3;
 execute 'set local role authenticated';
 invite:=public.direct_portal_create_invite(null,30);
 board:=public.direct_portal_board_link()->>'token';
 execute 'set local role anon';
 perform set_config('request.jwt.claims','{}',true);
 result:=public.direct_portal_submit(payload,invite->>'cadastro_token');
 if not (result->>'cadastrado')::boolean then raise exception 'Cadastro público falhou';end if;
 if not public.direct_portal_board_orders(board) @> jsonb_build_array(jsonb_build_object('id',o1)) then raise exception 'Pedido não publicado';end if;
 result:=public.direct_portal_take_order(o1,result->>'vagas_token','52998224725');
 if (result->>'dias')::int<>2 then raise exception 'Escala inteira não foi confirmada';end if;
 if public.direct_portal_board_orders(board) @> jsonb_build_array(jsonb_build_object('id',o1)) then raise exception 'Vaga preenchida não saiu do painel';end if;
 perform public.direct_portal_take_order(o2,invite->>'vagas_token','52998224725');
 perform public.direct_portal_take_order(o3,invite->>'vagas_token','52998224725');
 execute 'set local role authenticated';
 perform set_config('request.jwt.claims',claims,true);
 select id into worker from public.diaristas where cpf='52998224725';
 if not (public.direct_portal_registrations()->'items') @> jsonb_build_array(jsonb_build_object('id',worker)) then raise exception 'Cadastro não consta no acompanhamento interno';end if;
 select id into e1 from public.pedido_escalas where pedido_id=o1 and data=current_day;
 select id into e2 from public.pedido_escalas where pedido_id=o2;
 select id into e3 from public.pedido_escalas where pedido_id=o3;
 if exists(select 1 from public.diarias where diarista_id=worker) then raise exception 'Confirmação criou pagamento sem presença';end if;
 begin
  update public.pedido_escalas set status='presente' where pedido_id=o1 and data=current_day+1;
  raise exception 'FALHOU: presença futura permitida';
 exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;if sqlerrm not like '%a partir da data%' then raise;end if;end;
 update public.pedido_escalas set status='presente' where id in(e1,e2);
 update public.pedido_escalas set status='falta',falta_motivo='Ausência sintética de teste' where id=e3;
 execute 'reset role';
 if (select count(*) from public.diarias where diarista_id=worker)<>2 or
 (select sum(valor_recebido_centavos) from public.diarias where diarista_id=worker)<>26800 or
 (select sum(valor_centavos) from public.diarias where diarista_id=worker)<>18000 then raise exception 'Financeiro deveria conter receita 268, custo 180, lucro 88';end if;
 if exists(select 1 from public.diarias where diarista_id=worker and (vencimento_pagamento is distinct from expected_due or vencimento_recebimento is distinct from vencimento_pagamento)) then raise exception 'Calendário financeiro incorreto';end if;
 update public.pedido_escalas set status='presente' where id=e1;
 if (select count(*) from public.diarias where diarista_id=worker)<>2 then raise exception 'Repetir presença duplicou diária';end if;
 update public.pedido_escalas set status='falta',falta_motivo='Correção sintética de presença' where id=e2;
 if (select sum(valor_recebido_centavos) from public.diarias where diarista_id=worker)<>13400 then raise exception 'Falta não removeu receita';end if;
 update public.pedido_escalas set status='presente' where id=e2;
 select array_agg(id) into daily_ids from public.diarias where diarista_id=worker;
 update public.direct_staff set role='financeiro' where direct_staff.email='ciclo-sintetico@example.invalid';
 execute 'set local role authenticated';
 batch:=public.direct_pay_daily_batch(worker,daily_ids,current_day,'Pix sintético');
 if not exists(select 1 from public.pagamento_lotes where id=batch and quantidade=2 and valor_centavos=18000) or
 (select count(*) from public.diarias where diarista_id=worker and data_pagamento=current_day and pagamento_lote_id=batch)<>2 then raise exception 'Pagamento agrupado não foi salvo corretamente';end if;
 begin perform public.direct_pay_daily_batch(worker,daily_ids,current_day,'Pix sintético');raise exception 'FALHOU: pagamento duplicado';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;if sqlerrm not like '%já foi paga%' then raise;end if;end;
 execute 'reset role';
 begin update public.pedido_escalas set status='falta',falta_motivo='Correção de diária já paga' where id=e1;raise exception 'FALHOU: diária paga foi removida';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;if sqlerrm not like '%já foi paga%' then raise;end if;end;
 perform public.direct_reopen_payment_batch(batch,'Reabertura sintética controlada');
 if exists(select 1 from public.diarias where diarista_id=worker and (data_pagamento is not null or pagamento_lote_id is not null)) then raise exception 'Reabertura não liberou ajuste';end if;
 update public.pedido_escalas set status='falta',falta_motivo='Correção após reabrir pagamento' where id=e1;
 if (select count(*) from public.diarias where diarista_id=worker)<>1 then raise exception 'Correção não refez financeiro';end if;
 execute 'reset role';
 raise notice 'CICLO COMPLETO OK: cadastro sem conta, telefone, RLS, publicação, escala inteira, presença, falta, receita/custo/lucro, prazos, pagamento agrupado, duplicidade, proteção do histórico e reabertura.';
end $$;
rollback;
