-- Existing paid orders were created and sold at the same time in v1.
-- Give every historical row an idempotency key before enforcing NOT NULL.

update public.orders
set sold_at = created_at
where sold_at is null;

update public.orders
set client_request_id = gen_random_uuid()
where client_request_id is null;
