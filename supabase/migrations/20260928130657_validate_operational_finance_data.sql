create or replace function public.direct_valid_cpf(value text)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare n integer; i integer; total integer; digit integer;
begin
  if value !~ '^[0-9]{11}$' or length(replace(value, left(value, 1), '')) = 0 then return false; end if;
  for n in 9..10 loop
    total := 0;
    for i in 1..n loop
      total := total + substring(value from i for 1)::integer * (n + 2 - i);
    end loop;
    digit := (total * 10) % 11;
    if (case when digit = 10 then 0 else digit end) <> substring(value from n + 1 for 1)::integer then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function public.direct_valid_sectors(value jsonb)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare item jsonb; names text[] := array[]::text[]; name text;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) not between 1 and 12 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'string' then return false; end if;
    name := btrim(item #>> '{}');
    if name is null or length(name) not between 1 and 60 or name = any(names) then return false; end if;
    names := array_append(names, name);
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.direct_valid_slots(value jsonb)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare item jsonb; days text[] := array[]::text[]; day_name text; start_time text; end_time text;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) not between 1 and 7 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object' then return false; end if;
    day_name := item->>'dia'; start_time := item->>'inicio'; end_time := item->>'fim';
    if day_name is null or start_time is null or end_time is null
      or day_name not in ('segunda','terca','quarta','quinta','sexta','sabado','domingo') or day_name = any(days)
      or start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or start_time >= end_time then return false; end if;
    days := array_append(days, day_name);
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.direct_valid_shifts(value jsonb)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare item jsonb; dates text[] := array[]::text[]; day_value text; start_time text; end_time text;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) not between 1 and 90 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object' then return false; end if;
    day_value := item->>'data'; start_time := item->>'inicio'; end_time := item->>'fim';
    if day_value is null or start_time is null or end_time is null
      or day_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(day_value::date, 'YYYY-MM-DD') <> day_value
      or day_value = any(dates)
      or start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or start_time >= end_time then return false; end if;
    dates := array_append(dates, day_value);
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter table public.diaristas
  add constraint direct_diaristas_valid_cpf check (public.direct_valid_cpf(cpf)),
  add constraint direct_diaristas_valid_sectors check (public.direct_valid_sectors(setores)),
  add constraint direct_diaristas_valid_slots check (public.direct_valid_slots(disponibilidade)),
  add constraint direct_diaristas_valid_fields check (
    length(btrim(nome)) between 1 and 180 and cep ~ '^[0-9]{8}$'
    and length(btrim(logradouro)) between 1 and 180 and length(btrim(numero)) between 1 and 30
    and length(btrim(bairro)) between 1 and 100 and length(complemento) <= 120
    and cidade = 'Fortaleza' and uf = 'CE'
    and (not trabalhando or length(btrim(local_trabalho)) between 1 and 180)
    and (not pode_se_deslocar or length(btrim(transporte)) between 1 and 80)
    and length(observacoes_locomocao) <= 300
  );

alter table public.pedidos
  add constraint direct_pedidos_valid_shifts check (public.direct_valid_shifts(turnos)),
  add constraint direct_pedidos_valid_fields check (
    length(btrim(supermercado)) between 1 and 180 and length(btrim(setor)) between 1 and 80
    and length(unidade) <= 180 and length(contato) <= 180 and length(observacoes) <= 500
  );

alter table public.lojas
  add constraint direct_lojas_valid_fields check (
    rede in ('Super do Povo','Super Lagoa','Fazendinha','Hipermarket','Pinheiro','Variedades')
    and length(btrim(nome)) between 1 and 120 and length(btrim(endereco)) between 1 and 250
    and length(bairro) <= 100 and length(btrim(cidade)) between 1 and 80 and uf = 'CE'
    and length(observacao) <= 400 and length(fonte_url) <= 500
    and (fonte_url = '' or fonte_url ~ '^https://[^[:space:]]+$')
  );

alter table public.diarias add column motivo_ajuste text not null default '';
alter table public.financeiro_lancamentos add column motivo_ajuste text not null default '';

alter table public.diarias
  add constraint direct_diarias_paid_has_amount check (data_pagamento is null or valor_centavos is not null),
  add constraint direct_diarias_valid_fields check (
    length(btrim(local)) between 1 and 180 and length(btrim(setor)) between 1 and 80
    and length(observacoes) <= 500 and length(forma_pagamento) <= 80
    and length(motivo_ajuste) <= 300 and (valor_centavos is null or valor_centavos <= 10000000000)
  ),
  add constraint direct_diarias_pending_has_due check (
    valor_centavos is null or data_pagamento is not null or vencimento_pagamento is not null
  ) not valid;

alter table public.financeiro_lancamentos
  add constraint direct_finance_valid_fields check (
    length(btrim(descricao)) between 1 and 180 and length(btrim(categoria)) between 1 and 80
    and length(btrim(contraparte)) between 1 and 180 and length(forma_pagamento) <= 80
    and length(observacoes) <= 500 and length(motivo_ajuste) <= 300
    and valor_centavos <= 10000000000
  );

create or replace function public.direct_guard_finance_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.data_pagamento is not null then
      raise exception 'Este lançamento já foi liquidado. Registre uma correção com motivo.';
    end if;
    return old;
  end if;
  if old.data_pagamento is not null
    and (to_jsonb(new) - 'atualizado_em' - 'motivo_ajuste') is distinct from (to_jsonb(old) - 'atualizado_em' - 'motivo_ajuste')
    and (new.motivo_ajuste = old.motivo_ajuste or length(btrim(new.motivo_ajuste)) < 8) then
    raise exception 'Explique a correção do lançamento já liquidado (mínimo de 8 caracteres).';
  end if;
  return new;
end;
$$;
create trigger guard_finance_change before update or delete on public.financeiro_lancamentos
for each row execute function public.direct_guard_finance_change();

create or replace function public.direct_guard_paid_daily_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.data_pagamento is not null
    and (to_jsonb(new) - 'motivo_ajuste') is distinct from (to_jsonb(old) - 'motivo_ajuste')
    and (new.motivo_ajuste = old.motivo_ajuste or length(btrim(new.motivo_ajuste)) < 8) then
    raise exception 'Explique a correção da diária já paga (mínimo de 8 caracteres).';
  end if;
  return new;
end;
$$;
create trigger guard_paid_daily_change before update on public.diarias
for each row execute function public.direct_guard_paid_daily_change();

revoke all on public.diaristas, public.diarias, public.financeiro_lancamentos,
  public.pedidos, public.pedido_escalas, public.lojas from anon, authenticated;
grant select, insert, update, delete on public.diaristas, public.diarias, public.financeiro_lancamentos,
  public.pedidos, public.pedido_escalas, public.lojas to authenticated;
revoke execute on function public.direct_guard_finance_change(), public.direct_guard_paid_daily_change()
  from public, anon, authenticated;
