-- COD 独立履约状态：cod_shipped / cod_completed

alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (
    status in (
      'pending',
      'paid',
      'shipped',
      'cod_shipped',
      'completed',
      'cod_completed',
      'cancelled'
    )
  );

-- 已有 COD 订单的 shipped/completed 迁移为 COD 专用状态
update public.orders
set status = 'cod_shipped'
where payment_type = 'cod'
  and status = 'shipped';

update public.orders
set status = 'cod_completed'
where payment_type = 'cod'
  and status = 'completed';
