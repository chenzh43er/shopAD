-- 手机号查询（精确 / 前缀）；包含匹配仍可能扫表，但有助于常见等值场景
create index if not exists orders_customer_phone_idx
  on public.orders (customer_phone);
