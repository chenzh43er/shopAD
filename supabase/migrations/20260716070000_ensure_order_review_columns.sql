-- Ensure COD review columns exist on orders (fix missing review_status / payment_type)

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_type'
  ) then
    alter table public.orders
      add column payment_type text not null default 'non_cod';
    alter table public.orders
      add constraint orders_payment_type_check
      check (payment_type in ('cod', 'non_cod'));
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'review_status'
  ) then
    alter table public.orders
      add column review_status text not null default 'not_required';
    alter table public.orders
      add constraint orders_review_status_check
      check (review_status in ('not_required', 'pending', 'approved', 'rejected'));
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'reviewed_by'
  ) then
    alter table public.orders add column reviewed_by uuid;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'reviewed_at'
  ) then
    alter table public.orders add column reviewed_at timestamptz;
  end if;
end $$;

comment on column public.orders.payment_type is '支付类别：cod=货到付款，non_cod=非货到付款';
comment on column public.orders.review_status is '审核状态：仅货到付款需 pending/approved/rejected';
comment on column public.orders.reviewed_by is '订单审核人（货到付款）';
comment on column public.orders.reviewed_at is '审核时间';

create index if not exists orders_payment_type_idx on public.orders (payment_type);
create index if not exists orders_review_status_idx on public.orders (review_status);
create index if not exists orders_reviewed_by_idx on public.orders (reviewed_by);

-- Backfill COD from existing fields
update public.orders
set
  payment_type = 'cod',
  review_status = case
    when status in ('shipped', 'completed') then 'approved'
    when status = 'cancelled' then 'rejected'
    else 'pending'
  end
where coalesce(payment_type, 'non_cod') = 'non_cod'
  and (
    payment_method ilike '%货到付款%'
    or payment_method ilike '%cod%'
    or coalesce(cod_amount, 0) > 0
  );

update public.orders
set review_status = 'not_required'
where payment_type = 'non_cod'
  and review_status is distinct from 'not_required';
