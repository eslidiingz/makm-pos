-- Forward-only data migration. It is safe to rerun because category names are
-- inserted only when no matching active category exists.

insert into public.categories (name, sort_order)
select source.category, source.position
from (
  select category, dense_rank() over (order by min(sort_order), category)::integer - 1 as position
  from public.products
  where category_id is null
  group by category
) as source
where not exists (
  select 1
  from public.categories existing
  where lower(btrim(existing.name)) = lower(btrim(source.category))
    and existing.archived_at is null
);

update public.products product
set category_id = category.id
from public.categories category
where product.category_id is null
  and lower(btrim(category.name)) = lower(btrim(product.category))
  and category.archived_at is null;
