-- Speed up COD order list / export: filter + sort by updated_at
create index if not exists orders_updated_at_idx
  on public.orders (updated_at desc);

-- Default COD tabs: payment_type + status + review_status + updated_at
create index if not exists orders_list_cod_idx
  on public.orders (payment_type, status, review_status, updated_at desc);

-- Export / tabs without review filter
create index if not exists orders_list_payment_status_updated_idx
  on public.orders (payment_type, status, updated_at desc);

-- Staff scoped lists: product_id IN (...) ordered by updated_at
create index if not exists orders_product_updated_idx
  on public.orders (product_id, updated_at desc);
