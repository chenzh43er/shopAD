-- COD 待审核履约状态：awaiting_review（不再使用 pending/待支付）

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
      'cancelled'
    )
  );

-- 历史 COD「待支付」纠正为待审核
update public.orders
set status = 'awaiting_review'
where payment_type = 'cod'
  and review_status = 'pending'
  and status in ('pending', 'paid');

comment on column public.orders.status is
  '订单状态；COD：awaiting_review → awaiting_shipment → cod_shipped → cod_completed，无 pending/paid';
