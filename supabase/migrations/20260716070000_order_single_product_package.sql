-- 一单一品：订单直接挂商品 + 套餐快照，不再使用 order_items 多明细

-- ---------------------------------------------------------------------------
-- orders: 商品 / 套餐 / 数量（售价快照）
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists product_id uuid references public.products (id) on delete set null,
  add column if not exists product_name text not null default '',
  add column if not exists package_id uuid references public.product_packages (id) on delete set null,
  add column if not exists package_name text,
  add column if not exists package_name_external text,
  add column if not exists unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  add column if not exists quantity integer not null default 1 check (quantity > 0),
  add column if not exists sku_code text;

comment on column public.orders.product_id is '购买商品（一单一品）';
comment on column public.orders.product_name is '下单时商品名称快照';
comment on column public.orders.package_id is '购买套餐';
comment on column public.orders.package_name is '下单时套餐名称快照';
comment on column public.orders.package_name_external is '下单时套餐外文名快照';
comment on column public.orders.unit_price is '下单时售价快照（通常取套餐折扣价/原价）';
comment on column public.orders.quantity is '购买数量（套餐份数）';
comment on column public.orders.sku_code is '下单时中文属性码快照';

create index if not exists orders_product_id_idx on public.orders (product_id);
create index if not exists orders_package_id_idx on public.orders (package_id);

-- ---------------------------------------------------------------------------
-- 从旧 order_items 迁入：每个订单只保留第一行明细
-- ---------------------------------------------------------------------------
update public.orders o
set
  product_id = oi.product_id,
  product_name = coalesce(nullif(oi.product_name, ''), o.product_name),
  unit_price = oi.unit_price,
  quantity = oi.quantity,
  sku_code = oi.sku_code
from (
  select distinct on (order_id)
    order_id,
    product_id,
    product_name,
    unit_price,
    quantity,
    sku_code
  from public.order_items
  order by order_id, id
) oi
where o.id = oi.order_id;

-- ---------------------------------------------------------------------------
-- 去掉多明细表
-- ---------------------------------------------------------------------------
drop table if exists public.order_items;
