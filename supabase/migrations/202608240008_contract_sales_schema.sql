alter table public.orders
  alter column sold_at set default now(),
  alter column sold_at set not null,
  alter column client_request_id set not null;

create unique index orders_client_request_id_unique
  on public.orders (client_request_id);

create index orders_paid_sold_at_idx
  on public.orders (sold_at desc, id desc)
  where status = 'paid';

create or replace function public.create_paid_order(
  request_id uuid,
  requested_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if request_id is null
    or jsonb_typeof(requested_items) <> 'array'
    or jsonb_array_length(requested_items) < 1
    or jsonb_array_length(requested_items) > 100
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
  end if;

  select jsonb_build_object(
    'id', existing.id,
    'orderNumber', existing.order_number,
    'status', existing.status,
    'subtotal', existing.subtotal,
    'discount', existing.discount,
    'total', existing.total,
    'paymentMethod', existing.payment_method,
    'soldAt', existing.sold_at,
    'itemCount', coalesce((
      select sum(item.quantity) from public.order_items item where item.order_id = existing.id
    ), 0)
  )
  into result
  from public.orders existing
  where existing.client_request_id = request_id;

  if result is not null then return result; end if;

  begin
    with requested as materialized (
      select
        item."productId" as product_id,
        item.quantity,
        item."expectedUnitPrice" as expected_unit_price
      from jsonb_to_recordset(requested_items) as item(
        "productId" uuid,
        quantity integer,
        "expectedUnitPrice" numeric
      )
    ),
    valid as materialized (
      select
        requested.product_id,
        requested.quantity,
        product.name as product_name,
        product.price as unit_price
      from requested
      join public.products product on product.id = requested.product_id
      join public.categories category on category.id = product.category_id
      where requested.quantity between 1 and 100
        and requested.expected_unit_price >= 0
        and product.price = requested.expected_unit_price
        and product.is_available = true
        and product.archived_at is null
        and category.is_active = true
        and category.archived_at is null
    ),
    stats as materialized (
      select
        (select count(*) from requested) as requested_count,
        (select count(distinct product_id) from requested) as distinct_count,
        (select count(*) from valid) as valid_count,
        coalesce((select sum(unit_price * quantity) from valid), 0) as total,
        coalesce((select sum(quantity) from valid), 0) as item_count
    ),
    created_order as (
      insert into public.orders (
        status,
        subtotal,
        discount,
        total,
        payment_method,
        sold_at,
        client_request_id
      )
      select 'paid', stats.total, 0, stats.total, null, now(), request_id
      from stats
      where stats.requested_count = jsonb_array_length(requested_items)
        and stats.requested_count = stats.distinct_count
        and stats.requested_count = stats.valid_count
      on conflict (client_request_id) do nothing
      returning *
    ),
    created_items as (
      insert into public.order_items (
        order_id,
        product_id,
        product_name,
        unit_price,
        quantity
      )
      select
        created_order.id,
        valid.product_id,
        valid.product_name,
        valid.unit_price,
        valid.quantity
      from created_order
      cross join valid
      returning quantity
    )
    select jsonb_build_object(
      'id', created_order.id,
      'orderNumber', created_order.order_number,
      'status', created_order.status,
      'subtotal', created_order.subtotal,
      'discount', created_order.discount,
      'total', created_order.total,
      'paymentMethod', created_order.payment_method,
      'soldAt', created_order.sold_at,
      'itemCount', stats.item_count
    )
    into result
    from created_order
    cross join stats
    cross join (select count(*) from created_items) inserted;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
  end;

  if result is not null then return result; end if;

  -- A concurrent retry with the same request ID may have won the insert.
  select jsonb_build_object(
    'id', existing.id,
    'orderNumber', existing.order_number,
    'status', existing.status,
    'subtotal', existing.subtotal,
    'discount', existing.discount,
    'total', existing.total,
    'paymentMethod', existing.payment_method,
    'soldAt', existing.sold_at,
    'itemCount', coalesce((
      select sum(item.quantity) from public.order_items item where item.order_id = existing.id
    ), 0)
  )
  into result
  from public.orders existing
  where existing.client_request_id = request_id;

  if result is not null then return result; end if;

  raise exception using errcode = 'P0001', message = 'ORDER_CATALOG_CHANGED';
end;
$$;

create or replace function public.get_daily_sales_summary(
  report_date date,
  report_timezone text
)
returns table(total_sales numeric, order_count bigint, item_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    coalesce(sum(sale.total), 0) as total_sales,
    count(*) as order_count,
    coalesce(sum(sale.item_count), 0)::bigint as item_count
  from (
    select
      orders.id,
      orders.total,
      coalesce(sum(order_items.quantity), 0)::bigint as item_count
    from public.orders
    left join public.order_items on order_items.order_id = orders.id
    where orders.status = 'paid'
      and orders.sold_at >= (report_date::timestamp at time zone report_timezone)
      and orders.sold_at < ((report_date + 1)::timestamp at time zone report_timezone)
    group by orders.id, orders.total
  ) sale;
$$;

revoke all on function public.create_paid_order(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_daily_sales_summary(date, text) from public, anon, authenticated;
grant execute on function public.create_paid_order(uuid, jsonb) to service_role;
grant execute on function public.get_daily_sales_summary(date, text) to service_role;
