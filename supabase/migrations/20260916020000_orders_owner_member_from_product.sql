-- 下单时自动写入归属成员：按商品所属人 display_name（多名以「、」连接）
-- 覆盖 product-1/2 storefront INSERT 及一切写入 orders 的路径。

create or replace function public.product_owner_member_label(p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    string_agg(
      nullif(trim(p.display_name), ''),
      '、'
      order by p.display_name nulls last, p.id
    ),
    ''
  )
  from public.product_owners po
  join public.profiles p on p.id = po.profile_id
  where po.product_id = p_product_id;
$$;

comment on function public.product_owner_member_label(uuid) is
  '商品所属人 display_name 聚合（顿号连接）；供下单写入 orders.owner_member';

revoke all on function public.product_owner_member_label(uuid) from public;
grant execute on function public.product_owner_member_label(uuid) to storefront;
grant execute on function public.product_owner_member_label(uuid) to authenticated;
grant execute on function public.product_owner_member_label(uuid) to service_role;

create or replace function public.orders_set_owner_member_from_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  label text;
begin
  if new.product_id is null then
    return new;
  end if;

  label := public.product_owner_member_label(new.product_id);
  if label is null then
    return new;
  end if;

  -- INSERT：始终按商品所属人写入
  -- UPDATE：仅 product_id 变更，或归属成员为空时补齐
  if tg_op = 'INSERT' then
    new.owner_member := label;
  elsif new.product_id is distinct from old.product_id then
    new.owner_member := label;
  elsif coalesce(nullif(trim(new.owner_member), ''), '') = '' then
    new.owner_member := label;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_set_owner_member_from_product_trg on public.orders;
create trigger orders_set_owner_member_from_product_trg
  before insert or update of product_id, owner_member
  on public.orders
  for each row
  execute function public.orders_set_owner_member_from_product();

comment on column public.orders.owner_member is
  '归属成员（财务导出）；下单时按商品所属人自动写入，多名以顿号连接';

-- 回填已有订单
with product_owner_labels as (
  select
    po.product_id,
    string_agg(
      nullif(trim(p.display_name), ''),
      '、'
      order by p.display_name nulls last, p.id
    ) as owner_label
  from public.product_owners po
  join public.profiles p on p.id = po.profile_id
  group by po.product_id
)
update public.orders o
set owner_member = pol.owner_label
from product_owner_labels pol
where o.product_id = pol.product_id
  and pol.owner_label is not null
  and pol.owner_label <> ''
  and coalesce(nullif(trim(o.owner_member), ''), '')
    is distinct from pol.owner_label;
