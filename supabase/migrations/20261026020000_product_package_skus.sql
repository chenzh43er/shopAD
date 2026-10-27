-- 独立属性改为归属套餐：套餐开启「独立选属性」后，可为该套餐添加多个属性
-- 每个属性有单独的前端SKU名称、后端SKU与图片。
-- 唯一性：
--   后端SKU 全站唯一（含大小写/首尾空格归一，含商品单一SKU）；
--   前端SKU名称同一套餐内唯一。

-- 旧的商品级独立属性结构（未被使用）直接移除
drop table if exists public.product_skus;
drop function if exists public.product_sku_code_taken(text, uuid);

alter table public.products
  drop column if exists independent_attrs_enabled;

create table if not exists public.product_package_skus (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.product_packages (id) on delete cascade,
  sku_display text not null,
  sku_code text not null,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_package_skus is
  '套餐独立属性（多规格SKU）：前端SKU名称 + 后端SKU + 图片';
comment on column public.product_package_skus.sku_display is
  '前端显示SKU名称（同一套餐内唯一）';
comment on column public.product_package_skus.sku_code is
  '后端SKU / 中文属性（全站唯一）';
comment on column public.product_package_skus.image_url is
  '该独立属性对应的图片';
comment on column public.product_package_skus.sort_order is
  '展示/导出排序';

create unique index if not exists product_package_skus_code_uidx
  on public.product_package_skus (lower(btrim(sku_code)));

create unique index if not exists product_package_skus_package_display_uidx
  on public.product_package_skus (package_id, lower(btrim(sku_display)));

create index if not exists product_package_skus_package_id_idx
  on public.product_package_skus (package_id);

drop trigger if exists product_package_skus_set_updated_at on public.product_package_skus;
create trigger product_package_skus_set_updated_at
  before update on public.product_package_skus
  for each row execute function public.set_updated_at();

alter table public.product_package_skus enable row level security;

-- 后端SKU 全站唯一检查：跨套餐属性与商品单一SKU，忽略大小写/首尾空格
-- p_exclude_product_id：整组替换时排除当前商品已有的套餐属性
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
    join public.product_packages pkg on pkg.id = s.package_id
    where lower(btrim(s.sku_code)) = lower(btrim(p_code))
      and (p_exclude_product_id is null or pkg.product_id <> p_exclude_product_id)
  )
  or exists (
    select 1
    from public.products p
    where btrim(coalesce(p.sku_code, '')) <> ''
      and lower(btrim(p.sku_code)) = lower(btrim(p_code))
  );
$$;

comment on function public.product_sku_code_taken(text, uuid) is
  '后端SKU是否已被占用（跨套餐属性与单一SKU，全站唯一）';

-- 落地页角色只读：仅可读取在售、可见套餐下的独立属性（角色不存在时跳过）
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'storefront') then
    execute 'grant select on table public.product_package_skus to storefront';
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'storefront') then
    execute 'drop policy if exists storefront_select_package_skus on public.product_package_skus';
    execute $policy$
      create policy storefront_select_package_skus
        on public.product_package_skus
        for select
        to storefront
        using (
          exists (
            select 1
            from public.product_packages pp
            join public.products p on p.id = pp.product_id
            where pp.id = package_id
              and pp.is_visible = true
              and p.status = 'on_sale'
          )
        )
    $policy$;
  end if;
end
$$;
