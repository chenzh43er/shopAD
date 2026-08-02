-- 商品描述条目：落地页「卖点 / Yang Anda Dapatkan」多条列表
alter table public.products
  add column if not exists description_entries text[] not null default '{}';

comment on column public.products.description_entries is
  '商品描述条目列表（落地页按顺序展示为卖点）';
