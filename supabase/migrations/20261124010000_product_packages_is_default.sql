-- 套餐默认选中：同一商品仅允许一个默认套餐
alter table public.product_packages
  add column if not exists is_default boolean not null default false;

comment on column public.product_packages.is_default is '是否默认选中（同一商品仅一个）';

-- 历史数据：每个商品把排序最靠前的套餐设为默认
with ranked as (
  select
    id,
    product_id,
    row_number() over (
      partition by product_id
      order by sort_order asc, created_at asc, id asc
    ) as rn
  from public.product_packages
),
missing as (
  select product_id
  from public.product_packages
  group by product_id
  having not bool_or(is_default)
)
update public.product_packages pp
set is_default = true
from ranked r
join missing m on m.product_id = r.product_id
where pp.id = r.id
  and r.rn = 1;

-- 防御重复默认：每个商品最多一个 is_default=true
create unique index if not exists product_packages_one_default_uidx
  on public.product_packages (product_id)
  where is_default;
