-- product-1 落地页专用登录角色（直连 Postgres，非 PostgREST）
-- 目标：NOSUPERUSER / NOBYPASSRLS，仅可读展示所需表 + 可 INSERT 订单
-- 密码不在迁移中设置：部署后由管理员执行 ALTER ROLE storefront PASSWORD '...'

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'storefront') then
    create role storefront
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      noinherit;
  end if;
end
$$;

-- 允许用该角色建连（密码在库外配置）
alter role storefront with login;

grant usage on schema public to storefront;

-- 只读：落地页展示 / 校验所需
grant select on table public.products to storefront;
grant select on table public.product_packages to storefront;
grant select on table public.product_package_items to storefront;
grant select on table public.currencies to storefront;
grant select on table public.address_libraries to storefront;
grant select on table public.address_regions to storefront;
grant select on table public.logistics_shipper to storefront;

-- 下单：INSERT + 窄 SELECT（RETURNING 与 RLS 均需 SELECT；策略限制为近几分钟，禁止拖库）
grant insert, select on table public.orders to storefront;

-- 去重检查：SECURITY DEFINER，避免授予 orders SELECT
create or replace function public.storefront_has_recent_order(
  p_phone text,
  p_product_id uuid,
  p_within_seconds integer default 120
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders
    where customer_phone = p_phone
      and product_id = p_product_id
      and created_at > now() - (greatest(p_within_seconds, 1) * interval '1 second')
  );
$$;

revoke all on function public.storefront_has_recent_order(text, uuid, integer) from public;
grant execute on function public.storefront_has_recent_order(text, uuid, integer) to storefront;

-- RLS：显式允许 storefront（无策略时普通角色会被拒；service_role 仍旁路）
drop policy if exists storefront_select_on_sale_products on public.products;
create policy storefront_select_on_sale_products
  on public.products
  for select
  to storefront
  using (status = 'on_sale');

drop policy if exists storefront_select_visible_packages on public.product_packages;
create policy storefront_select_visible_packages
  on public.product_packages
  for select
  to storefront
  using (
    is_visible = true
    and exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.status = 'on_sale'
    )
  );

drop policy if exists storefront_select_package_items on public.product_package_items;
create policy storefront_select_package_items
  on public.product_package_items
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
  );

drop policy if exists storefront_select_currencies on public.currencies;
create policy storefront_select_currencies
  on public.currencies
  for select
  to storefront
  using (true);

drop policy if exists storefront_select_address_libraries on public.address_libraries;
create policy storefront_select_address_libraries
  on public.address_libraries
  for select
  to storefront
  using (true);

drop policy if exists storefront_select_address_regions on public.address_regions;
create policy storefront_select_address_regions
  on public.address_regions
  for select
  to storefront
  using (true);

drop policy if exists storefront_select_default_shipper on public.logistics_shipper;
create policy storefront_select_default_shipper
  on public.logistics_shipper
  for select
  to storefront
  using (is_default = true);

drop policy if exists storefront_insert_orders on public.orders;
create policy storefront_insert_orders
  on public.orders
  for insert
  to storefront
  with check (true);

-- 仅允许读极近写入的行（满足 INSERT RETURNING；避免全表可读）
drop policy if exists storefront_select_recent_orders on public.orders;
create policy storefront_select_recent_orders
  on public.orders
  for select
  to storefront
  using (created_at > now() - interval '5 minutes');

comment on role storefront is
  'product-1 storefront DB role: SELECT showcase tables + INSERT orders; no superuser/bypassrls';
