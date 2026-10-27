-- 套餐独立属性：下单时按件固化每个商品选择的后端SKU（中文属性）
-- 形如 [{"sku_code":"s红","sku_display":"红色","quantity":1}]
-- 兼容旧订单：列为空时继续使用 orders.sku_code。

alter table public.orders
  add column if not exists sku_snapshot jsonb;

comment on column public.orders.sku_snapshot is
  '下单时套餐独立属性快照 [{sku_code, sku_display, quantity}]；按中文属性合并件数';

-- storefront 角色已授予 orders 表级 INSERT/SELECT，新列自动可用；显式补列级授权兜底。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'storefront') then
    execute 'grant insert (sku_snapshot), select (sku_snapshot) on table public.orders to storefront';
  end if;
end
$$;
