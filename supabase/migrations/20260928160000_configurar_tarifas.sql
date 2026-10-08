create table public.tarifas_redes (
  id bigint generated always as identity primary key,
  rede text not null unique,
  valor_recebido_centavos integer not null check (valor_recebido_centavos > 0),
  valor_padrao_centavos integer not null check (valor_padrao_centavos > 0),
  atualizado_em timestamptz not null default now()
);

create table public.tarifas_setores (
  id bigint generated always as identity primary key,
  rede text not null references public.tarifas_redes(rede) on update cascade,
  setor text not null check (length(btrim(setor)) between 1 and 80 and setor = btrim(setor)),
  valor_pago_centavos integer not null check (valor_pago_centavos > 0),
  atualizado_em timestamptz not null default now()
);
create unique index tarifas_setores_rede_setor_ci on public.tarifas_setores (rede, lower(setor));

insert into public.tarifas_redes (rede, valor_recebido_centavos, valor_padrao_centavos) values
  ('Hipermarket', 12400, 8500),
  ('Super do Povo', 13400, 9000),
  ('Super Lagoa', 13400, 9000),
  ('Fazendinha', 12900, 8500),
  ('Pinheiro', 13400, 9000),
  ('Variedades', 13400, 9000);

alter table public.tarifas_redes enable row level security;
alter table public.tarifas_setores enable row level security;
revoke all on public.tarifas_redes, public.tarifas_setores from anon, authenticated;
grant select, update on public.tarifas_redes to authenticated;
grant select, insert, update, delete on public.tarifas_setores to authenticated;
grant usage, select on sequence public.tarifas_setores_id_seq to authenticated;

create policy "admin manages network rates" on public.tarifas_redes for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));
create policy "admin manages sector rates" on public.tarifas_setores for all to authenticated
  using ((select direct_private.is_admin())) with check ((select direct_private.is_admin()));

create trigger audit_tarifas_redes after update on public.tarifas_redes
for each row execute function direct_private.log_change();
create trigger audit_tarifas_setores after insert or update or delete on public.tarifas_setores
for each row execute function direct_private.log_change();
