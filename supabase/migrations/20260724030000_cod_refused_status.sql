-- COD 拒绝签收：已发货 → 已签收 / 拒绝签收

alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (
    status in (
      'pending',
      'paid',
      'awaiting_review',
      'awaiting_shipment',
      'shipped',
      'cod_shipped',
      'completed',
      'cod_completed',
      'cod_refused',
      'cancelled'
    )
  );

comment on column public.orders.status is
  '订单状态；COD：awaiting_review → awaiting_shipment → cod_shipped → cod_completed / cod_refused，无 pending/paid';
