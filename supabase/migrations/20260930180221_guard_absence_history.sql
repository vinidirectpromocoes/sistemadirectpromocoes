-- Não permita alterar a justificativa/autoria ao atualizar o vínculo da substituta.
create or replace function direct_private.record_absence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'falta' and (tg_op = 'INSERT' or old.status <> 'falta') then
    if length(btrim(coalesce(new.falta_motivo, ''))) < 5 or length(new.falta_motivo) > 300 then
      raise exception 'Informe o motivo da falta com 5 a 300 caracteres.';
    end if;
    new.falta_confirmada_por := (select auth.jwt() ->> 'email');
    new.falta_confirmada_em := now();
  elsif tg_op = 'UPDATE' and old.status = 'falta' and new.status <> 'falta' then
    new.falta_motivo := null;
    new.falta_confirmada_por := null;
    new.falta_confirmada_em := null;
    new.substituida_por_escala_id := null;
  elsif tg_op = 'UPDATE' and old.status = 'falta' and new.status = 'falta' then
    if (new.falta_motivo, new.falta_confirmada_por, new.falta_confirmada_em)
       is distinct from (old.falta_motivo, old.falta_confirmada_por, old.falta_confirmada_em) then
      raise exception 'Histórico da falta não pode ser alterado diretamente.';
    end if;
  end if;
  return new;
end;
$$;

create function direct_private.guard_substitute_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.substituida_por_escala_id is not null and
     (new.status <> 'falta' or not exists (
       select 1 from public.pedido_escalas s
       where s.id = new.substituida_por_escala_id and s.pedido_id = new.pedido_id
         and s.data = new.data and s.status <> 'falta'
     )) then
    raise exception 'A substituta deve estar ativa no mesmo pedido e dia da falta.';
  end if;
  return new;
end;
$$;
create trigger guard_substitute_link before update of substituida_por_escala_id on public.pedido_escalas
  for each row execute function direct_private.guard_substitute_link();
revoke execute on function direct_private.guard_substitute_link() from public, anon, authenticated;
