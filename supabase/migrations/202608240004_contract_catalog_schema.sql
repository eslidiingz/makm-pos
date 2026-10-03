-- Forward-only contract migration. The legacy category column is removed only
-- after the preceding backfill has populated category_id.

do $$
begin
  if exists (select 1 from public.products where category_id is null) then
    raise exception 'Catalog backfill incomplete: products.category_id contains null values';
  end if;
end;
$$;

alter table public.products
  alter column category_id set not null,
  add constraint products_category_id_fkey
    foreign key (category_id) references public.categories(id) on delete restrict,
  add constraint products_name_length_check
    check (char_length(btrim(name)) between 1 and 80),
  add constraint products_sort_order_check check (sort_order >= 0),
  drop column category;

create unique index categories_active_name_unique
  on public.categories (lower(btrim(name)))
  where archived_at is null;

create unique index products_active_category_name_unique
  on public.products (category_id, lower(btrim(name)))
  where archived_at is null;

create index products_category_sort_idx
  on public.products (category_id, sort_order)
  where archived_at is null;

create or replace function public.reorder_categories(ordered_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if cardinality(ordered_ids) = 0
    or cardinality(ordered_ids) <> (
      select count(distinct value)::integer from unnest(ordered_ids) as value
    )
    or exists (
      select 1 from unnest(ordered_ids) as value
      left join public.categories category on category.id = value
      where category.id is null or category.archived_at is not null
    )
  then
    raise exception 'Invalid category reorder request';
  end if;

  update public.categories category
  set sort_order = positions.ordinality - 1
  from unnest(ordered_ids) with ordinality as positions(id, ordinality)
  where category.id = positions.id;
end;
$$;

create or replace function public.reorder_products(category uuid, ordered_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if cardinality(ordered_ids) = 0
    or cardinality(ordered_ids) <> (
      select count(distinct value)::integer from unnest(ordered_ids) as value
    )
    or exists (
      select 1 from unnest(ordered_ids) as value
      left join public.products product on product.id = value
      where product.id is null
        or product.archived_at is not null
        or product.category_id <> category
    )
  then
    raise exception 'Invalid product reorder request';
  end if;

  update public.products product
  set sort_order = positions.ordinality - 1
  from unnest(ordered_ids) with ordinality as positions(id, ordinality)
  where product.id = positions.id and product.category_id = category;
end;
$$;

revoke all on function public.reorder_categories(uuid[]) from public, anon, authenticated;
revoke all on function public.reorder_products(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_categories(uuid[]) to service_role;
grant execute on function public.reorder_products(uuid, uuid[]) to service_role;
