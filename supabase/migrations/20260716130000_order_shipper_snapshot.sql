-- 发货时把寄件人信息快照到订单（对齐物流导出模板左侧寄件栏）

alter table public.orders
  add column if not exists shipper_id uuid references public.logistics_shipper (id) on delete set null,
  add column if not exists shipper_name text,
  add column if not exists shipper_phone text,
  add column if not exists shipper_province text,
  add column if not exists shipper_city text,
  add column if not exists shipper_district text,
  add column if not exists shipper_address text,
  add column if not exists shipper_address_info text;

comment on column public.orders.shipper_id is '发货选用的寄件人配置';
comment on column public.orders.shipper_name is '寄件人（发货快照）';
comment on column public.orders.shipper_phone is '寄件人电话（发货快照）';
comment on column public.orders.shipper_province is '寄件省（发货快照）';
comment on column public.orders.shipper_city is '寄件城市（发货快照）';
comment on column public.orders.shipper_district is '寄件区域（发货快照）';
comment on column public.orders.shipper_address is '寄件地址（发货快照）';
comment on column public.orders.shipper_address_info is '寄件地址信息（发货快照）';

create index if not exists orders_shipper_id_idx on public.orders (shipper_id);
