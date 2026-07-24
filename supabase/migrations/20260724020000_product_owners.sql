-- 商品多所属人：一个商品可关联多名员工；仅超级管理员在后台维护
create table if not exists public.product_owners (
  product_id uuid not null references public.products (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  primary key (product_id, profile_id)
);

comment on table public.product_owners is '商品所属人（多对多）；员工据此管理商品与关联订单';
comment on column public.product_owners.created_by is '添加该所属关系的操作人';

create index if not exists product_owners_profile_id_idx
  on public.product_owners (profile_id);

-- 从历史单所属人（products.created_by）回填
insert into public.product_owners (product_id, profile_id, created_by)
select p.id, p.created_by, p.created_by
from public.products p
where p.created_by is not null
on conflict (product_id, profile_id) do nothing;
