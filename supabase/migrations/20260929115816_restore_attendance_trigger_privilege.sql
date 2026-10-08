-- Operação altera apenas pedido_escalas. O gatilho grava a diária usando as
-- permissões do proprietário, enquanto o RLS continua bloqueando acesso
-- financeiro direto para o usuário de operação.
alter function public.direct_sync_pedido_presenca() security definer;
