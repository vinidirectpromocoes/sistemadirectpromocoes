begin;
do $$
declare uid uuid; email text; s1 bigint; s2 bigint; link1 jsonb; link2 jsonb; payload jsonb; r jsonb; req bigint; ord bigint; worker bigint; esc bigint; checkid bigint; first_id bigint; denied boolean; d date:=(now() at time zone 'America/Fortaleza')::date; key uuid:=gen_random_uuid(); other bigint; token text; future_order bigint; future_scale bigint; negative_id bigint;
begin
 select u.id,u.email into uid,email from auth.users u join public.direct_admins a on a.email=u.email limit 1;
 select id into s1 from public.lojas where rede='Super do Povo' and nome='Meireles';select id into s2 from public.lojas where rede='Hipermarket' and nome='Vila União';
 if uid is null or s1 is null or s2 is null then raise exception 'Loja/admin para ensaio ausente.';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);
 execute 'set local role authenticated';link1:=public.direct_store_link(s1);link2:=public.direct_store_link(s2);execute 'reset role';
 payload:=jsonb_build_object('supermercado','Hipermarket','unidade','Vila União','setor','Repositor de FLV','quantidade_diaristas',1,'turnos',jsonb_build_array(jsonb_build_object('data',d,'inicio','07:00','fim','15:20')));
 execute 'set local role anon';perform set_config('request.jwt.claims','{}',true);
 if (public.direct_store_context(link1->>'token')->'loja'->>'id')::bigint<>s1 then raise exception 'Contexto de outra loja.';end if;
 denied:=false;begin perform public.direct_store_context(repeat('f',64));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Link inexistente aceito.';end if;
 r:=public.direct_store_submit(link1->>'token',payload,key);req:=(r->>'id')::bigint;
 if (public.direct_store_submit(link1->>'token',payload,key)->>'id')::bigint<>req then raise exception 'Reenvio duplicou solicitação.';end if;
 if public.direct_store_orders(link2->>'token')->'solicitacoes' @> jsonb_build_array(jsonb_build_object('id',req)) then raise exception 'Loja leu pedido de outra.';end if;
 denied:=false;begin perform public.direct_store_submit(link1->>'token',payload||'{"quantidade_diaristas":0}'::jsonb,gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'Quantidade inválida aceita.';end if;
 execute 'reset role';
 if (select dados->>'supermercado' from public.loja_solicitacoes where id=req)<>'Super do Povo' then raise exception 'Usuário alterou a rede do link.';end if;
 if exists(select 1 from public.pedidos where id=(select pedido_id from public.loja_solicitacoes where id=req)) then raise exception 'Solicitação publicou pedido sem Direct.';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);execute 'set local role authenticated';
 r:=public.direct_store_review_request(req,payload||jsonb_build_object('supermercado','Super do Povo','unidade','Meireles'),true);ord:=(r->>'id')::bigint;
 denied:=false;begin perform public.direct_store_review_request(req,payload,true);exception when others then denied:=true;end;if not denied then raise exception 'Solicitação aprovada novamente.';end if;
 execute 'reset role';
 insert into public.diaristas(nome,cpf,setores,disponibilidade,pode_se_deslocar) values('Ensaio loja sem dados reais','11144477735','["Repositor de FLV"]','[]',true) returning id into worker;
 insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(ord,worker,d,true) returning id into esc;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Hipermarket','Vila União','Repositor de FLV',1,jsonb_build_array(jsonb_build_object('data',d,'inicio','16:00','fim','22:00'))) returning id into other;
 insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(other,worker,d,true) returning id into first_id;
 execute 'set local role anon';perform set_config('request.jwt.claims','{}',true);
 if (public.direct_store_orders(link1->>'token')::text)~'"cpf"|valor_centavos|valor_recebido' then raise exception 'Portal expôs CPF/financeiro.';end if;
 if public.direct_store_orders(link1->>'token')->'pedidos' @> jsonb_build_array(jsonb_build_object('id',other)) then raise exception 'Portal expôs outro pedido.';end if;
 denied:=false;begin perform public.direct_store_check(link1->>'token',first_id,'presente');exception when others then denied:=true;end;if not denied then raise exception 'Portal alterou escala de outra loja.';end if;
 r:=public.direct_store_check(link1->>'token',esc,'presente');checkid:=(r->>'id')::bigint;
 execute 'reset role';
 if (select status from public.pedido_escalas where id=esc)<>'escalada' or exists(select 1 from public.diarias where pedido_escala_id=esc) then raise exception 'Conferência pulou revisão e afetou financeiro.';end if;
 insert into public.direct_staff(email,role,active) values('loja-finance@example.invalid','financeiro',true),('loja-view@example.invalid','consulta',true);
 for token in select unnest(array['loja-finance@example.invalid','loja-view@example.invalid','unknown@example.invalid']) loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',token,'role','authenticated')::text,true);execute 'set local role authenticated';
  denied:=false;begin perform public.direct_store_link(s1);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Perfil % gerou link.',token;end if;
  denied:=false;begin perform public.direct_store_review_check(checkid,true);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Perfil % aplicou presença.',token;end if;
  if exists(select 1 from public.loja_solicitacoes) or exists(select 1 from public.loja_validacoes) then raise exception 'Perfil % acessou revisões.',token;end if;execute 'reset role';
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);execute 'set local role authenticated';perform public.direct_store_review_check(checkid,true);execute 'reset role';
 if not exists(select 1 from public.diarias where pedido_escala_id=esc and valor_centavos=9000 and valor_recebido_centavos=13400) then raise exception 'Presença não gerou financeiro correto.';end if;
 if (select loja_validacao from public.pedido_escalas where id=esc)<>'validado' then raise exception 'Conferência da loja não integrada.';end if;

 -- An applied review cannot be silently changed by the external holder.
 execute 'set local role anon';perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.direct_store_check(link1->>'token',esc,'falta');exception when others then denied:=true;end;if not denied then raise exception 'Portal mudou conferência já aplicada.';end if;
 -- A pending absence must not remove a payment that Direct settles while it waits.
 r:=public.direct_store_check(link2->>'token',first_id,'falta','Pessoa não compareceu à loja');negative_id:=(r->>'id')::bigint;execute 'reset role';
 update public.pedido_escalas set status='presente' where id=first_id;
 update public.diarias set data_pagamento=d,forma_pagamento='Pix sintético' where pedido_escala_id=first_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);execute 'set local role authenticated';
 denied:=false;begin perform public.direct_store_review_check(negative_id,true);exception when others then denied:=true;end;if not denied then raise exception 'Revisão removeu diária paga.';end if;execute 'reset role';
 if (select estado from public.loja_validacoes where id=negative_id)<>'pendente' or not exists(select 1 from public.diarias where pedido_escala_id=first_id and data_pagamento=d) then raise exception 'Falha não preservou histórico e revisão.';end if;
 update public.diarias set data_pagamento=null,forma_pagamento='',motivo_ajuste='Reabertura sintética para testar falta' where pedido_escala_id=first_id;
 execute 'set local role authenticated';perform public.direct_store_review_check(negative_id,true);execute 'reset role';
 if (select status from public.pedido_escalas where id=first_id)<>'falta' or exists(select 1 from public.diarias where pedido_escala_id=first_id) then raise exception 'Falta não retirou diária financeira.';end if;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Super do Povo','Meireles','Repositor de FLV',1,jsonb_build_array(jsonb_build_object('data',d+1,'inicio','07:00','fim','15:20'))) returning id into future_order;
 insert into public.pedido_escalas(pedido_id,diarista_id,data,disponibilidade_pedido_confirmada) values(future_order,worker,d+1,true) returning id into future_scale;
 execute 'set local role anon';perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.direct_store_check(link1->>'token',future_scale,'presente');exception when others then denied:=true;end;if not denied then raise exception 'Presença futura aceita.';end if;execute 'reset role';
 -- Operation may manage links; renewal invalidates the previous token and expiry closes access.
 insert into public.direct_staff(email,role,active) values('loja-operacao@example.invalid','operacao',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email','loja-operacao@example.invalid','role','authenticated')::text,true);execute 'set local role authenticated';link2:=public.direct_store_link(s2,'renovar');execute 'reset role';
 update direct_private.loja_links set expira_em=now()-interval '1 minute' where loja_id=s2;
 execute 'set local role anon';perform set_config('request.jwt.claims','{}',true);denied:=false;begin perform public.direct_store_context(link2->>'token');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Link expirado aceito.';end if;execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'email',email,'role','authenticated')::text,true);execute 'set local role authenticated';perform public.direct_store_link(s1,'revogar');execute 'set local role anon';perform set_config('request.jwt.claims','{}',true);
 denied:=false;begin perform public.direct_store_context(link1->>'token');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Link revogado continua acessível.';end if;execute 'reset role';
end $$;
select 'Portal loja: escopo, reenvio, revisão, presença→financeiro, perfis, dados restritos e revogação OK; tudo revertido.' result;
rollback;
