-- Align package schema with 套餐设置 UI
alter table public.product_packages
  add column if not exists summary text,
  add column if not exists image_url text,
  add column if not exists is_visible boolean not null default true;

comment on column public.product_packages.summary is '套餐摘要';
comment on column public.product_packages.image_url is '套餐图片';
comment on column public.product_packages.is_visible is '是否前端可见';

alter table public.product_package_items
  add column if not exists ref_product_id uuid references public.products (id) on delete cascade;

comment on column public.product_package_items.ref_product_id is '套餐内商品';

create index if not exists product_package_items_ref_product_id_idx
  on public.product_package_items (ref_product_id);
