-- Daily reports join order items by order_id. Cover both foreign keys before
-- sales volume grows so report and catalog integrity checks stay efficient.

create index order_items_order_id_idx
  on public.order_items (order_id);

create index order_items_product_id_idx
  on public.order_items (product_id)
  where product_id is not null;
