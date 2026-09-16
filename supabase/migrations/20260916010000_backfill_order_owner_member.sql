-- 订单归属成员回填：按商品所属人（product_owners → profiles.display_name）
-- 多名所属人以顿号「、」连接；与发货/财务导出逻辑一致。

comment on column public.orders.owner_member is
  '归属成员（财务导出）；按商品所属人 display_name 写入，多名以顿号连接';

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
