create or replace function public.direct_portal_register(p_dados jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=direct_private.portal_user(); w public.diaristas%rowtype; existing public.portal_cadastros%rowtype;
 v_nome text:=btrim(p_dados->>'nome'); v_cpf text:=regexp_replace(coalesce(p_dados->>'cpf',''),'\D','','g'); v_mail text;
begin
 if v_nome is null or length(v_nome) not between 3 and 180 or not public.direct_valid_cpf(v_cpf) then raise exception 'Confira o nome completo e o CPF válido.'; end if;
 if jsonb_typeof(p_dados) is distinct from 'object' or length(p_dados::text)>12000 then raise exception 'Cadastro inválido.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_cpf,0));
 select * into existing from public.portal_cadastros where user_id=uid for update;
 if existing.user_id is not null then
  if existing.cpf<>v_cpf then raise exception 'Este acesso já está vinculado a outro cadastro.'; end if;
  return jsonb_build_object('status',existing.status,'nome',existing.nome);
 end if;
 select email into v_mail from auth.users where id=uid;
 select * into w from public.diaristas where diaristas.cpf=v_cpf for update;
 if w.id is null then
  insert into public.diaristas(nome,cpf,setores,bairro,logradouro,numero,cep,complemento,transporte)
  values(v_nome,v_cpf,coalesce(p_dados->'setores','[]'::jsonb),coalesce(p_dados->>'bairro',''),coalesce(p_dados->>'logradouro',''),coalesce(p_dados->>'numero',''),regexp_replace(coalesce(p_dados->>'cep',''),'\D','','g'),coalesce(p_dados->>'complemento',''),coalesce(p_dados->>'transporte','')) returning * into w;
  insert into public.portal_cadastros(user_id,diarista_id,nome,cpf,email,dados,status) values(uid,w.id,v_nome,v_cpf,v_mail,p_dados,'ativo');
  return jsonb_build_object('status','ativo','nome',v_nome);
 end if;
 -- Não revela o nome do titular nem vincula por conhecimento do CPF.
 insert into public.portal_cadastros(user_id,nome,cpf,email,dados,status) values(uid,v_nome,v_cpf,v_mail,p_dados,'pendente');
 return jsonb_build_object('status','pendente','nome',v_nome);
end $$;

create or replace function public.direct_portal_approve(p_user_id uuid,p_aprovar boolean) returns void language plpgsql security definer set search_path='' as $$
declare c public.portal_cadastros%rowtype; w public.diaristas%rowtype;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para conferir acessos.'; end if;
 select * into c from public.portal_cadastros where user_id=p_user_id for update;
 if c.status is distinct from 'pendente' then raise exception 'Solicitação já conferida ou não encontrada.'; end if;
 if p_aprovar is null then raise exception 'Informe a decisão de acesso.'; end if;
 if not p_aprovar then update public.portal_cadastros set status='recusado',atualizado_em=now() where user_id=p_user_id; return; end if;
 select * into w from public.diaristas where cpf=c.cpf for update;
 if w.id is null or w.bloqueada then raise exception 'Cadastro não encontrado ou bloqueado.'; end if;
 if exists(select 1 from public.portal_cadastros where diarista_id=w.id) then raise exception 'Esta pessoa já tem outro acesso vinculado. Confira com a Direct.'; end if;
 update public.portal_cadastros set diarista_id=w.id,status='ativo',atualizado_em=now() where user_id=p_user_id;
end $$;
