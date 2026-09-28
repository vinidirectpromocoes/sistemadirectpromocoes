alter table public.tarifas_setores alter column rede drop not null;
alter table public.tarifas_setores alter column valor_pago_centavos drop not null;

drop index public.tarifas_setores_rede_setor_ci;
create unique index tarifas_setores_rede_setor_ci
  on public.tarifas_setores (rede, lower(setor)) where rede is not null;
create unique index tarifas_setores_geral_ci
  on public.tarifas_setores (lower(setor)) where rede is null;

insert into public.tarifas_setores (rede, setor, valor_pago_centavos) values
  (null, 'Operador de caixa', null),
  (null, 'Repositor de mercearia', null),
  (null, 'Repositor de FLV', null),
  (null, 'Repositor de frios', null),
  (null, 'Balconista de padaria', null),
  (null, 'Balconista de frios', null),
  (null, 'Balconista de açougue', null),
  (null, 'Auxiliar de depósito', null),
  (null, 'ASG', null),
  (null, 'Açougueiro', null)
on conflict do nothing;
