-- Origem protegida: somente novos cadastros efetivamente enviados pelo formulário.
create table direct_private.portal_registros (
 diarista_id bigint primary key references public.diaristas(id) on delete cascade,
 convite_id uuid references direct_private.portal_convites(id) on delete set null,
 registrado_em timestamptz not null default now()
);
alter table direct_private.portal_registros enable row level security;
revoke all on direct_private.portal_registros from public,anon,authenticated;
create index portal_registros_data_idx on direct_private.portal_registros(registrado_em desc,diarista_id desc);
create index portal_registros_convite_idx on direct_private.portal_registros(convite_id);

create or replace function public.direct_portal_submit(p_dados jsonb,p_convite text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i direct_private.portal_convites%rowtype;w public.diaristas%rowtype;
 n text:=btrim(p_dados->>'nome');c text:=regexp_replace(coalesce(p_dados->>'cpf',''),'\D','','g');birth date;work boolean;travel boolean;
begin
 i:=direct_private.portal_invite(p_convite,'cadastro');
 select * into i from direct_private.portal_convites where id=i.id for update;
 if jsonb_typeof(p_dados) is distinct from 'object' or length(p_dados::text)>12000 or n is null or length(n) not between 3 and 180 or not public.direct_valid_cpf(c) then raise exception 'Confira o nome completo e o CPF válido.';end if;
 if i.cpf is not null and i.cpf<>c then raise exception 'O CPF não corresponde ao convite enviado pela Direct.';end if;
 if i.diarista_id is not null then
  if not exists(select 1 from public.diaristas where id=i.diarista_id and cpf=c and not bloqueada) then raise exception 'Este link pertence a outro cadastro ou está bloqueado. Fale com a Direct.';end if;
  return public.direct_portal_context(p_convite,'cadastro');
 end if;
 if (p_dados->>'data_nascimento') is null or (p_dados->>'data_nascimento') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Informe sua data de nascimento.';end if;
 birth:=(p_dados->>'data_nascimento')::date;
 if birth not between date '1900-01-01' and current_date then raise exception 'Confira a data de nascimento.';end if;
 if not coalesce(public.direct_valid_sectors(p_dados->'setores'),false) or not coalesce(public.direct_valid_slots(p_dados->'disponibilidade'),false) then raise exception 'Marque os setores e os dias com horários disponíveis.';end if;
 if jsonb_typeof(p_dados->'trabalhando') is distinct from 'boolean' or jsonb_typeof(p_dados->'pode_se_deslocar') is distinct from 'boolean' or (p_dados->'consentimento') is distinct from 'true'::jsonb then raise exception 'Responda sobre trabalho, locomoção e confirme as informações.';end if;
 work:=(p_dados->>'trabalhando')::boolean;travel:=(p_dados->>'pode_se_deslocar')::boolean;
 if coalesce(p_dados->>'cep','') !~ '^\d{8}$' or length(btrim(coalesce(p_dados->>'numero',''))) not between 1 and 30 or length(btrim(coalesce(p_dados->>'logradouro',''))) not between 1 and 180 or length(btrim(coalesce(p_dados->>'bairro',''))) not between 1 and 100 or length(btrim(coalesce(p_dados->>'cidade',''))) not between 1 and 80 or coalesce(p_dados->>'uf','') !~ '^[A-Z]{2}$' then raise exception 'Confira o CEP, endereço, cidade e número da casa.';end if;
 if length(btrim(coalesce(p_dados->>'transporte',''))) not between 1 and 80 or (not travel and length(btrim(coalesce(p_dados->>'observacoes_locomocao',''))) not between 1 and 300) then raise exception 'Informe os meios de transporte e as regiões que pode atender.';end if;
 if work and (length(btrim(coalesce(p_dados->>'local_trabalho',''))) not between 1 and 180 or length(btrim(coalesce(p_dados->>'rede_trabalho',''))) not between 1 and 100) then raise exception 'Informe onde trabalha e a empresa ou rede.';end if;
 perform pg_advisory_xact_lock(hashtextextended(c,0));
 select * into w from public.diaristas where cpf=c for update;
 if w.id is not null then
  if i.cpf is null or w.bloqueada then raise exception 'Este CPF já tem cadastro. Peça à Direct um link vinculado ao seu CPF.';end if;
 else
  insert into public.diaristas(nome,cpf,data_nascimento,setores,cep,logradouro,numero,complemento,bairro,cidade,uf,trabalhando,rede_trabalho,local_trabalho,disponibilidade,pode_se_deslocar,transporte,observacoes_locomocao)
  values(n,c,birth,p_dados->'setores',p_dados->>'cep',btrim(p_dados->>'logradouro'),btrim(p_dados->>'numero'),coalesce(p_dados->>'complemento',''),btrim(p_dados->>'bairro'),btrim(p_dados->>'cidade'),p_dados->>'uf',work,case when work then p_dados->>'rede_trabalho' else '' end,case when work then btrim(p_dados->>'local_trabalho') else '' end,p_dados->'disponibilidade',travel,p_dados->>'transporte',coalesce(p_dados->>'observacoes_locomocao','')) returning * into w;
  insert into direct_private.portal_registros(diarista_id,convite_id) values(w.id,i.id);
 end if;
 update direct_private.portal_convites set diarista_id=w.id,cpf=c where id=i.id;
 return public.direct_portal_context(p_convite,'cadastro');
end $$;

create function public.direct_portal_registrations(p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(direct_private.member_role(),'') not in ('admin','operacao') then raise exception 'Sem permissão para acompanhar os cadastros.';end if;
 if p_offset is null or p_offset<0 then raise exception 'Página inválida.';end if;
 select jsonb_build_object('total',(select count(*) from direct_private.portal_registros),
 'items',coalesce((select jsonb_agg(to_jsonb(t) order by t.registrado_em desc,t.id desc) from (
 select w.id,w.nome,w.cpf,w.bairro,w.cidade,w.bloqueada,r.registrado_em
 from direct_private.portal_registros r join public.diaristas w on w.id=r.diarista_id
 order by r.registrado_em desc,w.id desc limit 20 offset p_offset) t),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.direct_portal_registrations(integer) from public,anon,authenticated;
grant execute on function public.direct_portal_registrations(integer) to authenticated;
notify pgrst,'reload schema';
