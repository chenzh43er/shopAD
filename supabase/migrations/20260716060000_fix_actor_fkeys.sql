-- Fix actor FKs for PostgREST embed (profiles!created_by / updated_by / reviewed_by)
-- Idempotent: ensure columns → clear orphans → add named FKs

-- ---------------------------------------------------------------------------
-- Ensure columns exist (WITHOUT inline REFERENCES — those are added below)
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

alter table public.orders
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_type'
  ) then
    alter table public.orders
      add column payment_type text not null default 'non_cod'
      check (payment_type in ('cod', 'non_cod'));
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'review_status'
  ) then
    alter table public.orders
      add column review_status text not null default 'not_required'
      check (review_status in ('not_required', 'pending', 'approved', 'rejected'));
  end if;
end $$;

comment on column public.products.created_by is '商品添加人';
comment on column public.products.updated_by is '最后修改人';
comment on column public.orders.created_by is '订单创建人（后台录入时）';
comment on column public.orders.updated_by is '最后修改人';
comment on column public.orders.reviewed_by is '订单审核人（货到付款）';

create index if not exists products_created_by_idx on public.products (created_by);
create index if not exists products_updated_by_idx on public.products (updated_by);
create index if not exists orders_created_by_idx on public.orders (created_by);
create index if not exists orders_updated_by_idx on public.orders (updated_by);
create index if not exists orders_reviewed_by_idx on public.orders (reviewed_by);

-- ---------------------------------------------------------------------------
-- Clear orphan actor ids BEFORE adding FKs
-- ---------------------------------------------------------------------------
update public.products p
set created_by = null
where created_by is not null
  and not exists (select 1 from public.profiles pr where pr.id = p.created_by);

update public.products p
set updated_by = null
where updated_by is not null
  and not exists (select 1 from public.profiles pr where pr.id = p.updated_by);

update public.orders o
set created_by = null
where created_by is not null
  and not exists (select 1 from public.profiles pr where pr.id = o.created_by);

update public.orders o
set updated_by = null
where updated_by is not null
  and not exists (select 1 from public.profiles pr where pr.id = o.updated_by);

update public.orders o
set reviewed_by = null
where reviewed_by is not null
  and not exists (select 1 from public.profiles pr where pr.id = o.reviewed_by);

-- ---------------------------------------------------------------------------
-- Named FKs required by Supabase embed: profiles!created_by etc.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_created_by_fkey'
  ) then
    alter table public.products
      add constraint products_created_by_fkey
      foreign key (created_by) references public.profiles (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'products_updated_by_fkey'
  ) then
    alter table public.products
      add constraint products_updated_by_fkey
      foreign key (updated_by) references public.profiles (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_created_by_fkey'
  ) then
    alter table public.orders
      add constraint orders_created_by_fkey
      foreign key (created_by) references public.profiles (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_updated_by_fkey'
  ) then
    alter table public.orders
      add constraint orders_updated_by_fkey
      foreign key (updated_by) references public.profiles (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_reviewed_by_fkey'
  ) then
    alter table public.orders
      add constraint orders_reviewed_by_fkey
      foreign key (reviewed_by) references public.profiles (id) on delete set null;
  end if;
end $$;
