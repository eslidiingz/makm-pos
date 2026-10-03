-- Forward-only expand migration. Columns remain nullable until the following
-- backfill has made every existing order compatible with the new contract.

alter table public.orders
  add column if not exists sold_at timestamptz,
  add column if not exists client_request_id uuid;
