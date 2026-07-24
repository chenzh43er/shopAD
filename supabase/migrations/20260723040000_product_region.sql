-- 商品关联地区（address_libraries）
alter table public.products
  add column if not exists region_id uuid
    references public.address_libraries (id) on delete set null;

create index if not exists products_region_id_idx
  on public.products (region_id);

comment on column public.products.region_id is '关联地区（地区管理）';
