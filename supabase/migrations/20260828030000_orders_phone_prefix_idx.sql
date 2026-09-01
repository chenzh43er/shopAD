-- 手机号前缀搜索：text_pattern_ops 支持 customer_phone LIKE 'digits%'
create index if not exists orders_customer_phone_pattern_idx
  on public.orders (customer_phone text_pattern_ops);

comment on index public.orders_customer_phone_pattern_idx is
  'Supports prefix ilike/like on customer_phone for order phone search';
