-- 无效订单拒绝理由（与普通备注分离）

alter table public.orders
  add column if not exists reject_reason text;

comment on column public.orders.reject_reason is '无效订单拒绝理由（自定义必填）';

-- 回填：已取消且备注非空、尚无拒绝理由的订单
update public.orders
set reject_reason = remark
where status = 'cancelled'
  and reject_reason is null
  and remark is not null
  and btrim(remark) <> '';
