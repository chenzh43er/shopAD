-- 独立属性 SKU 唯一性调整：
--   旧规则：sku_code 全站唯一（同一商品的不同套餐也不能重复）。
--   新规则：同一商品内不同套餐的 sku_code 允许重复，不同商品之间仍需唯一。
-- 约束拆分为：
--   1) 同一套餐内 sku_code / sku_display 唯一（package 级唯一索引）；
--   2) 同一个 sku_code 只能属于同一个商品（触发器 + 跨商品校验）。

alter table public.product_package_skus
  add column if not exists product_id uuid
    references public.products (id) on delete cascade;

-- 回填历史数据：由所属套餐推导商品
update public.product_package_skus s
set product_id = pkg.product_id
from public.product_packages pkg
where s.package_id = pkg.id
  and s.product_id is null;

alter table public.product_package_skus
  alter column product_id set not null;

create index if not exists product_package_skus_product_id_idx
  on public.product_package_skus (product_id);

comment on column public.product_package_skus.product_id is
  '所属商品（由套餐推导，触发器维护）；同一商品内 SKU 可跨套餐重复';

-- 全站唯一索引 → 套餐内唯一索引
drop index if exists public.product_package_skus_code_uidx;

create unique index if not exists product_package_skus_package_code_uidx
  on public.product_package_skus (package_id, lower(btrim(sku_code)));

-- 写入前：同步 product_id，并校验 sku_code 未被其他商品占用
create or replace function public.prepare_package_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
begin
  select pkg.product_id into v_product_id
  from public.product_packages pkg
  where pkg.id = new.package_id;

  if v_product_id is null then
    raise exception 'PACKAGE_NOT_FOUND_FOR_SKU';
  end if;

  new.product_id := v_product_id;

  if exists (
    select 1
    from public.product_package_skus s
    where s.product_id <> v_product_id
      and lower(btrim(s.sku_code)) = lower(btrim(new.sku_code))
  ) then
    raise exception 'SKU_CODE_USED_BY_OTHER_PRODUCT';
  end if;

  if exists (
    select 1
    from public.products p
    where p.id <> v_product_id
      and btrim(coalesce(p.sku_code, '')) <> ''
      and lower(btrim(p.sku_code)) = lower(btrim(new.sku_code))
  ) then
    raise exception 'SKU_CODE_USED_BY_OTHER_PRODUCT';
  end if;

  return new;
end;
$$;

drop trigger if exists product_package_skus_prepare on public.product_package_skus;
create trigger product_package_skus_prepare
  before insert or update on public.product_package_skus
  for each row execute function public.prepare_package_sku();

comment on function public.prepare_package_sku() is
  '维护 product_package_skus.product_id，并保证同一 sku_code 只属于同一个商品';

-- 后端SKU 占用检查：仅当被「其他商品」使用时才算占用（同商品跨套餐可重复）
create or replace function public.product_sku_code_taken(
  p_code text,
  p_exclude_product_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.product_package_skus s
    where lower(btrim(s.sku_code)) = lower(btrim(p_code))
      and (p_exclude_product_id is null or s.product_id <> p_exclude_product_id)
  )
  or exists (
    select 1
    from public.products p
    where btrim(coalesce(p.sku_code, '')) <> ''
      and lower(btrim(p.sku_code)) = lower(btrim(p_code))
      and (p_exclude_product_id is null or p.id <> p_exclude_product_id)
  );
$$;

comment on function public.product_sku_code_taken(text, uuid) is
  '后端SKU是否被其他商品占用（同一商品内可跨套餐重复）';
