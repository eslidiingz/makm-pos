create or replace function public.get_sales_summary(
  report_start timestamptz,
  report_end timestamptz
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
      and orders.sold_at >= report_start
      and orders.sold_at < report_end
    group by orders.id, orders.total
  ) sale;
$$;

revoke all on function public.get_sales_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_sales_summary(timestamptz, timestamptz) to service_role;
