-- Cobranças e fechamentos mantêm vínculos com cada presença confirmada.
create table public.cobrancas (
  id bigint generated always as identity primary key,
  rede text not null check (length(btrim(rede)) between 1 and 180),
  periodo_inicio date not null,
  periodo_fim date not null,
  vencimento date not null,
  numero_nota text not null default '' check (length(numero_nota) <= 80),
  valor_centavos bigint not null check (valor_centavos > 0),
  status text not null default 'aberta' check (status in ('aberta', 'cancelada')),
  motivo_cancelamento text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (periodo_inicio <= periodo_fim)
);
create index cobrancas_rede_periodo on public.cobrancas (rede, periodo_inicio, periodo_fim);

create table public.cobranca_itens (
  id bigint generated always as identity primary key,
  cobranca_id bigint not null references public.cobrancas(id) on delete restrict,
  diaria_id bigint not null unique references public.diarias(id) on delete restrict,
  pedido_id bigint not null references public.pedidos(id) on delete restrict,
  data date not null,
  valor_centavos bigint not null check (valor_centavos > 0)
);
create index cobranca_itens_cobranca on public.cobranca_itens (cobranca_id);

create table public.cobranca_recebimentos (
  id bigint generated always as identity primary key,
  cobranca_id bigint not null references public.cobrancas(id) on delete restrict,
  valor_centavos bigint not null check (valor_centavos > 0),
  data_recebimento date not null,
  forma text not null default '' check (length(forma) <= 80),
  estornado boolean not null default false,
  motivo_estorno text not null default '',
  criado_em timestamptz not null default now()
);
create index cobranca_recebimentos_cobranca on public.cobranca_recebimentos (cobranca_id);

create table public.pagamento_lotes (
  id bigint generated always as identity primary key,
  diarista_id bigint not null references public.diaristas(id) on delete restrict,
  valor_centavos bigint not null check (valor_centavos > 0),
  data_pagamento date not null,
  forma text not null default '' check (length(forma) <= 80),
  quantidade integer not null check (quantidade > 0),
  status text not null default 'pago' check (status in ('pago', 'reaberto')),
  motivo_reabertura text not null default '',
  criado_em timestamptz not null default now()
);
alter table public.diarias add column pagamento_lote_id bigint references public.pagamento_lotes(id) on delete restrict;
create index diarias_pagamento_lote on public.diarias (pagamento_lote_id);

alter table public.cobrancas enable row level security;
alter table public.cobranca_itens enable row level security;
alter table public.cobranca_recebimentos enable row level security;
alter table public.pagamento_lotes enable row level security;
revoke all on public.cobrancas, public.cobranca_itens, public.cobranca_recebimentos, public.pagamento_lotes from anon, authenticated;
grant select on public.cobrancas, public.cobranca_itens, public.cobranca_recebimentos, public.pagamento_lotes to authenticated;
create policy "finance reads invoices" on public.cobrancas for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "finance reads invoice items" on public.cobranca_itens for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "finance reads receipts" on public.cobranca_recebimentos for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));
create policy "finance reads payment batches" on public.pagamento_lotes for select to authenticated
  using ((select direct_private.member_role()) in ('admin','financeiro'));

-- Escritas passam somente pelas funções transacionais com verificação explícita de perfil.
create function public.direct_create_invoice(p_rede text, p_inicio date, p_fim date, p_vencimento date, p_numero_nota text default '')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_total bigint; v_missing integer;
begin
  if coalesce(direct_private.member_role(), '') not in ('admin','financeiro') then raise exception 'Acesso negado.'; end if;
  if p_inicio is null or p_fim is null or p_vencimento is null or p_inicio > p_fim or p_fim - p_inicio > 365
    or length(btrim(coalesce(p_rede,''))) not between 1 and 180 or length(coalesce(p_numero_nota,'')) > 80 then
    raise exception 'Confira rede, período, vencimento e número da nota.';
  end if;
  -- Bloqueia as diárias para que dois fechamentos simultâneos não usem a mesma presença.
  perform 1 from public.diarias d
    join public.pedido_escalas e on e.id = d.pedido_escala_id
    join public.pedidos p on p.id = e.pedido_id
    where lower(p.supermercado) = lower(btrim(p_rede)) and d.data between p_inicio and p_fim
      and e.status = 'presente' and not exists (select 1 from public.cobranca_itens i where i.diaria_id = d.id)
    for update of d;
  select count(*) filter (where d.valor_recebido_centavos is null), coalesce(sum(d.valor_recebido_centavos),0)
    into v_missing, v_total from public.diarias d
    join public.pedido_escalas e on e.id = d.pedido_escala_id
    join public.pedidos p on p.id = e.pedido_id
    where lower(p.supermercado) = lower(btrim(p_rede)) and d.data between p_inicio and p_fim
      and e.status = 'presente' and not exists (select 1 from public.cobranca_itens i where i.diaria_id = d.id);
  if v_missing > 0 then raise exception '% presença(s) sem valor recebido configurado. Corrija antes da cobrança.', v_missing; end if;
  if v_total <= 0 then raise exception 'Nenhuma presença nova com valor encontrado nesse período.'; end if;
  insert into public.cobrancas (rede, periodo_inicio, periodo_fim, vencimento, numero_nota, valor_centavos)
    values (btrim(p_rede), p_inicio, p_fim, p_vencimento, btrim(coalesce(p_numero_nota,'')), v_total) returning id into v_id;
  insert into public.cobranca_itens (cobranca_id, diaria_id, pedido_id, data, valor_centavos)
    select v_id, d.id, e.pedido_id, d.data, d.valor_recebido_centavos
    from public.diarias d join public.pedido_escalas e on e.id = d.pedido_escala_id
    join public.pedidos p on p.id = e.pedido_id
    where lower(p.supermercado) = lower(btrim(p_rede)) and d.data between p_inicio and p_fim
      and e.status = 'presente' and not exists (select 1 from public.cobranca_itens i where i.diaria_id = d.id);
  return v_id;
exception when unique_violation then raise exception 'Uma diária deste período já foi incluída em outra cobrança. Atualize e tente novamente.';
end;
$$;

create function public.direct_receive_invoice(p_id bigint, p_valor_centavos bigint, p_data date, p_forma text default '')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v public.cobrancas%rowtype; v_received bigint; v_id bigint;
begin
  if coalesce(direct_private.member_role(), '') not in ('admin','financeiro') then raise exception 'Acesso negado.'; end if;
  select * into v from public.cobrancas where id = p_id for update;
  if not found or v.status <> 'aberta' then raise exception 'Cobrança não encontrada ou cancelada.'; end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 or p_data is null or length(coalesce(p_forma,'')) > 80 then
    raise exception 'Confira o valor, a data e a forma de recebimento.';
  end if;
  select coalesce(sum(valor_centavos),0) into v_received from public.cobranca_recebimentos where cobranca_id = p_id and not estornado;
  if v_received + p_valor_centavos > v.valor_centavos then raise exception 'O recebimento ultrapassa o saldo da cobrança.'; end if;
  insert into public.cobranca_recebimentos (cobranca_id, valor_centavos, data_recebimento, forma)
    values (p_id, p_valor_centavos, p_data, coalesce(p_forma,'')) returning id into v_id;
  return v_id;
end;
$$;

create function public.direct_void_invoice_receipt(p_id bigint, p_motivo text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.cobranca_recebimentos%rowtype;
begin
  if coalesce(direct_private.member_role(), '') not in ('admin','financeiro') then raise exception 'Acesso negado.'; end if;
  select * into v from public.cobranca_recebimentos where id = p_id for update;
  if not found or v.estornado then raise exception 'Recebimento não encontrado ou já estornado.'; end if;
  if length(btrim(coalesce(p_motivo,''))) < 8 then raise exception 'Explique o estorno com pelo menos 8 caracteres.'; end if;
  update public.cobranca_recebimentos set estornado = true, motivo_estorno = btrim(p_motivo) where id = p_id;
  return true;
end;
$$;

create function public.direct_cancel_invoice(p_id bigint, p_motivo text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.cobrancas%rowtype;
begin
  if coalesce(direct_private.member_role(), '') not in ('admin','financeiro') then raise exception 'Acesso negado.'; end if;
  select * into v from public.cobrancas where id = p_id for update;
  if not found or v.status <> 'aberta' then raise exception 'Cobrança não encontrada ou já cancelada.'; end if;
  if length(btrim(coalesce(p_motivo,''))) < 8 then raise exception 'Explique o cancelamento com pelo menos 8 caracteres.'; end if;
  if exists (select 1 from public.cobranca_recebimentos where cobranca_id = p_id and not estornado) then
    raise exception 'Esta cobrança já recebeu valores. Corrija o recebimento antes de cancelar.';
  end if;
  delete from public.cobranca_itens where cobranca_id = p_id;
  update public.cobrancas set status = 'cancelada', motivo_cancelamento = btrim(p_motivo), atualizado_em = now() where id = p_id;
  return true;
end;
$$;

create function public.direct_pay_daily_batch(p_diarista_id bigint, p_diaria_ids bigint[], p_data date, p_forma text default '')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_total bigint; v_id bigint;
begin
  if coalesce(direct_private.member_role(), '') not in ('admin','financeiro') then raise exception 'Acesso negado.'; end if;
  if p_diarista_id is null or p_data is null or p_diaria_ids is null or cardinality(p_diaria_ids) not between 1 and 500
    or length(coalesce(p_forma,'')) > 80 then raise exception 'Confira a diarista, as diárias, a data e a forma de pagamento.'; end if;
  perform 1 from public.diarias where id = any(p_diaria_ids) for update;
  select count(*), coalesce(sum(valor_centavos),0) into v_count, v_total
    from public.diarias where id = any(p_diaria_ids) and diarista_id = p_diarista_id
      and data_pagamento is null and pagamento_lote_id is null and valor_centavos > 0;
  if v_count <> cardinality(p_diaria_ids) then raise exception 'Uma das diárias já foi paga, está sem valor ou pertence a outra pessoa.'; end if;
  insert into public.pagamento_lotes (diarista_id, valor_centavos, data_pagamento, forma, quantidade)
    values (p_diarista_id, v_total, p_data, coalesce(p_forma,''), v_count) returning id into v_id;
  update public.diarias set data_pagamento = p_data, forma_pagamento = coalesce(p_forma,''), pagamento_lote_id = v_id
    where id = any(p_diaria_ids);
  return v_id;
end;
$$;

create function public.direct_reopen_payment_batch(p_id bigint, p_motivo text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.pagamento_lotes%rowtype;
begin
  if coalesce(direct_private.member_role(), '') not in ('admin','financeiro') then raise exception 'Acesso negado.'; end if;
  select * into v from public.pagamento_lotes where id = p_id for update;
  if not found or v.status <> 'pago' then raise exception 'Fechamento não encontrado ou já reaberto.'; end if;
  if length(btrim(coalesce(p_motivo,''))) < 8 then raise exception 'Explique a reabertura com pelo menos 8 caracteres.'; end if;
  update public.pagamento_lotes set status = 'reaberto', motivo_reabertura = btrim(p_motivo) where id = p_id;
  update public.diarias set data_pagamento = null, pagamento_lote_id = null,
    motivo_ajuste = btrim(p_motivo) where pagamento_lote_id = p_id;
  return true;
end;
$$;

create function direct_private.guard_batch_daily()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.pagamento_lote_id is not null and
    (new.data_pagamento, new.valor_centavos, new.forma_pagamento, new.pagamento_lote_id)
    is distinct from (old.data_pagamento, old.valor_centavos, old.forma_pagamento, old.pagamento_lote_id)
    and (select status from public.pagamento_lotes where id = old.pagamento_lote_id) = 'pago' then
    raise exception 'Reabra o fechamento para corrigir uma diária paga em lote.';
  end if;
  return new;
end;
$$;
create trigger guard_batch_daily before update on public.diarias
  for each row execute function direct_private.guard_batch_daily();

create function direct_private.guard_billed_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'presente' and new.status <> 'presente' and exists (
    select 1 from public.diarias d join public.cobranca_itens i on i.diaria_id = d.id
    where d.pedido_escala_id = old.id
  ) then raise exception 'Esta presença já foi cobrada. Cancele a cobrança antes de corrigir a falta.'; end if;
  return new;
end;
$$;
create trigger guard_billed_attendance before update of status on public.pedido_escalas
  for each row execute function direct_private.guard_billed_attendance();

-- Todo ajuste operacional ou financeiro aparece no histórico existente.
create trigger audit_orders after insert or update or delete on public.pedidos
  for each row execute function direct_private.log_change();
create trigger audit_workers after insert or update or delete on public.diaristas
  for each row execute function direct_private.log_change();
create trigger audit_invoices after insert or update or delete on public.cobrancas
  for each row execute function direct_private.log_change();
create trigger audit_invoice_items after insert or update or delete on public.cobranca_itens
  for each row execute function direct_private.log_change();
create trigger audit_receipts after insert or update or delete on public.cobranca_recebimentos
  for each row execute function direct_private.log_change();
create trigger audit_payment_batches after insert or update or delete on public.pagamento_lotes
  for each row execute function direct_private.log_change();

revoke execute on function public.direct_create_invoice(text,date,date,date,text),
  public.direct_receive_invoice(bigint,bigint,date,text), public.direct_void_invoice_receipt(bigint,text), public.direct_cancel_invoice(bigint,text),
  public.direct_pay_daily_batch(bigint,bigint[],date,text), public.direct_reopen_payment_batch(bigint,text)
  from public, anon;
grant execute on function public.direct_create_invoice(text,date,date,date,text),
  public.direct_receive_invoice(bigint,bigint,date,text), public.direct_void_invoice_receipt(bigint,text), public.direct_cancel_invoice(bigint,text),
  public.direct_pay_daily_batch(bigint,bigint[],date,text), public.direct_reopen_payment_batch(bigint,text)
  to authenticated;
revoke all on function direct_private.guard_batch_daily() from public, anon, authenticated;
revoke all on function direct_private.guard_billed_attendance() from public, anon, authenticated;
