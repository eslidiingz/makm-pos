-- Require reorder requests to contain the complete active set. This keeps
-- sort_order contiguous and prevents partial lists from creating collisions.

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
    or cardinality(ordered_ids) <> (
      select count(*)::integer from public.categories where archived_at is null
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
    or cardinality(ordered_ids) <> (
      select count(*)::integer
      from public.products product
      where product.category_id = category and product.archived_at is null
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
