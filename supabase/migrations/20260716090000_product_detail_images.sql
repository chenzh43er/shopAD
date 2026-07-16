-- Product detail plain text already uses products.description
-- Add dedicated detail images (separate from carousel gallery_urls)

alter table public.products
  add column if not exists detail_image_urls text[] not null default '{}';

comment on column public.products.description is '商品详情（纯文字）';
comment on column public.products.detail_image_urls is '商品详情图片 URL 列表';
comment on column public.products.gallery_urls is '商品轮播图 URL 列表';
