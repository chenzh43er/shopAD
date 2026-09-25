-- 商品 / 套餐多语言覆盖表
-- 约定：products / product_packages 主表 = 默认语言（印尼站 + /sa 阿语回退）
--       locale = 'en' → 店面路径 /sa_en/{link_suffix}；未来 fr → /sa_fr 等

create table if not exists public.product_locales (
  product_id uuid not null references public.products (id) on delete cascade,
  locale text not null,
  title_external text,
  facebook_pixel_id text,
  google_conversion_id text,
  google_label text,
  description text,
  description_entries text[] not null default '{}',
  cover_url text,
  gallery_urls text[] not null default '{}',
  detail_image_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, locale),
  constraint product_locales_locale_chk check (
    locale ~ '^[a-z]{2}(-[a-z]{2})?$'
    and locale <> 'id'
  )
);

comment on table public.product_locales is
  'Storefront locale overlays; en → /sa_en. Base products.* remains default.';

create index if not exists product_locales_locale_idx
  on public.product_locales (locale);

create table if not exists public.product_package_locales (
  package_id uuid not null references public.product_packages (id) on delete cascade,
  locale text not null,
  name text not null default '',
  name_external text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (package_id, locale),
  constraint product_package_locales_locale_chk check (
    locale ~ '^[a-z]{2}(-[a-z]{2})?$'
    and locale <> 'id'
  )
);

comment on table public.product_package_locales is
  'Package name overlays per storefront locale (e.g. en for /sa_en).';

create index if not exists product_package_locales_locale_idx
  on public.product_package_locales (locale);

alter table public.product_locales enable row level security;
alter table public.product_package_locales enable row level security;

-- storefront 只读：仅当商品在售时可读覆盖行
grant select on table public.product_locales to storefront;
grant select on table public.product_package_locales to storefront;

drop policy if exists storefront_select_product_locales on public.product_locales;
create policy storefront_select_product_locales
  on public.product_locales
  for select
  to storefront
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.status = 'on_sale'
    )
  );

drop policy if exists storefront_select_product_package_locales
  on public.product_package_locales;
create policy storefront_select_product_package_locales
  on public.product_package_locales
  for select
  to storefront
  using (
    exists (
      select 1
      from public.product_packages pp
      join public.products p on p.id = pp.product_id
      where pp.id = package_id
        and pp.is_visible = true
        and p.status = 'on_sale'
    )
  );
