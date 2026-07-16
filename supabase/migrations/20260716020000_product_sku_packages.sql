-- 规格属性 + 套餐（红框必要字段）
-- 规格值(后端SKU) → 复用 products.sku_code（不重复建列）
-- SKU 不存价格：售价只在套餐上

-- ---------------------------------------------------------------------------
-- products: 前端显示 SKU（对应外语）
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists sku_display text;

comment on column public.products.sku_code is '规格值 / 后端SKU（物流「中文属性」）';
comment on column public.products.sku_display is '对应外语 / 前端显示SKU';

-- ---------------------------------------------------------------------------
-- product_packages: 套餐（价格在此）
-- ---------------------------------------------------------------------------
create table if not exists public.product_packages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  name_external text not null,
  original_price numeric(12, 2) not null check (original_price >= 0),
  discount_price numeric(12, 2) check (discount_price is null or discount_price >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_packages is '商品套餐；原价/折扣价在套餐层，不在SKU';
comment on column public.product_packages.name is '套餐名称';
comment on column public.product_packages.name_external is '套餐名称(外文)';
comment on column public.product_packages.original_price is '套餐原价';
comment on column public.product_packages.discount_price is '套餐折扣价';

create index if not exists product_packages_product_id_idx
  on public.product_packages (product_id);

drop trigger if exists product_packages_set_updated_at on public.product_packages;
create trigger product_packages_set_updated_at
  before update on public.product_packages
  for each row execute function public.set_updated_at();

alter table public.product_packages enable row level security;

-- ---------------------------------------------------------------------------
-- product_package_items: 套餐明细
-- ---------------------------------------------------------------------------
create table if not exists public.product_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.product_packages (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  independent_attrs boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.product_package_items is '套餐明细行';
comment on column public.product_package_items.quantity is '数量';
comment on column public.product_package_items.independent_attrs is '是否每个商品独立选择属性';

create index if not exists product_package_items_package_id_idx
  on public.product_package_items (package_id);

alter table public.product_package_items enable row level security;
