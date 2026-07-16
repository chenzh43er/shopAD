-- Product carousel / gallery images
alter table public.products
  add column if not exists gallery_urls text[] not null default '{}';

comment on column public.products.gallery_urls is '商品轮播图 URL 列表，最多 20 张';
