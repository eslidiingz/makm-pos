-- Forward-only expand migration for ingredient costing and profit reporting.
--
-- Model
--   Ingredients are bought in lots. An ingredient's cost per unit is the
--   weighted average over every lot: sum(total_cost) / sum(quantity). It is
--   NULL until the first lot exists - never 0, because an unknown cost that
--   read as zero would report the shop's margin as 100%.
--
--   A recipe line stores the owner's own phrasing as an exact ratio:
--   batch_quantity of the ingredient yields batch_yield skewers. "1 กก. ทำได้
--   20 ไม้" is 1 / 20, "ใช้ 0.05 กก. ต่อไม้" is 0.05 / 1. The division happens
--   in SQL numeric at read time, so a yield of 3 stays exact instead of being
--   frozen as 0.333333 at write time.
--
--   Cost of goods sold is derived at read time from the current average. There
--   is no snapshot column on order_items and public.create_paid_order is not
--   touched: the shop logs its purchases in the evening, after the day's
--   sales, so a sale-time snapshot would freeze a cost that predates the very
--   purchase meant to account for it.
--
-- Numeric precision
--   Money the owner typed stays numeric(12,2). Quantities are numeric(14,4).
--   Every derived figure - the weighted average, a recipe line's share of a
--   skewer, a product's unit cost, a period's COGS - is carried unrounded
--   through the aggregate and rounded exactly once, with round(x, 2), on the
--   way out. A per-unit cost is never rounded and then multiplied by a
--   quantity.
--
--   Every division goes through nullif(). A lot with quantity 0 is impossible
--   (check quantity > 0) but sum() over an empty set is still NULL, and a
--   product priced at 0 is allowed; both must produce NULL, not a division
--   error and not a fabricated number.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unit text not null check (unit in ('kg', 'g', 'l', 'ml', 'pack', 'piece')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- unit is a snapshot stamped from the ingredient by a trigger, so a lot keeps
-- the unit it was actually bought in even if the ingredient row is edited.
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

-- batch_quantity / batch_yield is stored as the owner's ratio, never as a
-- pre-divided per-skewer decimal.
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

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create unique index if not exists ingredients_active_name_unique
  on public.ingredients (lower(btrim(name)))
  where archived_at is null;

-- Covers the foreign key and the per-ingredient lot list.
create index if not exists ingredient_purchases_ingredient_id_idx
  on public.ingredient_purchases (ingredient_id);

-- Cash profit and the monthly breakdown scan lots by Bangkok calendar day.
create index if not exists ingredient_purchases_purchased_on_idx
  on public.ingredient_purchases (purchased_on desc, created_at desc);

-- product_id is already covered by the unique (product_id, ingredient_id)
-- constraint; ingredient_id needs its own index for the delete restrict check.
create index if not exists product_recipe_items_ingredient_id_idx
  on public.product_recipe_items (ingredient_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists ingredients_set_updated_at on public.ingredients;
create trigger ingredients_set_updated_at
before update on public.ingredients
for each row execute function public.set_updated_at();

drop trigger if exists ingredient_purchases_set_updated_at on public.ingredient_purchases;
create trigger ingredient_purchases_set_updated_at
before update on public.ingredient_purchases
for each row execute function public.set_updated_at();

drop trigger if exists product_recipe_items_set_updated_at on public.product_recipe_items;
create trigger product_recipe_items_set_updated_at
before update on public.product_recipe_items
for each row execute function public.set_updated_at();

-- The lot's unit is never accepted from the client. It is copied from the
-- ingredient so a lot can never claim a unit the ingredient does not use.
create or replace function public.stamp_ingredient_purchase_unit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.unit := (
    select ingredient.unit
    from public.ingredients ingredient
    where ingredient.id = new.ingredient_id
  );

  if new.unit is null then
    raise exception using errcode = 'P0001', message = 'INGREDIENT_NOT_FOUND';
  end if;

  return new;
end;
$$;

drop trigger if exists ingredient_purchases_stamp_unit on public.ingredient_purchases;
create trigger ingredient_purchases_stamp_unit
before insert or update on public.ingredient_purchases
for each row execute function public.stamp_ingredient_purchase_unit();

-- Mixing a 1 kg lot with a 1000 g lot would make the weighted average wrong by
-- a factor of 1000 with no error anywhere, so the unit is frozen in the
-- database once a lot exists, not only in the route.
create or replace function public.guard_ingredient_unit_lock()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.unit is distinct from old.unit
    and exists (
      select 1
      from public.ingredient_purchases purchase
      where purchase.ingredient_id = old.id
    )
  then
    raise exception using errcode = 'P0001', message = 'INGREDIENT_UNIT_LOCKED';
  end if;

  return new;
end;
$$;

drop trigger if exists ingredients_guard_unit_lock on public.ingredients;
create trigger ingredients_guard_unit_lock
before update on public.ingredients
for each row execute function public.guard_ingredient_unit_lock();

-- ---------------------------------------------------------------------------
-- Costing helpers
--
-- These two functions are the single definition of "what does this cost".
-- get_product_costing (the /costs page) and get_profit_summary (the /reports
-- page) both read get_product_unit_costs, so the two surfaces can never show
-- two different costs for the same skewer.
-- ---------------------------------------------------------------------------

-- Weighted average across ALL lots. An ingredient with no lots is absent from
-- the result, so every caller left joins and sees NULL rather than 0.
-- average_unit_cost is returned unrounded; callers round once, on output.
create or replace function public.get_ingredient_average_costs()
returns table(
  ingredient_id uuid,
  purchase_count bigint,
  total_quantity numeric,
  total_cost numeric,
  average_unit_cost numeric,
  last_purchased_on date
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    purchase.ingredient_id,
    count(*)::bigint as purchase_count,
    sum(purchase.quantity) as total_quantity,
    sum(purchase.total_cost) as total_cost,
    sum(purchase.total_cost) / nullif(sum(purchase.quantity), 0) as average_unit_cost,
    max(purchase.purchased_on) as last_purchased_on
  from public.ingredient_purchases purchase
  group by purchase.ingredient_id;
$$;

-- Cost of one skewer, per product, unrounded.
--
-- Postgres sum() skips NULLs, so a plain sum would silently price a
-- six-ingredient recipe from the five ingredients that happen to have lots.
-- bool_and forces the whole product's cost to NULL unless every line is
-- priced, and missing_ingredient_count says how many lines are not.
--
-- A product with no recipe rows is absent from the result entirely, which is
-- why callers must left join. The join to the averages deliberately does not
-- filter archived ingredients: archiving hides an ingredient from the pickers,
-- it must never silently drop its cost out of a product that still uses it.
create or replace function public.get_product_unit_costs()
returns table(
  product_id uuid,
  unit_cost numeric,
  missing_ingredient_count bigint,
  recipe_line_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    item.product_id,
    case
      when bool_and(average.average_unit_cost is not null)
        then sum(average.average_unit_cost * item.batch_quantity / nullif(item.batch_yield, 0)::numeric)
      else null
    end as unit_cost,
    (count(*) filter (where average.average_unit_cost is null))::bigint as missing_ingredient_count,
    count(*)::bigint as recipe_line_count
  from public.product_recipe_items item
  left join public.get_ingredient_average_costs() average
    on average.ingredient_id = item.ingredient_id
  group by item.product_id;
$$;

-- ---------------------------------------------------------------------------
-- Read models for the costs page
-- ---------------------------------------------------------------------------

-- Every ingredient, archived ones included, ordered by name. An ingredient
-- with no lots reports zero totals but a NULL average, because zero baht spent
-- is a fact while zero baht per kilogram is a lie.
create or replace function public.get_ingredient_costs()
returns table(
  id uuid,
  name text,
  unit text,
  archived_at timestamptz,
  purchase_count bigint,
  total_quantity numeric,
  total_cost numeric,
  average_unit_cost numeric,
  last_purchased_on date,
  recipe_product_count bigint,
  unit_locked boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    ingredient.id,
    ingredient.name,
    ingredient.unit,
    ingredient.archived_at,
    coalesce(average.purchase_count, 0) as purchase_count,
    coalesce(average.total_quantity, 0) as total_quantity,
    coalesce(average.total_cost, 0) as total_cost,
    round(average.average_unit_cost, 2) as average_unit_cost,
    average.last_purchased_on,
    coalesce(recipe_usage.recipe_product_count, 0) as recipe_product_count,
    coalesce(average.purchase_count, 0) > 0 as unit_locked
  from public.ingredients ingredient
  left join public.get_ingredient_average_costs() average
    on average.ingredient_id = ingredient.id
  left join (
    select
      item.ingredient_id,
      count(*)::bigint as recipe_product_count
    from public.product_recipe_items item
    join public.products product on product.id = item.product_id
    where product.archived_at is null
    group by item.ingredient_id
  ) recipe_usage on recipe_usage.ingredient_id = ingredient.id
  order by ingredient.name;
$$;

-- Products on the menu with their recipe, cost per skewer, profit per skewer
-- and margin. The recipe is a camelCase jsonb array, matching the jsonb
-- contract create_paid_order already uses, ordered by ingredient name.
create or replace function public.get_product_costing()
returns table(
  id uuid,
  name text,
  category_name text,
  price numeric,
  unit_cost numeric,
  profit_per_unit numeric,
  margin_ratio numeric,
  missing_ingredient_count bigint,
  recipe jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with averages as materialized (
    select
      average.ingredient_id,
      average.average_unit_cost
    from public.get_ingredient_average_costs() average
  ),
  costs as materialized (
    select
      cost.product_id,
      cost.unit_cost,
      cost.missing_ingredient_count
    from public.get_product_unit_costs() cost
  )
  select
    product.id,
    product.name,
    category.name as category_name,
    product.price,
    round(costs.unit_cost, 2) as unit_cost,
    round(product.price - costs.unit_cost, 2) as profit_per_unit,
    round((product.price - costs.unit_cost) / nullif(product.price, 0), 6) as margin_ratio,
    coalesce(costs.missing_ingredient_count, 0) as missing_ingredient_count,
    coalesce(lines.recipe, '[]'::jsonb) as recipe
  from public.products product
  left join public.categories category on category.id = product.category_id
  left join costs on costs.product_id = product.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'ingredientId', ingredient.id,
        'ingredientName', ingredient.name,
        'ingredientUnit', ingredient.unit,
        'ingredientArchivedAt', ingredient.archived_at,
        'batchQuantity', item.batch_quantity,
        'batchYield', item.batch_yield,
        'unitCost', round(
          averages.average_unit_cost * item.batch_quantity / nullif(item.batch_yield, 0)::numeric,
          2
        )
      )
      order by ingredient.name
    ) as recipe
    from public.product_recipe_items item
    join public.ingredients ingredient on ingredient.id = item.ingredient_id
    left join averages on averages.ingredient_id = item.ingredient_id
    where item.product_id = product.id
  ) lines on true
  where product.archived_at is null
  order by category.sort_order nulls last, product.sort_order, product.name;
$$;

-- Replaces the whole recipe set for one product in a single transaction, the
-- same all-or-nothing contract as public.reorder_categories. Returns the
-- product's row from get_product_costing() as a jsonb object; its keys are the
-- snake_case column names of that function, so the caller can reuse the same
-- row mapper for both. The nested recipe array stays camelCase.
create or replace function public.set_product_recipe(
  target_product uuid,
  recipe_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  requested_count integer;
  accepted_count integer;
  distinct_count integer;
  result jsonb;
begin
  if target_product is null
    or recipe_items is null
    or jsonb_typeof(recipe_items) <> 'array'
    or jsonb_array_length(recipe_items) > 40
  then
    raise exception using errcode = 'P0001', message = 'INVALID_RECIPE';
  end if;

  if not exists (
    select 1
    from public.products product
    where product.id = target_product and product.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_RECIPE';
  end if;

  begin
    -- Archived ingredients are accepted here on purpose. Archiving removes an
    -- ingredient from the pickers; it must not make an existing recipe
    -- unsaveable, and get_product_costing keeps costing those lines.
    select
      count(*)::integer,
      (count(*) filter (
        where line."ingredientId" is not null
          and line."batchQuantity" is not null
          and line."batchQuantity" > 0
          and line."batchYield" is not null
          and line."batchYield" between 1 and 100000
          and exists (
            select 1
            from public.ingredients ingredient
            where ingredient.id = line."ingredientId"
          )
      ))::integer,
      count(distinct line."ingredientId")::integer
    into requested_count, accepted_count, distinct_count
    from jsonb_to_recordset(recipe_items) as line(
      "ingredientId" uuid,
      "batchQuantity" numeric,
      "batchYield" integer
    );
  exception
    when invalid_text_representation
      or invalid_parameter_value
      or numeric_value_out_of_range
      or datatype_mismatch
      or cannot_coerce then
      raise exception using errcode = 'P0001', message = 'INVALID_RECIPE';
  end;

  if requested_count <> accepted_count or requested_count <> distinct_count then
    raise exception using errcode = 'P0001', message = 'INVALID_RECIPE';
  end if;

  delete from public.product_recipe_items
  where product_id = target_product;

  insert into public.product_recipe_items (
    product_id,
    ingredient_id,
    batch_quantity,
    batch_yield
  )
  select
    target_product,
    line."ingredientId",
    line."batchQuantity",
    line."batchYield"
  from jsonb_to_recordset(recipe_items) as line(
    "ingredientId" uuid,
    "batchQuantity" numeric,
    "batchYield" integer
  );

  select to_jsonb(costing)
  into result
  from public.get_product_costing() costing
  where costing.id = target_product;

  if result is null then
    raise exception using errcode = 'P0001', message = 'INVALID_RECIPE';
  end if;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profit reporting
-- ---------------------------------------------------------------------------

-- revenue, order_count and item_count reuse the exact predicate and per-order
-- grouping of public.get_sales_summary, so the profit card and the sales card
-- on /reports can never disagree.
--
-- COGS covers only the lines whose product cost is currently computable. The
-- rest are reported separately, in both baht and skewers, so no surface can
-- show a flattering profit without disclosing what it left out.
--
-- purchase_cost matches lots by their Bangkok calendar day: report_end is
-- exclusive, so the last covered day is the Bangkok day of the last instant
-- inside the range.
create or replace function public.get_profit_summary(
  report_start timestamptz,
  report_end timestamptz
)
returns table(
  revenue numeric,
  order_count bigint,
  item_count bigint,
  cogs numeric,
  gross_profit numeric,
  costed_revenue numeric,
  uncosted_revenue numeric,
  costed_item_count bigint,
  uncosted_item_count bigint,
  purchase_cost numeric,
  cash_profit numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with sales as (
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
  ),
  revenue_totals as (
    select
      coalesce(sum(sales.total), 0) as revenue,
      count(*)::bigint as order_count,
      coalesce(sum(sales.item_count), 0)::bigint as item_count
    from sales
  ),
  sold_lines as (
    select
      order_items.quantity,
      order_items.unit_price,
      cost.unit_cost
    from public.orders
    join public.order_items on order_items.order_id = orders.id
    left join public.get_product_unit_costs() cost on cost.product_id = order_items.product_id
    where orders.status = 'paid'
      and orders.sold_at >= report_start
      and orders.sold_at < report_end
  ),
  cost_totals as (
    select
      round(
        coalesce(
          sum(sold_lines.quantity * sold_lines.unit_cost)
            filter (where sold_lines.unit_cost is not null),
          0
        ),
        2
      ) as cogs,
      coalesce(
        sum(sold_lines.quantity * sold_lines.unit_price)
          filter (where sold_lines.unit_cost is not null),
        0
      ) as costed_revenue,
      coalesce(
        sum(sold_lines.quantity * sold_lines.unit_price)
          filter (where sold_lines.unit_cost is null),
        0
      ) as uncosted_revenue,
      coalesce(
        sum(sold_lines.quantity) filter (where sold_lines.unit_cost is not null),
        0
      )::bigint as costed_item_count,
      coalesce(
        sum(sold_lines.quantity) filter (where sold_lines.unit_cost is null),
        0
      )::bigint as uncosted_item_count
    from sold_lines
  ),
  purchase_totals as (
    select coalesce(sum(purchase.total_cost), 0) as purchase_cost
    from public.ingredient_purchases purchase
    where report_end > report_start
      and purchase.purchased_on >= ((report_start at time zone 'Asia/Bangkok')::date)
      and purchase.purchased_on <= (
        ((report_end - interval '1 microsecond') at time zone 'Asia/Bangkok')::date
      )
  )
  select
    revenue_totals.revenue,
    revenue_totals.order_count,
    revenue_totals.item_count,
    cost_totals.cogs,
    revenue_totals.revenue - cost_totals.cogs as gross_profit,
    cost_totals.costed_revenue,
    cost_totals.uncosted_revenue,
    cost_totals.costed_item_count,
    cost_totals.uncosted_item_count,
    purchase_totals.purchase_cost,
    revenue_totals.revenue - purchase_totals.purchase_cost as cash_profit
  from revenue_totals
  cross join cost_totals
  cross join purchase_totals;
$$;

-- One row per Bangkok month in the range, always. generate_series produces the
-- months and each one is summarised by get_profit_summary itself, so a month
-- with purchases but no sales, or with neither, still returns a row of zeroes
-- and a month row can never disagree with the single-period card above it.
create or replace function public.get_monthly_profit(
  report_start timestamptz,
  report_end timestamptz
)
returns table(
  month text,
  revenue numeric,
  order_count bigint,
  item_count bigint,
  cogs numeric,
  gross_profit numeric,
  costed_revenue numeric,
  uncosted_revenue numeric,
  costed_item_count bigint,
  uncosted_item_count bigint,
  purchase_cost numeric,
  cash_profit numeric
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  first_month timestamp;
  last_month timestamp;
  month_span integer;
begin
  if report_start is null or report_end is null or report_end <= report_start then
    raise exception using errcode = 'P0001', message = 'INVALID_PROFIT_RANGE';
  end if;

  first_month := date_trunc('month', report_start at time zone 'Asia/Bangkok');
  last_month := date_trunc(
    'month',
    (report_end - interval '1 microsecond') at time zone 'Asia/Bangkok'
  );

  month_span := (
    (date_part('year', last_month)::integer * 12 + date_part('month', last_month)::integer)
    - (date_part('year', first_month)::integer * 12 + date_part('month', first_month)::integer)
  ) + 1;

  if month_span > 36 then
    raise exception using errcode = 'P0001', message = 'INVALID_PROFIT_RANGE';
  end if;

  return query
  select
    to_char(series.month_start, 'YYYY-MM'),
    summary.revenue,
    summary.order_count,
    summary.item_count,
    summary.cogs,
    summary.gross_profit,
    summary.costed_revenue,
    summary.uncosted_revenue,
    summary.costed_item_count,
    summary.uncosted_item_count,
    summary.purchase_cost,
    summary.cash_profit
  from generate_series(first_month, last_month, interval '1 month') as series(month_start)
  cross join lateral public.get_profit_summary(
    series.month_start at time zone 'Asia/Bangkok',
    (series.month_start + interval '1 month') at time zone 'Asia/Bangkok'
  ) as summary
  order by series.month_start;
end;
$$;

-- The lot ledger. total_items and total_lot_cost are window aggregates over
-- the whole filtered set rather than the returned page, so the page footer can
-- state the real totals without a second round trip.
create or replace function public.get_ingredient_purchases(
  report_start timestamptz,
  report_end timestamptz,
  filter_ingredient uuid,
  result_limit integer,
  result_offset integer
)
returns table(
  id uuid,
  ingredient_id uuid,
  ingredient_name text,
  unit text,
  purchased_on date,
  quantity numeric,
  total_cost numeric,
  unit_cost numeric,
  note text,
  total_items bigint,
  total_lot_cost numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with filtered as (
    select
      purchase.id,
      purchase.ingredient_id,
      ingredient.name as ingredient_name,
      purchase.unit,
      purchase.purchased_on,
      purchase.quantity,
      purchase.total_cost,
      round(purchase.total_cost / nullif(purchase.quantity, 0), 2) as unit_cost,
      purchase.note,
      purchase.created_at,
      count(*) over () as total_items,
      sum(purchase.total_cost) over () as total_lot_cost
    from public.ingredient_purchases purchase
    join public.ingredients ingredient on ingredient.id = purchase.ingredient_id
    where report_end > report_start
      and purchase.purchased_on >= ((report_start at time zone 'Asia/Bangkok')::date)
      and purchase.purchased_on <= (
        ((report_end - interval '1 microsecond') at time zone 'Asia/Bangkok')::date
      )
      and (filter_ingredient is null or purchase.ingredient_id = filter_ingredient)
  )
  select
    filtered.id,
    filtered.ingredient_id,
    filtered.ingredient_name,
    filtered.unit,
    filtered.purchased_on,
    filtered.quantity,
    filtered.total_cost,
    filtered.unit_cost,
    filtered.note,
    filtered.total_items,
    filtered.total_lot_cost
  from filtered
  order by filtered.purchased_on desc, filtered.created_at desc
  limit least(greatest(coalesce(result_limit, 20), 1), 200)
  offset greatest(coalesce(result_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- create or replace with a new argument list creates a NEW function that
-- inherits PUBLIC EXECUTE, so every signature created above is revoked
-- explicitly here. The POS server reaches these through service_role only.
-- ---------------------------------------------------------------------------

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
