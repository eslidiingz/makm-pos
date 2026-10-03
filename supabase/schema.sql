create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  price numeric(10,2) not null check (price >= 0),
  image_key text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_available boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  subtotal numeric(10,2) not null check (subtotal >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  total numeric(10,2) not null check (total >= 0),
  payment_method text,
  sold_at timestamptz not null default now(),
  client_request_id uuid not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  note text
);

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create unique index if not exists categories_active_name_unique
  on public.categories (lower(btrim(name))) where archived_at is null;
create unique index if not exists products_active_category_name_unique
  on public.products (category_id, lower(btrim(name))) where archived_at is null;
create index if not exists products_category_sort_idx
  on public.products (category_id, sort_order) where archived_at is null;
create index if not exists orders_paid_sold_at_idx
  on public.orders (sold_at desc, id desc) where status = 'paid';
create index if not exists order_items_order_id_idx
  on public.order_items (order_id);
create index if not exists order_items_product_id_idx
  on public.order_items (product_id) where product_id is not null;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

create or replace function public.reorder_categories(ordered_ids uuid[])
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if cardinality(ordered_ids) = 0
    or cardinality(ordered_ids) <> (select count(distinct value)::integer from unnest(ordered_ids) as value)
    or cardinality(ordered_ids) <> (select count(*)::integer from public.categories where archived_at is null)
    or exists (
      select 1 from unnest(ordered_ids) as value
      left join public.categories category on category.id = value
      where category.id is null or category.archived_at is not null
    ) then raise exception 'Invalid category reorder request'; end if;
  update public.categories category set sort_order = positions.ordinality - 1
  from unnest(ordered_ids) with ordinality as positions(id, ordinality)
  where category.id = positions.id;
end;
$$;

create or replace function public.reorder_products(category uuid, ordered_ids uuid[])
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if cardinality(ordered_ids) = 0
    or cardinality(ordered_ids) <> (select count(distinct value)::integer from unnest(ordered_ids) as value)
    or cardinality(ordered_ids) <> (
      select count(*)::integer from public.products product
      where product.category_id = category and product.archived_at is null
    )
    or exists (
      select 1 from unnest(ordered_ids) as value
      left join public.products product on product.id = value
      where product.id is null or product.archived_at is not null or product.category_id <> category
    ) then raise exception 'Invalid product reorder request'; end if;
  update public.products product set sort_order = positions.ordinality - 1
  from unnest(ordered_ids) with ordinality as positions(id, ordinality)
  where product.id = positions.id and product.category_id = category;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.reorder_categories(uuid[]) from public, anon, authenticated;
revoke all on function public.reorder_products(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_categories(uuid[]) to service_role;
grant execute on function public.reorder_products(uuid, uuid[]) to service_role;

-- Costing and profit reporting. Ingredients are bought in lots; an ingredient's
-- cost per unit is the weighted average over every lot and is NULL, never 0,
-- until the first lot exists. A recipe line stores the owner's ratio
-- (batch_quantity of the ingredient yields batch_yield skewers) rather than a
-- pre-divided decimal, so a yield of 3 stays exact. COGS is derived at read
-- time from the current average; order_items carries no cost snapshot.

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unit text not null check (unit in ('kg', 'g', 'l', 'ml', 'pack', 'piece')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingredient_purchases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  purchased_on date not null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  total_cost numeric(12,2) not null check (total_cost >= 0),
  note text check (note is null or char_length(btrim(note)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_recipe_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  batch_quantity numeric(14,4) not null check (batch_quantity > 0),
  batch_yield integer not null check (batch_yield between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, ingredient_id)
);

alter table public.ingredients enable row level security;
alter table public.ingredient_purchases enable row level security;
alter table public.product_recipe_items enable row level security;

create unique index if not exists ingredients_active_name_unique
  on public.ingredients (lower(btrim(name))) where archived_at is null;
create index if not exists ingredient_purchases_ingredient_id_idx
  on public.ingredient_purchases (ingredient_id);
create index if not exists ingredient_purchases_purchased_on_idx
  on public.ingredient_purchases (purchased_on desc, created_at desc);
create index if not exists product_recipe_items_ingredient_id_idx
  on public.product_recipe_items (ingredient_id);

drop trigger if exists ingredients_set_updated_at on public.ingredients;
create trigger ingredients_set_updated_at before update on public.ingredients
for each row execute function public.set_updated_at();
drop trigger if exists ingredient_purchases_set_updated_at on public.ingredient_purchases;
create trigger ingredient_purchases_set_updated_at before update on public.ingredient_purchases
for each row execute function public.set_updated_at();
drop trigger if exists product_recipe_items_set_updated_at on public.product_recipe_items;
create trigger product_recipe_items_set_updated_at before update on public.product_recipe_items
for each row execute function public.set_updated_at();

-- A lot's unit is copied from its ingredient, never accepted from the client.
create or replace function public.stamp_ingredient_purchase_unit()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  new.unit := (select ingredient.unit from public.ingredients ingredient where ingredient.id = new.ingredient_id);
  if new.unit is null then raise exception using errcode = 'P0001', message = 'INGREDIENT_NOT_FOUND'; end if;
  return new;
end;
$$;

-- Mixing a 1 kg lot with a 1000 g lot would skew the average by 1000x with no
-- error anywhere, so the unit is frozen once a lot exists.
create or replace function public.guard_ingredient_unit_lock()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.unit is distinct from old.unit
    and exists (select 1 from public.ingredient_purchases purchase where purchase.ingredient_id = old.id)
  then raise exception using errcode = 'P0001', message = 'INGREDIENT_UNIT_LOCKED'; end if;
  return new;
end;
$$;

drop trigger if exists ingredient_purchases_stamp_unit on public.ingredient_purchases;
create trigger ingredient_purchases_stamp_unit before insert or update on public.ingredient_purchases
for each row execute function public.stamp_ingredient_purchase_unit();
drop trigger if exists ingredients_guard_unit_lock on public.ingredients;
create trigger ingredients_guard_unit_lock before update on public.ingredients
for each row execute function public.guard_ingredient_unit_lock();

-- get_ingredient_average_costs and get_product_unit_costs are the single
-- definition of "what does this cost". get_product_costing (/costs) and
-- get_profit_summary (/reports) both read them, so the two pages can never
-- show two different costs for the same skewer. Both return unrounded numeric;
-- callers round once, on output.
create or replace function public.get_ingredient_average_costs()
returns table(ingredient_id uuid, purchase_count bigint, total_quantity numeric, total_cost numeric,
              average_unit_cost numeric, last_purchased_on date)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    purchase.ingredient_id,
    count(*)::bigint,
    sum(purchase.quantity),
    sum(purchase.total_cost),
    sum(purchase.total_cost) / nullif(sum(purchase.quantity), 0),
    max(purchase.purchased_on)
  from public.ingredient_purchases purchase
  group by purchase.ingredient_id;
$$;

-- sum() skips NULLs, so a plain sum would price a six-ingredient recipe from
-- the five that happen to have lots. bool_and forces the whole cost to NULL
-- unless every line is priced. Archived ingredients are deliberately not
-- filtered: archiving hides an ingredient from the pickers, it must never
-- silently drop its cost out of a product that still uses it.
create or replace function public.get_product_unit_costs()
returns table(product_id uuid, unit_cost numeric, missing_ingredient_count bigint, recipe_line_count bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    item.product_id,
    case when bool_and(average.average_unit_cost is not null)
      then sum(average.average_unit_cost * item.batch_quantity / nullif(item.batch_yield, 0)::numeric)
      else null end,
    (count(*) filter (where average.average_unit_cost is null))::bigint,
    count(*)::bigint
  from public.product_recipe_items item
  left join public.get_ingredient_average_costs() average on average.ingredient_id = item.ingredient_id
  group by item.product_id;
$$;

create or replace function public.get_ingredient_costs()
returns table(id uuid, name text, unit text, archived_at timestamptz, purchase_count bigint,
              total_quantity numeric, total_cost numeric, average_unit_cost numeric,
              last_purchased_on date, recipe_product_count bigint, unit_locked boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    ingredient.id, ingredient.name, ingredient.unit, ingredient.archived_at,
    coalesce(average.purchase_count, 0),
    coalesce(average.total_quantity, 0),
    coalesce(average.total_cost, 0),
    round(average.average_unit_cost, 2),
    average.last_purchased_on,
    coalesce(recipe_usage.recipe_product_count, 0),
    coalesce(average.purchase_count, 0) > 0
  from public.ingredients ingredient
  left join public.get_ingredient_average_costs() average on average.ingredient_id = ingredient.id
  left join (
    select item.ingredient_id, count(*)::bigint as recipe_product_count
    from public.product_recipe_items item
    join public.products product on product.id = item.product_id
    where product.archived_at is null
    group by item.ingredient_id
  ) recipe_usage on recipe_usage.ingredient_id = ingredient.id
  order by ingredient.name;
$$;

create or replace function public.get_product_costing()
returns table(id uuid, name text, category_name text, price numeric, unit_cost numeric,
              profit_per_unit numeric, margin_ratio numeric, missing_ingredient_count bigint, recipe jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with averages as materialized (
    select average.ingredient_id, average.average_unit_cost from public.get_ingredient_average_costs() average
  ), costs as materialized (
    select cost.product_id, cost.unit_cost, cost.missing_ingredient_count from public.get_product_unit_costs() cost
  )
  select
    product.id, product.name, category.name, product.price,
    round(costs.unit_cost, 2),
    round(product.price - costs.unit_cost, 2),
    round((product.price - costs.unit_cost) / nullif(product.price, 0), 6),
    coalesce(costs.missing_ingredient_count, 0),
    coalesce(lines.recipe, '[]'::jsonb)
  from public.products product
  left join public.categories category on category.id = product.category_id
  left join costs on costs.product_id = product.id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'ingredientId', ingredient.id,
      'ingredientName', ingredient.name,
      'ingredientUnit', ingredient.unit,
      'ingredientArchivedAt', ingredient.archived_at,
      'batchQuantity', item.batch_quantity,
      'batchYield', item.batch_yield,
      'unitCost', round(averages.average_unit_cost * item.batch_quantity / nullif(item.batch_yield, 0)::numeric, 2)
    ) order by ingredient.name) as recipe
    from public.product_recipe_items item
    join public.ingredients ingredient on ingredient.id = item.ingredient_id
    left join averages on averages.ingredient_id = item.ingredient_id
    where item.product_id = product.id
  ) lines on true
  where product.archived_at is null
  order by category.sort_order nulls last, product.sort_order, product.name;
$$;

-- Replaces the whole recipe set for one product atomically, the same contract
-- as reorder_categories. Returns the product's get_product_costing() row as a
-- jsonb object keyed by that function's snake_case column names; the nested
-- recipe array stays camelCase.
create or replace function public.set_product_recipe(target_product uuid, recipe_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  requested_count integer; accepted_count integer; distinct_count integer; result jsonb;
begin
  if target_product is null or recipe_items is null
    or jsonb_typeof(recipe_items) <> 'array' or jsonb_array_length(recipe_items) > 40
  then raise exception using errcode = 'P0001', message = 'INVALID_RECIPE'; end if;

  if not exists (
    select 1 from public.products product
    where product.id = target_product and product.archived_at is null
  ) then raise exception using errcode = 'P0001', message = 'INVALID_RECIPE'; end if;

  begin
    -- Archived ingredients are accepted on purpose: archiving must not make an
    -- existing recipe unsaveable.
    select
      count(*)::integer,
      (count(*) filter (
        where line."ingredientId" is not null
          and line."batchQuantity" is not null and line."batchQuantity" > 0
          and line."batchYield" is not null and line."batchYield" between 1 and 100000
          and exists (select 1 from public.ingredients ingredient where ingredient.id = line."ingredientId")
      ))::integer,
      count(distinct line."ingredientId")::integer
    into requested_count, accepted_count, distinct_count
    from jsonb_to_recordset(recipe_items) as line("ingredientId" uuid, "batchQuantity" numeric, "batchYield" integer);
  exception
    when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range
      or datatype_mismatch or cannot_coerce then
      raise exception using errcode = 'P0001', message = 'INVALID_RECIPE';
  end;

  if requested_count <> accepted_count or requested_count <> distinct_count then
    raise exception using errcode = 'P0001', message = 'INVALID_RECIPE';
  end if;

  delete from public.product_recipe_items where product_id = target_product;
  insert into public.product_recipe_items (product_id, ingredient_id, batch_quantity, batch_yield)
  select target_product, line."ingredientId", line."batchQuantity", line."batchYield"
  from jsonb_to_recordset(recipe_items) as line("ingredientId" uuid, "batchQuantity" numeric, "batchYield" integer);

  select to_jsonb(costing) into result
  from public.get_product_costing() costing where costing.id = target_product;
  if result is null then raise exception using errcode = 'P0001', message = 'INVALID_RECIPE'; end if;
  return result;
end;
$$;

-- revenue, order_count and item_count reuse the exact predicate and per-order
-- grouping of get_sales_summary, so the profit card and the sales card on
-- /reports can never disagree. COGS covers only the lines whose product cost is
-- currently computable; the rest are reported separately, in baht and skewers,
-- so no surface can show a flattering profit without disclosing the gap.
-- purchase_cost matches lots by Bangkok calendar day against a timestamptz
-- range whose end is exclusive.
create or replace function public.get_profit_summary(report_start timestamptz, report_end timestamptz)
returns table(revenue numeric, order_count bigint, item_count bigint, cogs numeric, gross_profit numeric,
              costed_revenue numeric, uncosted_revenue numeric, costed_item_count bigint,
              uncosted_item_count bigint, purchase_cost numeric, cash_profit numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with sales as (
    select orders.id, orders.total, coalesce(sum(order_items.quantity), 0)::bigint as item_count
    from public.orders
    left join public.order_items on order_items.order_id = orders.id
    where orders.status = 'paid' and orders.sold_at >= report_start and orders.sold_at < report_end
    group by orders.id, orders.total
  ), revenue_totals as (
    select coalesce(sum(sales.total), 0) as revenue, count(*)::bigint as order_count,
           coalesce(sum(sales.item_count), 0)::bigint as item_count
    from sales
  ), sold_lines as (
    select order_items.quantity, order_items.unit_price, cost.unit_cost
    from public.orders
    join public.order_items on order_items.order_id = orders.id
    left join public.get_product_unit_costs() cost on cost.product_id = order_items.product_id
    where orders.status = 'paid' and orders.sold_at >= report_start and orders.sold_at < report_end
  ), cost_totals as (
    select
      round(coalesce(sum(sold_lines.quantity * sold_lines.unit_cost)
        filter (where sold_lines.unit_cost is not null), 0), 2) as cogs,
      coalesce(sum(sold_lines.quantity * sold_lines.unit_price)
        filter (where sold_lines.unit_cost is not null), 0) as costed_revenue,
      coalesce(sum(sold_lines.quantity * sold_lines.unit_price)
        filter (where sold_lines.unit_cost is null), 0) as uncosted_revenue,
      coalesce(sum(sold_lines.quantity) filter (where sold_lines.unit_cost is not null), 0)::bigint as costed_item_count,
      coalesce(sum(sold_lines.quantity) filter (where sold_lines.unit_cost is null), 0)::bigint as uncosted_item_count
    from sold_lines
  ), purchase_totals as (
    select coalesce(sum(purchase.total_cost), 0) as purchase_cost
    from public.ingredient_purchases purchase
    where report_end > report_start
      and purchase.purchased_on >= ((report_start at time zone 'Asia/Bangkok')::date)
      and purchase.purchased_on <= (((report_end - interval '1 microsecond') at time zone 'Asia/Bangkok')::date)
  )
  select
    revenue_totals.revenue, revenue_totals.order_count, revenue_totals.item_count,
    cost_totals.cogs, revenue_totals.revenue - cost_totals.cogs,
    cost_totals.costed_revenue, cost_totals.uncosted_revenue,
    cost_totals.costed_item_count, cost_totals.uncosted_item_count,
    purchase_totals.purchase_cost, revenue_totals.revenue - purchase_totals.purchase_cost
  from revenue_totals cross join cost_totals cross join purchase_totals;
$$;

-- One row per Bangkok month in the range, always. Each month is summarised by
-- get_profit_summary itself, which always returns exactly one row, so a month
-- with purchases but no sales - or with neither - still returns zeroes and a
-- month row can never disagree with the period card above it.
create or replace function public.get_monthly_profit(report_start timestamptz, report_end timestamptz)
returns table(month text, revenue numeric, order_count bigint, item_count bigint, cogs numeric,
              gross_profit numeric, costed_revenue numeric, uncosted_revenue numeric,
              costed_item_count bigint, uncosted_item_count bigint, purchase_cost numeric, cash_profit numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  first_month timestamp; last_month timestamp; month_span integer;
begin
  if report_start is null or report_end is null or report_end <= report_start then
    raise exception using errcode = 'P0001', message = 'INVALID_PROFIT_RANGE';
  end if;

  first_month := date_trunc('month', report_start at time zone 'Asia/Bangkok');
  last_month := date_trunc('month', (report_end - interval '1 microsecond') at time zone 'Asia/Bangkok');
  month_span := (
    (date_part('year', last_month)::integer * 12 + date_part('month', last_month)::integer)
    - (date_part('year', first_month)::integer * 12 + date_part('month', first_month)::integer)
  ) + 1;

  if month_span > 36 then raise exception using errcode = 'P0001', message = 'INVALID_PROFIT_RANGE'; end if;

  return query
  select
    to_char(series.month_start, 'YYYY-MM'),
    summary.revenue, summary.order_count, summary.item_count, summary.cogs, summary.gross_profit,
    summary.costed_revenue, summary.uncosted_revenue, summary.costed_item_count,
    summary.uncosted_item_count, summary.purchase_cost, summary.cash_profit
  from generate_series(first_month, last_month, interval '1 month') as series(month_start)
  cross join lateral public.get_profit_summary(
    series.month_start at time zone 'Asia/Bangkok',
    (series.month_start + interval '1 month') at time zone 'Asia/Bangkok'
  ) as summary
  order by series.month_start;
end;
$$;

-- total_items and total_lot_cost are window aggregates over the whole filtered
-- set, not the returned page, so the footer can state real totals in one trip.
create or replace function public.get_ingredient_purchases(
  report_start timestamptz, report_end timestamptz, filter_ingredient uuid,
  result_limit integer, result_offset integer
)
returns table(id uuid, ingredient_id uuid, ingredient_name text, unit text, purchased_on date,
              quantity numeric, total_cost numeric, unit_cost numeric, note text,
              total_items bigint, total_lot_cost numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with filtered as (
    select
      purchase.id, purchase.ingredient_id, ingredient.name as ingredient_name, purchase.unit,
      purchase.purchased_on, purchase.quantity, purchase.total_cost,
      round(purchase.total_cost / nullif(purchase.quantity, 0), 2) as unit_cost,
      purchase.note, purchase.created_at,
      count(*) over () as total_items,
      sum(purchase.total_cost) over () as total_lot_cost
    from public.ingredient_purchases purchase
    join public.ingredients ingredient on ingredient.id = purchase.ingredient_id
    where report_end > report_start
      and purchase.purchased_on >= ((report_start at time zone 'Asia/Bangkok')::date)
      and purchase.purchased_on <= (((report_end - interval '1 microsecond') at time zone 'Asia/Bangkok')::date)
      and (filter_ingredient is null or purchase.ingredient_id = filter_ingredient)
  )
  select
    filtered.id, filtered.ingredient_id, filtered.ingredient_name, filtered.unit, filtered.purchased_on,
    filtered.quantity, filtered.total_cost, filtered.unit_cost, filtered.note,
    filtered.total_items, filtered.total_lot_cost
  from filtered
  order by filtered.purchased_on desc, filtered.created_at desc
  limit least(greatest(coalesce(result_limit, 20), 1), 200)
  offset greatest(coalesce(result_offset, 0), 0);
$$;

revoke all on function public.stamp_ingredient_purchase_unit() from public, anon, authenticated;
revoke all on function public.guard_ingredient_unit_lock() from public, anon, authenticated;
revoke all on function public.get_ingredient_average_costs() from public, anon, authenticated;
revoke all on function public.get_product_unit_costs() from public, anon, authenticated;
revoke all on function public.get_ingredient_costs() from public, anon, authenticated;
revoke all on function public.get_product_costing() from public, anon, authenticated;
revoke all on function public.set_product_recipe(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_profit_summary(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.get_monthly_profit(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.get_ingredient_purchases(timestamptz, timestamptz, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_ingredient_average_costs() to service_role;
grant execute on function public.get_product_unit_costs() to service_role;
grant execute on function public.get_ingredient_costs() to service_role;
grant execute on function public.get_product_costing() to service_role;
grant execute on function public.set_product_recipe(uuid, jsonb) to service_role;
grant execute on function public.get_profit_summary(timestamptz, timestamptz) to service_role;
grant execute on function public.get_monthly_profit(timestamptz, timestamptz) to service_role;
grant execute on function public.get_ingredient_purchases(timestamptz, timestamptz, uuid, integer, integer)
  to service_role;

-- Order creation and reporting functions are defined in
-- 202608240008_contract_sales_schema.sql and
-- 202608250010_add_top_selling_products.sql. They are restricted to service_role.

-- The POS server uses SUPABASE_SERVICE_ROLE_KEY for privileged writes.
-- Add per-role policies here before exposing tables directly to browsers.
