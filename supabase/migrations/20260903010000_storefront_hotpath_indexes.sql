-- product-1 / product-2 落地页热点查询索引
-- 路径：link_suffix → 在售商品 → 可见套餐 → 地区树 / 省市区校验 / 下单去重

-- ---------------------------------------------------------------------------
-- 1) 按 link_suffix 点查（含 status / 关联键，利于轻量 SELECT + 过滤 on_sale）
--    原唯一约束保留；INCLUDE 避免只为取 region_id/id 时多余堆访问
-- ---------------------------------------------------------------------------
drop index if exists public.products_link_suffix_uidx;

create unique index products_link_suffix_uidx
  on public.products (link_suffix)
  include (id, status, region_id, currency_id)
  where link_suffix is not null;

comment on index public.products_link_suffix_uidx is
  'Storefront/admin unique link_suffix; INCLUDE covers on_sale filter + FK joins';

-- 在售子集：与 RLS / WHERE status = on_sale 对齐，避免扫到已下架行的堆页
create index if not exists products_on_sale_link_suffix_idx
  on public.products (link_suffix)
  include (id, region_id, currency_id, packages_enabled, price)
  where status = 'on_sale'
    and link_suffix is not null;

comment on index public.products_on_sale_link_suffix_idx is
  'Hot path: product-1/2 WHERE link_suffix = ? AND status = on_sale';

-- ---------------------------------------------------------------------------
-- 2) 可见套餐：WHERE product_id = ? AND is_visible，再按 sort_order/created_at
-- ---------------------------------------------------------------------------
create index if not exists product_packages_visible_by_product_idx
  on public.product_packages (product_id, sort_order, created_at)
  where is_visible = true;

comment on index public.product_packages_visible_by_product_idx is
  'Storefront visible packages for a single product';

-- ---------------------------------------------------------------------------
-- 3) 地区树拉取：library_id + level 1..3，按 level/sort_order/name 有序扫描
-- ---------------------------------------------------------------------------
create index if not exists address_regions_library_tree_idx
  on public.address_regions (library_id, level, sort_order, name)
  where level between 1 and 3;

comment on index public.address_regions_library_tree_idx is
  'Compact region tree fetch for checkout (levels 1-3)';

-- 省市区路径校验：按 library + level + name 定位节点
create index if not exists address_regions_library_level_name_idx
  on public.address_regions (library_id, level, name);

comment on index public.address_regions_library_level_name_idx is
  'Region path validation (province/city/district by name)';

-- 更宽的 (library_id, level, sort…) 已覆盖旧 (library_id, level)
drop index if exists public.address_regions_library_level_idx;

-- ---------------------------------------------------------------------------
-- 4) 下单短窗去重：storefront_has_recent_order(phone, product_id, created_at)
-- ---------------------------------------------------------------------------
create index if not exists orders_phone_product_created_idx
  on public.orders (customer_phone, product_id, created_at desc);

comment on index public.orders_phone_product_created_idx is
  'storefront_has_recent_order: same phone + product within short window';
