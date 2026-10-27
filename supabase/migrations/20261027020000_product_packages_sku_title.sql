-- 套餐独立属性标题：用于落地页属性选择区分组标题（默认回退前端文案）
alter table public.product_packages
  add column if not exists sku_title text;

comment on column public.product_packages.sku_title is
  '独立属性标题（落地页属性选择区标题，留空时前端回退默认文案）';
