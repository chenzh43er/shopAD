-- COD 审核通过后进入「待发货」状态 awaiting_shipment

alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (
    status in (
      'pending',
      'paid',
      'awaiting_shipment',
      'shipped',
      'cod_shipped',
      'completed',
      'cod_completed',
      'cancelled'
    )
  );

-- 已审核通过、尚未发货的 COD 单迁移为待发货
update public.orders
set status = 'awaiting_shipment'
where payment_type = 'cod'
  and review_status = 'approved'
  and status in ('pending', 'paid');

comment on column public.orders.status is
  '订单状态；COD 审核通过后为 awaiting_shipment（待发货）';
