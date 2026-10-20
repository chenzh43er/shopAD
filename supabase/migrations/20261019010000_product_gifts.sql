-- 商品赠品（一个商品可配置多个赠品）
-- 赠品本身也是一个商品，可选择赠品商品的某个套餐，并配置数量。

create table if not exists public.product_gifts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  gift_product_id uuid not null references public.products (id) on delete cascade,
  -- 赠品选用的套餐（可空：赠品商品未启用套餐时直接按商品发货）
  package_id uuid references public.product_packages (id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_gifts_no_self check (product_id <> gift_product_id)
);

comment on table public.product_gifts is '商品赠品：赠品为另一商品，可指定其套餐与数量';
comment on column public.product_gifts.gift_product_id is '赠品商品';
comment on column public.product_gifts.package_id is '赠品商品选用的套餐（可空）';
comment on column public.product_gifts.quantity is '赠品数量（每单商品件数）';

create index if not exists product_gifts_product_id_idx
  on public.product_gifts (product_id);

create index if not exists product_gifts_gift_product_id_idx
  on public.product_gifts (gift_product_id);

-- 唯一性按「商品 + 套餐 + 数量」组合：同一赠品商品可重复添加不同套餐 / 数量
create unique index if not exists product_gifts_unique_combo_idx
  on public.product_gifts (
    product_id,
    gift_product_id,
    coalesce(package_id, '00000000-0000-0000-0000-000000000000'::uuid),
    quantity
  );

drop trigger if exists product_gifts_set_updated_at on public.product_gifts;
create trigger product_gifts_set_updated_at
  before update on public.product_gifts
  for each row execute function public.set_updated_at();

alter table public.product_gifts enable row level security;

-- storefront 只读：仅当主商品与赠品商品都在售时可读
grant select on table public.product_gifts to storefront;

drop policy if exists storefront_select_product_gifts on public.product_gifts;
create policy storefront_select_product_gifts
  on public.product_gifts
  for select
  to storefront
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.status = 'on_sale'
    )
    and exists (
      select 1
      from public.products g
      where g.id = gift_product_id
        and g.status = 'on_sale'
    )
  );

-- ---------------------------------------------------------------------------
-- orders: 赠品快照（下单时固化，物流导出按快照标注赠品）
-- 形如 [{"sku_code":"XX","name":"赠品名","quantity":2}]
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists gift_snapshot jsonb;

comment on column public.orders.gift_snapshot is
  '下单时赠品快照 [{sku_code,name,quantity}]，用于物流导出「中文属性*数量（赠品：…）」';
