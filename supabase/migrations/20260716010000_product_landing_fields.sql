-- Product landing fields from admin form (red-box required only)
-- 链接后缀 / 商品标题(外部) / Facebook像素 / Google转化ID
-- 商品标题(内部) → 复用 products.name
-- 商品封面 → 复用 products.cover_url

alter table public.products
  add column if not exists link_suffix text,
  add column if not exists title_external text,
  add column if not exists facebook_pixel_id text,
  add column if not exists google_conversion_id text;

comment on column public.products.name is '商品标题(内部)';
comment on column public.products.cover_url is '商品封面（聚合页/后台列表）';
comment on column public.products.link_suffix is '链接后缀，用于落地页 URL';
comment on column public.products.title_external is '商品标题(外部)，面向站点展示';
comment on column public.products.facebook_pixel_id is 'Facebook像素id，多个用#分隔';
comment on column public.products.google_conversion_id is 'Google转化ID';

-- Unique when set (multiple NULLs allowed)
create unique index if not exists products_link_suffix_uidx
  on public.products (link_suffix)
  where link_suffix is not null;
