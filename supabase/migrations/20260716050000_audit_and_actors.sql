-- 操作人追踪 + 统一审计日志 + 货到付款审核

-- ---------------------------------------------------------------------------
-- products: 创建人 / 修改人
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

comment on column public.products.created_by is '商品添加人';
comment on column public.products.updated_by is '最后修改人';

create index if not exists products_created_by_idx on public.products (created_by);
create index if not exists products_updated_by_idx on public.products (updated_by);

-- ---------------------------------------------------------------------------
-- orders: 创建人 / 修改人 / 审核人 + 支付类别 + 审核状态
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists payment_type text not null default 'non_cod'
    check (payment_type in ('cod', 'non_cod')),
  add column if not exists review_status text not null default 'not_required'
    check (review_status in ('not_required', 'pending', 'approved', 'rejected'));

comment on column public.orders.created_by is '订单创建人（后台录入时）';
comment on column public.orders.updated_by is '最后修改人';
comment on column public.orders.reviewed_by is '订单审核人（货到付款）';
comment on column public.orders.reviewed_at is '审核时间';
comment on column public.orders.payment_type is '支付类别：cod=货到付款，non_cod=非货到付款';
comment on column public.orders.review_status is '审核状态：仅货到付款需 pending/approved/rejected';

create index if not exists orders_created_by_idx on public.orders (created_by);
create index if not exists orders_updated_by_idx on public.orders (updated_by);
create index if not exists orders_reviewed_by_idx on public.orders (reviewed_by);
create index if not exists orders_payment_type_idx on public.orders (payment_type);
create index if not exists orders_review_status_idx on public.orders (review_status);

-- 回填：已有货到付款特征的订单
update public.orders
set
  payment_type = 'cod',
  review_status = case
    when status in ('shipped', 'completed') then 'approved'
    when status = 'cancelled' then 'rejected'
    else 'pending'
  end
where payment_type = 'non_cod'
  and (
    payment_method ilike '%货到付款%'
    or payment_method ilike '%cod%'
    or coalesce(cod_amount, 0) > 0
  );

-- 非 COD 统一不需审核
update public.orders
set review_status = 'not_required'
where payment_type = 'non_cod'
  and review_status <> 'not_required';

-- ---------------------------------------------------------------------------
-- audit_logs: 订单/商品统一变更日志
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order', 'product')),
  entity_id uuid not null,
  action text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  actor_email text,
  from_value text,
  to_value text,
  changes jsonb,
  remark text,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is '订单/商品统一操作与状态变更日志';
comment on column public.audit_logs.action is '如 create/update/status_change/review/delete/remark_update/packages_update';

create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_id);
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;
