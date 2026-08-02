-- 虚拟销量：仅后台手填展示，不做真实增减
alter table public.products
  add column if not exists sales_count integer not null default 0;

comment on column public.products.sales_count is '虚拟销量（落地页展示，后台可编辑）';

alter table public.products
  drop constraint if exists products_sales_count_nonnegative;

alter table public.products
  add constraint products_sales_count_nonnegative check (sales_count >= 0);
