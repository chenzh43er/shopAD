-- 发货时填写：发货订单号（财务/物流导出「订单号」）、归属成员已存在

alter table public.orders
  add column if not exists shipping_order_no text;

comment on column public.orders.shipping_order_no is
  '发货订单号（财务导出「订单号」/物流导出「电商订单号」）';

create index if not exists orders_shipping_order_no_idx
  on public.orders (shipping_order_no);
