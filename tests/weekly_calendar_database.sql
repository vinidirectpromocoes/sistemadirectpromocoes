-- Rodar após a migração semanal. Dados sintéticos; nenhuma alteração persistente.
begin;
do $$
declare w bigint; o bigint; e1 bigint;e2 bigint;e3 bigint; d1 bigint;d2 bigint;d3 bigint;
begin
 insert into public.tarifas_redes(rede,valor_recebido_centavos,valor_padrao_centavos,pagamento_semanal_dia)
 values('Semanal sintético',13400,9000,6);
 insert into public.diaristas(nome,cpf) values('Semanal sintético','52998224725') returning id into w;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos)
 values('Semanal sintético','Loja sintética','FLV',1,'[{"data":"2026-09-28","inicio":"07:00","fim":"15:20"},{"data":"2026-09-29","inicio":"07:00","fim":"15:20"},{"data":"2026-09-30","inicio":"07:00","fim":"15:20"}]') returning id into o;
 insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o,w,'2026-09-28',true) returning id into e1;
 insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o,w,'2026-09-29',true) returning id into e2;
 insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(o,w,'2026-09-30',true) returning id into e3;
 update public.pedido_escalas set status='presente' where pedido_id=o;
 select id into d1 from public.diarias where pedido_escala_id=e1;
 select id into d2 from public.diarias where pedido_escala_id=e2;
 select id into d3 from public.diarias where pedido_escala_id=e3;
 if (select count(*) from public.diarias where diarista_id=w and vencimento_pagamento='2026-10-10' and vencimento_recebimento='2026-10-10' and vencimento_origem='calendario')<>3 then raise exception 'Presenças não receberam prazo semanal correto';end if;
 update public.diarias set vencimento_pagamento='2026-10-12' where id=d2;
 update public.diarias set data_pagamento='2026-10-09',forma_pagamento='Pix sintético' where id=d3;
 update public.tarifas_redes set pagamento_semanal_dia=5 where rede='Semanal sintético';
 if not exists(select 1 from public.diarias where id=d1 and vencimento_pagamento='2026-10-09' and vencimento_recebimento='2026-10-09') then raise exception 'Edição para sexta não atualizou pendência automática';end if;
 if not exists(select 1 from public.diarias where id=d2 and vencimento_pagamento='2026-10-12' and vencimento_origem='manual') then raise exception 'Edição alterou prazo manual';end if;
 if not exists(select 1 from public.diarias where id=d3 and vencimento_pagamento='2026-10-10' and data_pagamento='2026-10-09') then raise exception 'Edição alterou histórico pago';end if;
 begin
  update public.tarifas_redes set pagamento_primeira_quinzena=20,pagamento_segunda_quinzena=5 where rede='Semanal sintético';
  raise exception 'FALHOU: calendários conflitantes permitidos';
 exception when check_violation then null;end;
 if has_function_privilege('anon','direct_private.payment_due(date,integer,integer,integer)','execute') or has_function_privilege('authenticated','direct_private.payment_due(date,integer,integer,integer)','execute') then raise exception 'Helper interno exposto';end if;
 if direct_private.payment_due('2026-10-04',null,null,6)<>'2026-10-10'::date or direct_private.payment_due('2026-10-05',null,null,6)<>'2026-10-17'::date then raise exception 'Fechamento semanal incorreto';end if;
 raise notice 'SEMANAL OK: semana seguinte, presença, vencimentos iguais, edição, histórico manual/pago, validação e privilégios.';
end $$;
rollback;
