create or replace function direct_private.validate_pedido_modelo() returns trigger language plpgsql security invoker set search_path='' as $$
declare t jsonb; n integer;
begin
 new.nome:=trim(new.nome);
 if jsonb_typeof(new.dados->'turnos') is distinct from 'array' then raise exception 'Modelo sem datas.';end if;
 if jsonb_array_length(new.dados->'turnos') not between 1 and 90 then raise exception 'Informe de 1 a 90 datas.';end if;
 if length(trim(coalesce(new.dados->>'setor',''))) not between 1 and 80 then raise exception 'Setor inválido.';end if;
 if not exists(select 1 from public.lojas where lower(rede)=lower(new.dados->>'supermercado') and lower(nome)=lower(new.dados->>'unidade')) then raise exception 'Escolha uma loja cadastrada.';end if;
 n:=(new.dados->>'quantidade_diaristas')::integer;if n is null or n not between 1 and 100 then raise exception 'Quantidade inválida.';end if;
 for t in select value from jsonb_array_elements(new.dados->'turnos') loop
  if jsonb_typeof(t)<>'object' or coalesce(t->>'data','') !~ '^\d{4}-\d{2}-\d{2}$' or (t->>'data')::date::text<>t->>'data'
   or coalesce(t->>'inicio','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(t->>'fim','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or t->>'inicio'>=t->>'fim' then raise exception 'Data ou horário inválido.';end if;
 end loop;
 if (select count(distinct x.value->>'data') from jsonb_array_elements(new.dados->'turnos') as x(value))<>jsonb_array_length(new.dados->'turnos') then raise exception 'Datas repetidas.';end if;
 if length(coalesce(new.dados->>'observacoes',''))>500 or length(coalesce(new.dados->>'contato',''))>180 then raise exception 'Texto muito longo.';end if;
 new.dados:=jsonb_build_object('supermercado',new.dados->>'supermercado','unidade',new.dados->>'unidade','setor',new.dados->>'setor','quantidade_diaristas',n,'contato',coalesce(new.dados->>'contato',''),'observacoes',coalesce(new.dados->>'observacoes',''),'situacao','novo','turnos',(select jsonb_agg(jsonb_build_object('data',x.value->>'data','inicio',x.value->>'inicio','fim',x.value->>'fim') order by x.value->>'data') from jsonb_array_elements(new.dados->'turnos') as x(value)));
 new.atualizado_em:=now();return new;
end;$$;
