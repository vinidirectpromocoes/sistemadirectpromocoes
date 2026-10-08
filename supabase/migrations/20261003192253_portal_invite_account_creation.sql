-- Conta criada exclusivamente no servidor mediante convite da Direct, sem SMTP.
alter table direct_private.portal_convites add column signup_email text, add column signup_nonce uuid, add column signup_em timestamptz, add column signup_attempts integer not null default 0;
create function public.direct_portal_signup_prepare(p_convite text,p_email text,p_cpf text,p_nome text) returns uuid language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;n uuid:=gen_random_uuid();
begin
 i:=direct_private.portal_invite(p_convite,'cadastro');select * into i from direct_private.portal_convites where id=i.id for update;
 if not public.direct_valid_cpf(p_cpf) or p_nome is null or length(btrim(p_nome)) not between 3 and 180 then raise exception 'Confira nome e CPF.';end if;
 if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Confira o e-mail.';end if;
 if i.cpf is not null and i.cpf<>p_cpf then raise exception 'O CPF não corresponde ao convite enviado pela Direct.';end if;
 if i.usado_por is not null then raise exception 'Este convite já foi usado. Entre com sua conta cadastrada.';end if;
 if i.signup_nonce is not null and i.signup_em>now()-interval '5 minutes' then raise exception 'Cadastro em processamento. Aguarde e tente entrar.';end if;
 if i.signup_attempts>=3 then raise exception 'Peça um novo convite à Direct para concluir seu cadastro.';end if;
 update direct_private.portal_convites set signup_email=lower(btrim(p_email)),signup_nonce=n,signup_em=now(),signup_attempts=signup_attempts+1 where id=i.id;
 return n;
end $$;
create function public.direct_portal_signup_finish(p_convite text,p_nonce uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;
begin
 i:=direct_private.portal_invite(p_convite,'cadastro');select * into i from direct_private.portal_convites where id=i.id for update;
 if p_nonce is null or i.signup_nonce is distinct from p_nonce or i.usado_por is not null or not exists(select 1 from auth.users where id=p_user_id and lower(email)=i.signup_email and raw_app_meta_data->>'direct_invite_signup'=p_nonce::text) then raise exception 'Não foi possível vincular o convite. Peça ajuda à Direct.';end if;
 update direct_private.portal_convites set usado_por=p_user_id,signup_nonce=null where id=i.id;
end $$;
create function public.direct_portal_signup_release(p_convite text,p_nonce uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update direct_private.portal_convites set signup_nonce=null,signup_email=null where cadastro_hash=extensions.digest(p_convite,'sha256') and signup_nonce=p_nonce and usado_por is null;
end $$;
revoke all on function public.direct_portal_signup_prepare(text,text,text,text),public.direct_portal_signup_finish(text,uuid,uuid),public.direct_portal_signup_release(text,uuid) from public,anon,authenticated;
grant execute on function public.direct_portal_signup_prepare(text,text,text,text),public.direct_portal_signup_finish(text,uuid,uuid),public.direct_portal_signup_release(text,uuid) to service_role;
