-- 当前业务不需要库存字段
alter table public.products
  drop column if exists stock;
