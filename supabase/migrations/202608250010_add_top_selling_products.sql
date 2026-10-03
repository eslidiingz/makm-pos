create or replace function public.get_top_selling_products(
  report_start timestamptz,
  report_end timestamptz,
  result_limit integer default 10
)
returns table(
  rank bigint,
  product_id uuid,
  product_name text,
  category_name text,
  quantity bigint,
  total_sales numeric,
  is_archived boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with product_sales as (
    select
      order_items.product_id,
      coalesce(products.name, order_items.product_name) as product_name,
      categories.name as category_name,
      sum(order_items.quantity)::bigint as quantity,
      sum(order_items.quantity * order_items.unit_price) as total_sales,
      (products.archived_at is not null) as is_archived
    from public.orders
    join public.order_items on order_items.order_id = orders.id
    left join public.products on products.id = order_items.product_id
    left join public.categories on categories.id = products.category_id
    where orders.status = 'paid'
      and orders.sold_at >= report_start
      and orders.sold_at < report_end
    group by
      order_items.product_id,
      coalesce(products.name, order_items.product_name),
      categories.name,
      products.archived_at
  ), ranked as (
    select
      row_number() over (
        order by quantity desc, total_sales desc, product_name asc
      ) as rank,
      product_id,
      product_name,
      category_name,
      quantity,
      total_sales,
      is_archived
    from product_sales
  )
  select *
  from ranked
  order by rank
  limit least(greatest(result_limit, 1), 100);
$$;

revoke all on function public.get_top_selling_products(timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.get_top_selling_products(timestamptz, timestamptz, integer)
  to service_role;
