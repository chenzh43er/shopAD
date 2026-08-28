-- Align list indexes with GET /api/orders sort (created_at desc), not updated_at.
-- Existing orders_list_*_updated_* indexes still help exports / updated_at sorts.

create index if not exists orders_list_cod_created_idx
  on public.orders (payment_type, status, review_status, created_at desc);

create index if not exists orders_list_payment_status_created_idx
  on public.orders (payment_type, status, created_at desc);

create index if not exists orders_list_payment_created_idx
  on public.orders (payment_type, created_at desc);

create index if not exists orders_product_created_idx
  on public.orders (product_id, created_at desc);

-- Employee product ownership lookups (product_id side of join)
create index if not exists product_owners_product_id_idx
  on public.product_owners (product_id);
