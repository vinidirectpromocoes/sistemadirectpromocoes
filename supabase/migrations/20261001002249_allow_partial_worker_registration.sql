-- Cadastros podem começar por nome e CPF. Informações não recebidas não viram respostas falsas.
alter table public.diaristas
  alter column cep set default '',
  alter column logradouro set default '',
  alter column numero set default '',
  alter column bairro set default '',
  alter column trabalhando drop not null,
  alter column trabalhando set default null,
  alter column pode_se_deslocar drop not null,
  alter column pode_se_deslocar set default null,
  drop constraint direct_diaristas_valid_sectors,
  drop constraint direct_diaristas_valid_slots,
  drop constraint direct_diaristas_valid_fields;

alter table public.diaristas
  add constraint direct_diaristas_valid_sectors check (setores = '[]'::jsonb or public.direct_valid_sectors(setores)),
  add constraint direct_diaristas_valid_slots check (disponibilidade = '[]'::jsonb or public.direct_valid_slots(disponibilidade)),
  add constraint direct_diaristas_valid_fields check (
    length(btrim(nome)) between 1 and 180
    and (cep = '' or cep ~ '^[0-9]{8}$')
    and length(logradouro) <= 180 and length(numero) <= 30
    and length(bairro) <= 100 and length(complemento) <= 120
    and cidade = 'Fortaleza' and uf = 'CE'
    and length(local_trabalho) <= 180 and length(transporte) <= 80
    and length(observacoes_locomocao) <= 300
  );
-- CPF válido, unicidade, vínculos, auditoria e políticas de acesso permanecem ativos.
