-- Evita varreduras nas relações novas durante exclusões protegidas e consultas por pedido/pessoa.
create index if not exists cobranca_itens_pedido_idx on public.cobranca_itens (pedido_id);
create index if not exists pagamento_lotes_diarista_idx on public.pagamento_lotes (diarista_id);
