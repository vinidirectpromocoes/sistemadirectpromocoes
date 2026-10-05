-- Permite corrigir o setor sem recriar escalas ou alterar diárias já registradas.
CREATE OR REPLACE FUNCTION public.direct_guard_pedido_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_table_name = 'pedido_escalas' then
    if old.status <> 'escalada' then
      raise exception 'Presenças e faltas registradas não podem ser excluídas. Corrija a situação da escala.';
    end if;
  elsif tg_table_name = 'diarias' then
    if old.pedido_escala_id is not null and exists (
      select 1 from public.pedido_escalas where id = old.pedido_escala_id and status = 'presente'
    ) then raise exception 'Esta diária está vinculada a uma presença. Corrija a presença no pedido.'; end if;
  elsif tg_table_name = 'pedidos' and exists (
    select 1 from public.pedido_escalas where pedido_id = old.id
  ) then
    if tg_op = 'DELETE' or
      (new.supermercado, new.unidade, new.quantidade_diaristas, new.turnos)
      is distinct from (old.supermercado, old.unidade, old.quantidade_diaristas, old.turnos) then
      raise exception 'Este pedido já possui escalas. Você pode corrigir o setor; preserve a rede, a loja, a quantidade e as datas e horários registrados.';
    end if;
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  return old;
end;
$function$
;
revoke execute on function public.direct_guard_pedido_history() from public, anon, authenticated;
