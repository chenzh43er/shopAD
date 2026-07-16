-- 是否开启套餐：控制落地页是否展示套餐选项
alter table public.products
  add column if not exists packages_enabled boolean not null default false;

comment on column public.products.packages_enabled is '是否开启套餐';
