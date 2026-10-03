-- Executar em transação: registros sintéticos e sessões simuladas; nada permanece.
begin;
do $$
declare u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();u3 uuid:=gen_random_uuid();w1 bigint;oid bigint;other_oid bigint;result jsonb;i1 jsonb;i2 jsonb;i3 jsonb;d date:=(now() at time zone 'America/Fortaleza')::date+2;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u1,'portal-teste-1@example.invalid',now()),(u2,'portal-teste-2@example.invalid',now()),(u3,'portal-teste-3@example.invalid',now());
 insert into public.direct_staff(email,role,active) values('portal-teste-2@example.invalid','operacao',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u2,'email','portal-teste-2@example.invalid','role','authenticated')::text,true);
 i1:=public.direct_portal_create_invite(null,30);i2:=public.direct_portal_create_invite(null,30);i3:=public.direct_portal_create_invite(null,30);
 delete from public.direct_staff where email='portal-teste-2@example.invalid';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u1,'email','portal-teste-1@example.invalid','role','authenticated')::text,true);
 result:=public.direct_portal_register('{"nome":"Portal teste sintético","cpf":"52998224725"}',i1->>'cadastro_token');
 if result->>'status'<>'ativo' then raise exception 'Use uma base em que o CPF sintético não exista.'; end if;
 select diarista_id into w1 from public.portal_cadastros where user_id=u1;
 if (public.direct_portal_register('{"nome":"Portal teste sintético","cpf":"52998224725"}',i1->>'cadastro_token')->>'status')<>'ativo' then raise exception 'Cadastro não é idempotente'; end if;
 insert into public.tarifas_redes(rede,valor_recebido_centavos,valor_padrao_centavos) values('Portal teste',8100,5100);
 insert into public.tarifas_setores(rede,setor,valor_pago_centavos) values('Portal teste','FLV',5200);
 insert into public.contratos(rede,loja,setor,inicio,valor_pago_centavos) values('Portal teste','Unidade sintética','FLV',d,5300);
 if direct_private.portal_daily_value('Portal teste','Unidade sintética','FLV',d)<>5300 or direct_private.portal_daily_value('Portal teste','Outra sintética','FLV',d)<>5200 then raise exception 'Valor publicado não acompanha contrato/setor';end if;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Portal teste','Unidade sintética','FLV',1,jsonb_build_array(jsonb_build_object('data',d,'inicio','07:00','fim','15:20'))) returning id into oid;
 result:=public.direct_portal_accept(oid,i1->>'vagas_token');
 if (result->>'dias')::int<>1 or not exists(select 1 from public.pedido_escalas where pedido_id=oid and diarista_id=w1 and confirmacao='confirmou' and status='escalada') then raise exception 'Escala/confirmou não persistiu'; end if;
 if (public.direct_portal_accept(oid,i1->>'vagas_token')->>'dias')::int<>0 then raise exception 'Repetição duplicou escala'; end if;
 if public.direct_portal_orders(i1->>'vagas_token') @> jsonb_build_array(jsonb_build_object('id',oid)) then raise exception 'Pedido preenchido continua público'; end if;
 insert into public.pedidos(supermercado,unidade,setor,quantidade_diaristas,turnos) values('Portal teste','Outra sintética','FLV',1,jsonb_build_array(jsonb_build_object('data',d,'inicio','08:00','fim','16:20'))) returning id into other_oid;
 begin perform public.direct_portal_accept(other_oid,i1->>'vagas_token');raise exception 'FALHOU: conflito permitido';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;if sqlerrm not like '%outro pedido%' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u2,'email','portal-teste-2@example.invalid','role','authenticated')::text,true);
 if public.direct_portal_me()->>'status'<>'sem_cadastro' then raise exception 'Conta viu dados de outra pessoa';end if;
 begin perform public.direct_portal_accept(other_oid,i2->>'vagas_token');raise exception 'FALHOU: sem cadastro conseguiu escala';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;end;
 result:=public.direct_portal_register('{"nome":"Outra pessoa sintética","cpf":"11144477735"}',i2->>'cadastro_token');
 if result->>'status'<>'ativo' then raise exception 'CPF sintético 2 já existe';end if;
 begin perform public.direct_portal_accept(oid,i2->>'vagas_token');raise exception 'FALHOU: vaga preenchida foi aceita';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;if sqlerrm not like '%não está mais disponível%' then raise;end if;end;
 begin perform public.direct_portal_approve(u1,true);raise exception 'FALHOU: diarista liberou outro acesso';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u3,'email','portal-teste-3@example.invalid','role','authenticated')::text,true);
 result:=public.direct_portal_register('{"nome":"Terceira pessoa sintética","cpf":"52998224725"}',i3->>'cadastro_token');
 if result->>'status'<>'pendente' then raise exception 'CPF existente foi apropriado';end if;
 if exists(select 1 from public.portal_cadastros where user_id=u3 and diarista_id is not null) then raise exception 'CPF existente vinculou sem aprovação';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u1,'email','portal-teste-1@example.invalid','role','authenticated')::text,true);
 update public.diaristas set bloqueada=true where id=w1;
 begin perform public.direct_portal_accept(other_oid,i1->>'vagas_token');raise exception 'FALHOU: bloqueado aceitou';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;if sqlerrm not like '%bloqueado%' then raise;end if;end;
 if public.direct_portal_me()->>'status'<>'bloqueado' then raise exception 'Bloqueio não aparece no portal';end if;
 update public.diaristas set bloqueada=false where id=w1;

 -- Escala de dois dias: um conflito impede todas as gravações.
 update public.pedidos set turnos=jsonb_build_array(jsonb_build_object('data',d+1,'inicio','07:00','fim','15:20'),jsonb_build_object('data',d,'inicio','08:00','fim','16:20')) where id=other_oid;
 begin perform public.direct_portal_accept(other_oid,i1->>'vagas_token');raise exception 'FALHOU: conflito parcial permitido';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;end;
 if exists(select 1 from public.pedido_escalas where pedido_id=other_oid) then raise exception 'Gravou parte da escala após conflito';end if;
 update public.pedidos set turnos=jsonb_build_array(jsonb_build_object('data',d+1,'inicio','07:00','fim','15:20'),jsonb_build_object('data',d+2,'inicio','07:00','fim','15:20')) where id=other_oid;
 result:=public.direct_portal_accept(other_oid,i1->>'vagas_token');
 if (result->>'dias')::int<>2 then raise exception 'Não gravou escala inteira';end if;
 begin perform public.direct_portal_orders(null);raise exception 'FALHOU: sem convite listou';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;end;
 begin perform public.direct_portal_orders(i1->>'cadastro_token');raise exception 'FALHOU: links não são separados';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;end;
 begin perform public.direct_portal_register('{"nome":"Outro acesso","cpf":"52998224725"}',i2->>'cadastro_token');raise exception 'FALHOU: convite de outro acesso aceito';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;end;
 update direct_private.portal_convites set expira_em=now()-interval '1 minute' where cadastro_hash=extensions.digest(i2->>'cadastro_token','sha256');
 begin perform public.direct_portal_orders(i2->>'vagas_token');raise exception 'FALHOU: convite vencido aceito';exception when others then if sqlerrm like 'FALHOU:%' then raise;end if;end;

 if has_table_privilege('anon','public.diaristas','select') or has_table_privilege('anon','public.portal_cadastros','select') or has_function_privilege('anon','public.direct_portal_accept(bigint,text)','execute') then raise exception 'Acesso anônimo indevido';end if;
 if has_function_privilege('authenticated','public.direct_portal_accept_internal(bigint,date[])','execute') or has_function_privilege('anon','public.direct_portal_orders_internal()','execute') or has_function_privilege('authenticated','public.direct_portal_register_internal(jsonb)','execute') then raise exception 'API antiga continua aberta';end if;
 -- Operação autoriza vínculo existente sem duplicar diarista.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u2,'email','portal-teste-2@example.invalid','role','authenticated')::text,true);
 insert into public.direct_staff(email,role,active) values('portal-teste-2@example.invalid','operacao',true);
 update public.portal_cadastros set diarista_id=null,status='recusado' where user_id=u1;
 perform public.direct_portal_approve(u3,true);
 if not exists(select 1 from public.portal_cadastros where user_id=u3 and diarista_id=w1 and status='ativo') then raise exception 'Liberação não vinculou cadastro existente';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u3,'email','portal-teste-3@example.invalid','role','authenticated')::text,true);
 if jsonb_array_length(public.direct_portal_me()->'escalas')<>3 then raise exception 'Escala vinculada não aparece no portal';end if;
 raise notice 'PORTAL OK: cadastro, idempotência, escala, confirmação, vagas, conflito, bloqueio, propriedade e permissões';
end $$;
rollback;
