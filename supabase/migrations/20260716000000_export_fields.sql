-- Fields for finance / logistics export templates
-- 财务系统导出模板 + 物流导出模板

-- ---------------------------------------------------------------------------
-- products: SKU code & logistics defaults used when composing export rows
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists sku_code text,
  add column if not exists weight numeric(10, 2) not null default 1
    check (weight >= 0),
  add column if not exists item_category text,
  add column if not exists item_type text not null default 'BARANG';

comment on column public.products.sku_code is '中文属性码，导出拼成「sku * 数量」';
comment on column public.products.weight is '默认重量（物流导出「重量」）';
comment on column public.products.item_category is '物品类别';
comment on column public.products.item_type is '物品类型（如 BARANG）';

create index if not exists products_sku_code_idx on public.products (sku_code);

-- ---------------------------------------------------------------------------
-- order_items: snapshot SKU / attr for「中文属性*数量」
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column if not exists sku_code text;

comment on column public.order_items.sku_code is '下单时商品中文属性码快照';

-- ---------------------------------------------------------------------------
-- orders: finance attribution + structured recipient + logistics fee fields
-- ---------------------------------------------------------------------------
alter table public.orders
  -- 财务：归属成员
  add column if not exists owner_member text,
  -- 物流：收件地址结构化（shipping_address 保留为完整「收件地址信息」）
  add column if not exists shipping_province text,
  add column if not exists shipping_city text,
  add column if not exists shipping_district text,
  add column if not exists shipping_detail text,
  -- 物流：支付与费用
  add column if not exists payment_method text,
  add column if not exists cod_amount numeric(12, 2)
    check (cod_amount is null or cod_amount >= 0),
  add column if not exists express_type text,
  add column if not exists shipping_fee numeric(12, 2)
    check (shipping_fee is null or shipping_fee >= 0),
  add column if not exists other_fee numeric(12, 2)
    check (other_fee is null or other_fee >= 0),
  -- 物流：包裹与保价
  add column if not exists package_count integer not null default 1
    check (package_count > 0),
  add column if not exists weight numeric(10, 2)
    check (weight is null or weight >= 0),
  add column if not exists insurance_type text,
  add column if not exists insurance_flag text,
  add column if not exists item_value numeric(12, 2)
    check (item_value is null or item_value >= 0),
  add column if not exists item_category text,
  add column if not exists item_type text,
  -- 物流：委托人（按单可覆盖寄件配置）
  add column if not exists consignor_flag text,
  add column if not exists consignor_name text,
  add column if not exists consignor_phone text;

comment on column public.orders.owner_member is '归属成员（财务导出）';
comment on column public.orders.shipping_province is '收件省';
comment on column public.orders.shipping_city is '收件城市';
comment on column public.orders.shipping_district is '收件地区';
comment on column public.orders.shipping_detail is '收件地址（街道明细）';
comment on column public.orders.shipping_address is '收件地址信息（完整地址字符串）';
comment on column public.orders.payment_method is '支付方式（如月结）';
comment on column public.orders.cod_amount is '代收货款';
comment on column public.orders.express_type is '快件类型（如 EZ）';
comment on column public.orders.shipping_fee is '应收运费';
comment on column public.orders.other_fee is '其它费';
comment on column public.orders.package_count is '件数';
comment on column public.orders.weight is '运单重量';
comment on column public.orders.insurance_type is '保价类型';
comment on column public.orders.insurance_flag is '保价费标识';
comment on column public.orders.item_value is '物品价值';
comment on column public.orders.item_category is '物品类别（运单级）';
comment on column public.orders.item_type is '物品类型（运单级）';
comment on column public.orders.consignor_flag is '委托人标识';
comment on column public.orders.consignor_name is '委托人姓名';
comment on column public.orders.consignor_phone is '委托人电话';

create index if not exists orders_owner_member_idx on public.orders (owner_member);
create index if not exists orders_shipping_city_idx on public.orders (shipping_city);

-- ---------------------------------------------------------------------------
-- logistics_shipper: 寄件人默认配置（物流导出左侧寄件栏，仓库级常量）
-- ---------------------------------------------------------------------------
create table if not exists public.logistics_shipper (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  province text,
  city text,
  district text,
  address text,
  address_info text,
  consignor_flag text not null default '0',
  consignor_name text,
  consignor_phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.logistics_shipper is '物流导出寄件人/委托人默认配置';
comment on column public.logistics_shipper.name is '寄件人';
comment on column public.logistics_shipper.phone is '寄件人电话';
comment on column public.logistics_shipper.province is '寄件省';
comment on column public.logistics_shipper.city is '寄件城市';
comment on column public.logistics_shipper.district is '寄件区域';
comment on column public.logistics_shipper.address is '寄件地址';
comment on column public.logistics_shipper.address_info is '寄件地址信息';
comment on column public.logistics_shipper.consignor_flag is '委托人标识';
comment on column public.logistics_shipper.consignor_name is '委托人姓名';
comment on column public.logistics_shipper.consignor_phone is '委托人电话';

drop trigger if exists logistics_shipper_set_updated_at on public.logistics_shipper;
create trigger logistics_shipper_set_updated_at
  before update on public.logistics_shipper
  for each row execute function public.set_updated_at();

-- At most one default shipper
create unique index if not exists logistics_shipper_one_default_idx
  on public.logistics_shipper (is_default)
  where is_default = true;

alter table public.logistics_shipper enable row level security;

-- Seed a default shipper matching sample template warehouse (idempotent)
insert into public.logistics_shipper (
  name, phone, province, city, district, address, address_info,
  consignor_flag, is_default
)
select
  'UBT',
  '087893521997',
  null,
  'JAKARTA',
  null,
  'ruko Mutiara Palem  cengkareng Jakarta Barat.',
  '',
  '0',
  true
where not exists (
  select 1 from public.logistics_shipper where is_default = true
);
