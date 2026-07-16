-- Demo data for local / staging testing (idempotent).
-- 一单一品：订单直接挂商品 + 套餐
-- 可重复执行：按 name / order_no 去重，不会重复插入。

begin;

-- ---------------------------------------------------------------------------
-- 商品
-- ---------------------------------------------------------------------------
insert into public.products (
  name, description, price, stock, cover_url, status,
  sku_code, sku_display, weight, item_category, item_type,
  link_suffix, title_external, packages_enabled,
  gallery_urls, detail_image_urls
)
select *
from (
  values
    (
      '示例水杯',
      '不锈钢保温杯 500ml，双层真空保温',
      59.00::numeric, 100, 'https://picsum.photos/seed/shopad-cup/640/640', 'on_sale',
      '水杯-银', '保温杯 / 银色', 0.50::numeric, '日用百货', 'BARANG',
      'cup-demo', 'Vacuum Flask 500ml', true,
      array[
        'https://picsum.photos/seed/shopad-cup-g1/800/800',
        'https://picsum.photos/seed/shopad-cup-g2/800/800'
      ]::text[],
      array[
        'https://picsum.photos/seed/shopad-cup-d1/800/1200',
        'https://picsum.photos/seed/shopad-cup-d2/800/1200'
      ]::text[]
    ),
    (
      '示例笔记本',
      'A5 牛皮纸笔记本，120 页',
      18.50::numeric, 200, 'https://picsum.photos/seed/shopad-note/640/640', 'on_sale',
      '笔记-A5', '笔记本 / A5', 0.20::numeric, '文具', 'BARANG',
      'notebook-demo', 'Kraft Notebook A5', false,
      array['https://picsum.photos/seed/shopad-note-g1/800/800']::text[],
      array['https://picsum.photos/seed/shopad-note-d1/800/1200']::text[]
    ),
    (
      '蓝牙耳机 Pro',
      '降噪蓝牙耳机，续航 30 小时',
      199.00::numeric, 80, 'https://picsum.photos/seed/shopad-ear/640/640', 'on_sale',
      '耳机-黑', '蓝牙耳机 / 黑色', 0.15::numeric, '数码配件', 'BARANG',
      'earphone-pro', 'Bluetooth Earphone Pro', true,
      array[
        'https://picsum.photos/seed/shopad-ear-g1/800/800',
        'https://picsum.photos/seed/shopad-ear-g2/800/800',
        'https://picsum.photos/seed/shopad-ear-g3/800/800'
      ]::text[],
      array[
        'https://picsum.photos/seed/shopad-ear-d1/800/1200',
        'https://picsum.photos/seed/shopad-ear-d2/800/1200'
      ]::text[]
    ),
    (
      '护肤精华套装',
      '补水修护精华液 30ml × 套装',
      268.00::numeric, 45, 'https://picsum.photos/seed/shopad-skin/640/640', 'on_sale',
      '护肤-套', '精华套装', 0.40::numeric, '美妆护肤', 'BARANG',
      'serum-set', 'Hydrating Serum Set', true,
      array['https://picsum.photos/seed/shopad-skin-g1/800/800']::text[],
      array['https://picsum.photos/seed/shopad-skin-d1/800/1200']::text[]
    ),
    (
      '运动跑鞋',
      '轻量缓震跑鞋，多色可选',
      329.00::numeric, 60, 'https://picsum.photos/seed/shopad-shoe/640/640', 'on_sale',
      '跑鞋-42', '跑鞋 / 42码', 0.80::numeric, '鞋服', 'BARANG',
      'run-shoes', 'Running Shoes Lite', true,
      array[
        'https://picsum.photos/seed/shopad-shoe-g1/800/800',
        'https://picsum.photos/seed/shopad-shoe-g2/800/800'
      ]::text[],
      '{}'::text[]
    ),
    (
      '桌面小风扇',
      'USB 静音台式风扇',
      49.90::numeric, 150, 'https://picsum.photos/seed/shopad-fan/640/640', 'off_sale',
      '风扇-白', '小风扇 / 白色', 0.60::numeric, '小家电', 'BARANG',
      'desk-fan', 'USB Desk Fan', false,
      array['https://picsum.photos/seed/shopad-fan-g1/800/800']::text[],
      '{}'::text[]
    ),
    (
      '香氛蜡烛礼盒',
      '大豆蜡香氛蜡烛 3 件套',
      128.00::numeric, 30, 'https://picsum.photos/seed/shopad-candle/640/640', 'draft',
      '蜡烛-礼', '香氛蜡烛礼盒', 1.20::numeric, '家居', 'BARANG',
      null, 'Scented Candle Gift Box', false,
      '{}'::text[],
      '{}'::text[]
    ),
    (
      '草稿商品',
      '尚未上架的占位商品',
      9.90::numeric, 10, null, 'draft',
      null, null, 1.00::numeric, null, 'BARANG',
      null, null, false,
      '{}'::text[],
      '{}'::text[]
    )
) as v(
  name, description, price, stock, cover_url, status,
  sku_code, sku_display, weight, item_category, item_type,
  link_suffix, title_external, packages_enabled,
  gallery_urls, detail_image_urls
)
where not exists (
  select 1 from public.products p where p.name = v.name
);

-- 补全已存在商品的演示字段（不覆盖人工改过的非空封面时仍会更新 SKU 等）
update public.products p
set
  description = coalesce(p.description, s.description),
  price = s.price,
  stock = greatest(p.stock, s.stock),
  cover_url = coalesce(p.cover_url, s.cover_url),
  status = s.status,
  sku_code = coalesce(p.sku_code, s.sku_code),
  sku_display = coalesce(p.sku_display, s.sku_display),
  weight = s.weight,
  item_category = coalesce(p.item_category, s.item_category),
  item_type = coalesce(nullif(p.item_type, ''), s.item_type),
  link_suffix = coalesce(p.link_suffix, s.link_suffix),
  title_external = coalesce(p.title_external, s.title_external),
  packages_enabled = s.packages_enabled,
  gallery_urls = case when cardinality(p.gallery_urls) = 0 then s.gallery_urls else p.gallery_urls end,
  detail_image_urls = case when cardinality(p.detail_image_urls) = 0 then s.detail_image_urls else p.detail_image_urls end,
  updated_at = now()
from (
  values
    ('示例水杯', '不锈钢保温杯 500ml，双层真空保温', 59.00::numeric, 100, 'https://picsum.photos/seed/shopad-cup/640/640', 'on_sale', '水杯-银', '保温杯 / 银色', 0.50::numeric, '日用百货', 'BARANG', 'cup-demo', 'Vacuum Flask 500ml', true, array['https://picsum.photos/seed/shopad-cup-g1/800/800','https://picsum.photos/seed/shopad-cup-g2/800/800']::text[], array['https://picsum.photos/seed/shopad-cup-d1/800/1200','https://picsum.photos/seed/shopad-cup-d2/800/1200']::text[]),
    ('示例笔记本', 'A5 牛皮纸笔记本，120 页', 18.50::numeric, 200, 'https://picsum.photos/seed/shopad-note/640/640', 'on_sale', '笔记-A5', '笔记本 / A5', 0.20::numeric, '文具', 'BARANG', 'notebook-demo', 'Kraft Notebook A5', false, array['https://picsum.photos/seed/shopad-note-g1/800/800']::text[], array['https://picsum.photos/seed/shopad-note-d1/800/1200']::text[]),
    ('蓝牙耳机 Pro', '降噪蓝牙耳机，续航 30 小时', 199.00::numeric, 80, 'https://picsum.photos/seed/shopad-ear/640/640', 'on_sale', '耳机-黑', '蓝牙耳机 / 黑色', 0.15::numeric, '数码配件', 'BARANG', 'earphone-pro', 'Bluetooth Earphone Pro', true, array['https://picsum.photos/seed/shopad-ear-g1/800/800','https://picsum.photos/seed/shopad-ear-g2/800/800','https://picsum.photos/seed/shopad-ear-g3/800/800']::text[], array['https://picsum.photos/seed/shopad-ear-d1/800/1200','https://picsum.photos/seed/shopad-ear-d2/800/1200']::text[]),
    ('护肤精华套装', '补水修护精华液 30ml × 套装', 268.00::numeric, 45, 'https://picsum.photos/seed/shopad-skin/640/640', 'on_sale', '护肤-套', '精华套装', 0.40::numeric, '美妆护肤', 'BARANG', 'serum-set', 'Hydrating Serum Set', true, array['https://picsum.photos/seed/shopad-skin-g1/800/800']::text[], array['https://picsum.photos/seed/shopad-skin-d1/800/1200']::text[]),
    ('运动跑鞋', '轻量缓震跑鞋，多色可选', 329.00::numeric, 60, 'https://picsum.photos/seed/shopad-shoe/640/640', 'on_sale', '跑鞋-42', '跑鞋 / 42码', 0.80::numeric, '鞋服', 'BARANG', 'run-shoes', 'Running Shoes Lite', true, array['https://picsum.photos/seed/shopad-shoe-g1/800/800','https://picsum.photos/seed/shopad-shoe-g2/800/800']::text[], '{}'::text[]),
    ('桌面小风扇', 'USB 静音台式风扇', 49.90::numeric, 150, 'https://picsum.photos/seed/shopad-fan/640/640', 'off_sale', '风扇-白', '小风扇 / 白色', 0.60::numeric, '小家电', 'BARANG', 'desk-fan', 'USB Desk Fan', false, array['https://picsum.photos/seed/shopad-fan-g1/800/800']::text[], '{}'::text[]),
    ('香氛蜡烛礼盒', '大豆蜡香氛蜡烛 3 件套', 128.00::numeric, 30, 'https://picsum.photos/seed/shopad-candle/640/640', 'draft', '蜡烛-礼', '香氛蜡烛礼盒', 1.20::numeric, '家居', 'BARANG', null::text, 'Scented Candle Gift Box', false, '{}'::text[], '{}'::text[]),
    ('草稿商品', '尚未上架的占位商品', 9.90::numeric, 10, null::text, 'draft', null::text, null::text, 1.00::numeric, null::text, 'BARANG', null::text, null::text, false, '{}'::text[], '{}'::text[])
) as s(
  name, description, price, stock, cover_url, status,
  sku_code, sku_display, weight, item_category, item_type,
  link_suffix, title_external, packages_enabled,
  gallery_urls, detail_image_urls
)
where p.name = s.name;

-- ---------------------------------------------------------------------------
-- 套餐
-- ---------------------------------------------------------------------------
with pkgs(product_name, name, name_external, original_price, discount_price, sort_order, summary, is_visible, image_url) as (
  values
    ('示例水杯', '单杯装', 'Single Cup', 59.00::numeric, 49.00::numeric, 0, '日常单人使用', true, 'https://picsum.photos/seed/shopad-cup-p1/400/400'),
    ('示例水杯', '双杯装', 'Twin Cups', 118.00::numeric, 89.00::numeric, 1, '情侣/同事组合更划算', true, 'https://picsum.photos/seed/shopad-cup-p2/400/400'),
    ('蓝牙耳机 Pro', '单耳机', 'Single Earphone', 199.00::numeric, 179.00::numeric, 0, '标准单件', true, 'https://picsum.photos/seed/shopad-ear-p1/400/400'),
    ('蓝牙耳机 Pro', '耳机+充电盒套装', 'Earphone + Case', 259.00::numeric, 229.00::numeric, 1, '含保护充电盒', true, 'https://picsum.photos/seed/shopad-ear-p2/400/400'),
    ('护肤精华套装', '体验装', 'Trial Kit', 168.00::numeric, 138.00::numeric, 0, '7 天体验装', true, 'https://picsum.photos/seed/shopad-skin-p1/400/400'),
    ('护肤精华套装', '正装套餐', 'Full Kit', 268.00::numeric, 238.00::numeric, 1, '30 天完整套装', true, 'https://picsum.photos/seed/shopad-skin-p2/400/400'),
    ('护肤精华套装', '隐藏套餐', 'Hidden Kit', 299.00::numeric, null::numeric, 2, '后台隐藏测试', false, null),
    ('运动跑鞋', '标准配色', 'Standard Color', 329.00::numeric, 299.00::numeric, 0, '主推配色', true, 'https://picsum.photos/seed/shopad-shoe-p1/400/400'),
    ('运动跑鞋', '限量白', 'Limited White', 359.00::numeric, 329.00::numeric, 1, '限量白色款', true, 'https://picsum.photos/seed/shopad-shoe-p2/400/400')
)
insert into public.product_packages (
  product_id, name, name_external, original_price, discount_price,
  sort_order, summary, is_visible, image_url
)
select
  p.id, pkgs.name, pkgs.name_external, pkgs.original_price, pkgs.discount_price,
  pkgs.sort_order, pkgs.summary, pkgs.is_visible, pkgs.image_url
from pkgs
join public.products p on p.name = pkgs.product_name
where not exists (
  select 1
  from public.product_packages pp
  where pp.product_id = p.id and pp.name = pkgs.name
);

-- 套餐明细（指向主商品自身，便于套餐页展示数量）
insert into public.product_package_items (
  package_id, quantity, independent_attrs, sort_order, ref_product_id
)
select
  pk.id,
  case
    when pk.name in ('双杯装', '耳机+充电盒套装') then 2
    else 1
  end,
  false,
  0,
  p.id
from public.product_packages pk
join public.products p on p.id = pk.product_id
where p.name in ('示例水杯', '蓝牙耳机 Pro', '护肤精华套装', '运动跑鞋')
  and not exists (
    select 1 from public.product_package_items i where i.package_id = pk.id
  );

-- ---------------------------------------------------------------------------
-- 物流寄件人（默认仓 + 备用仓）
-- ---------------------------------------------------------------------------
insert into public.logistics_shipper (
  name, phone, province, city, district, address, address_info,
  consignor_flag, consignor_name, consignor_phone, is_default
)
select
  'UBT', '087893521997', 'DKI JAKARTA', 'JAKARTA', 'CENGKARENG',
  'ruko Mutiara Palem cengkareng Jakarta Barat.',
  'UBT Warehouse / Jakarta Barat',
  '0', null, null, true
where not exists (
  select 1 from public.logistics_shipper where is_default = true
);

insert into public.logistics_shipper (
  name, phone, province, city, district, address, address_info,
  consignor_flag, consignor_name, consignor_phone, is_default
)
select
  '备用仓库 UBT-2', '081234567890', 'JAWA BARAT', 'BANDUNG', 'COBLONG',
  'Jl. Contoh No. 88, Bandung',
  'Secondary warehouse Bandung',
  '1', '仓库客服', '081234567890', false
where not exists (
  select 1 from public.logistics_shipper where name = '备用仓库 UBT-2'
);

-- ---------------------------------------------------------------------------
-- 订单：清空后仅灌入 COD 测试单（覆盖各子状态，不含待支付）
-- ---------------------------------------------------------------------------
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

delete from public.audit_logs where entity_type = 'order';
truncate table public.orders restart identity cascade;

with demo_orders as (
  select * from (
    values
      -- COD 待审核 #1
      ('COD-TEST-001', '吴十', '13200132000', '重庆市渝中区解放碑步行街 9 号',
       '重庆', '重庆市', '渝中区', '解放碑步行街 9 号',
       '护肤精华套装', '体验装', 2, 'awaiting_review', 'cod', 'pending',
       '小郑', '货到付款', 276.00::numeric, 'EZ', 14.00::numeric, 0::numeric,
       1, 0.80::numeric, null::text, null::text, 276.00::numeric, '美妆护肤', 'BARANG',
       'COD 待审核：可测「审核通过/拒绝」'),
      -- COD 待审核 #2
      ('COD-TEST-002', '林十四', '12800128000', '厦门市思明区湖滨南路 18 号',
       '福建', '厦门市', '思明区', '湖滨南路 18 号',
       '蓝牙耳机 Pro', '单耳机', 1, 'awaiting_review', 'cod', 'pending',
       '小周', '货到付款', 179.00::numeric, 'EZ', 15.00::numeric, 0::numeric,
       1, 0.30::numeric, null::text, null::text, 179.00::numeric, '数码配件', 'BARANG',
       'COD 待审核：第二笔'),
      -- COD 待审核 #3
      ('COD-TEST-003', '黄十五', '12700127000', '长沙市岳麓区麓山南路 66 号',
       '湖南', '长沙市', '岳麓区', '麓山南路 66 号',
       '示例水杯', '单杯装', 1, 'awaiting_review', 'cod', 'pending',
       '小王', '货到付款', 49.00::numeric, 'EZ', 10.00::numeric, 0::numeric,
       1, 0.50::numeric, null::text, null::text, 49.00::numeric, '日用百货', 'BARANG',
       'COD 待审核：第三笔'),
      -- COD 已审核 / 待发货 #1
      ('COD-TEST-004', '陈十三', '12900129000', '苏州市工业园区星湖街 328 号',
       '江苏', '苏州市', '工业园区', '星湖街 328 号',
       '示例水杯', '双杯装', 1, 'awaiting_shipment', 'cod', 'approved',
       '小王', '货到付款', 89.00::numeric, 'EZ', 12.00::numeric, 0::numeric,
       1, 1.00::numeric, 'BASIC', 'Y', 89.00::numeric, '日用百货', 'BARANG',
       'COD 已审核通过，待发货'),
      -- COD 已审核 / 待发货 #2
      ('COD-TEST-005', '何十六', '12600126000', '青岛市市南区香港中路 100 号',
       '山东', '青岛市', '市南区', '香港中路 100 号',
       '运动跑鞋', '标准配色', 1, 'awaiting_shipment', 'cod', 'approved',
       '小钱', '货到付款', 299.00::numeric, 'EZ', 20.00::numeric, 0::numeric,
       1, 1.00::numeric, 'BASIC', 'Y', 299.00::numeric, '鞋服', 'BARANG',
       'COD 待发货：可测「改为 COD已发货」'),
      -- COD 未通过
      ('COD-TEST-006', '周九', '13300133000', '深圳市南山区科技园路 1 号',
       '广东', '深圳市', '南山区', '科技园路 1 号',
       '蓝牙耳机 Pro', '耳机+充电盒套装', 1, 'cancelled', 'cod', 'rejected',
       '小吴', '货到付款', 229.00::numeric, 'EZ', 16.00::numeric, 0::numeric,
       1, 0.35::numeric, 'BASIC', 'Y', 229.00::numeric, '数码配件', 'BARANG',
       'COD 审核未通过'),
      -- COD 已发货
      ('COD-TEST-007', '王五', '13700137000', '杭州市西湖区文三路 88 号',
       '浙江', '杭州市', '西湖区', '文三路 88 号',
       '护肤精华套装', '正装套餐', 1, 'cod_shipped', 'cod', 'approved',
       '小赵', '货到付款', 238.00::numeric, 'EZ', 18.00::numeric, 2.00::numeric,
       1, 0.80::numeric, 'BASIC', 'Y', 238.00::numeric, '美妆护肤', 'BARANG',
       'COD 已发货：可测「改为 COD已完成」'),
      -- COD 已完成
      ('COD-TEST-008', '赵六', '13600136000', '成都市武侯区天府大道 200 号',
       '四川', '成都市', '武侯区', '天府大道 200 号',
       '运动跑鞋', '限量白', 1, 'cod_completed', 'cod', 'approved',
       '小钱', '货到付款', 329.00::numeric, 'EZ', 22.00::numeric, 0::numeric,
       1, 1.00::numeric, 'BASIC', 'Y', 329.00::numeric, '鞋服', 'BARANG',
       'COD 已完成')
  ) as t(
    order_no, customer_name, customer_phone, shipping_address,
    shipping_province, shipping_city, shipping_district, shipping_detail,
    product_name, package_name, quantity, status, payment_type, review_status,
    owner_member, payment_method, cod_amount, express_type, shipping_fee, other_fee,
    package_count, weight, insurance_type, insurance_flag, item_value, item_category, item_type,
    remark
  )
)
insert into public.orders (
  order_no,
  customer_name,
  customer_phone,
  shipping_address,
  shipping_province,
  shipping_city,
  shipping_district,
  shipping_detail,
  total_amount,
  status,
  remark,
  owner_member,
  payment_method,
  payment_type,
  review_status,
  cod_amount,
  express_type,
  shipping_fee,
  other_fee,
  package_count,
  weight,
  insurance_type,
  insurance_flag,
  item_value,
  item_category,
  item_type,
  product_id,
  product_name,
  package_id,
  package_name,
  package_name_external,
  unit_price,
  quantity,
  sku_code
)
select
  d.order_no,
  d.customer_name,
  d.customer_phone,
  d.shipping_address,
  d.shipping_province,
  d.shipping_city,
  d.shipping_district,
  d.shipping_detail,
  case
    when pk.id is not null then coalesce(pk.discount_price, pk.original_price) * d.quantity
    else p.price * d.quantity
  end as total_amount,
  d.status,
  d.remark,
  d.owner_member,
  d.payment_method,
  d.payment_type,
  d.review_status,
  d.cod_amount,
  d.express_type,
  d.shipping_fee,
  d.other_fee,
  d.package_count,
  d.weight,
  d.insurance_type,
  d.insurance_flag,
  d.item_value,
  d.item_category,
  d.item_type,
  p.id,
  p.name,
  pk.id,
  pk.name,
  pk.name_external,
  case
    when pk.id is not null then coalesce(pk.discount_price, pk.original_price)
    else p.price
  end as unit_price,
  d.quantity,
  p.sku_code
from demo_orders d
join public.products p on p.name = d.product_name
left join lateral (
  select id, name, name_external, original_price, discount_price
  from public.product_packages
  where product_id = p.id
    and name = d.package_name
  limit 1
) pk on true
on conflict (order_no) do update
set
  customer_name = excluded.customer_name,
  customer_phone = excluded.customer_phone,
  shipping_address = excluded.shipping_address,
  shipping_province = excluded.shipping_province,
  shipping_city = excluded.shipping_city,
  shipping_district = excluded.shipping_district,
  shipping_detail = excluded.shipping_detail,
  total_amount = excluded.total_amount,
  status = excluded.status,
  remark = excluded.remark,
  owner_member = excluded.owner_member,
  payment_method = excluded.payment_method,
  payment_type = excluded.payment_type,
  review_status = excluded.review_status,
  cod_amount = excluded.cod_amount,
  express_type = excluded.express_type,
  shipping_fee = excluded.shipping_fee,
  other_fee = excluded.other_fee,
  package_count = excluded.package_count,
  weight = excluded.weight,
  insurance_type = excluded.insurance_type,
  insurance_flag = excluded.insurance_flag,
  item_value = excluded.item_value,
  item_category = excluded.item_category,
  item_type = excluded.item_type,
  product_id = excluded.product_id,
  product_name = excluded.product_name,
  package_id = excluded.package_id,
  package_name = excluded.package_name,
  package_name_external = excluded.package_name_external,
  unit_price = excluded.unit_price,
  quantity = excluded.quantity,
  sku_code = excluded.sku_code,
  updated_at = now();

-- 简单审计样例（按订单号幂等）
insert into public.audit_logs (
  entity_type, entity_id, action, actor_name, actor_email,
  from_value, to_value, changes, remark
)
select
  'order',
  o.id,
  'seed_demo',
  '系统种子',
  'seed@shopad.local',
  null,
  o.status,
  jsonb_build_object(
    'order_no', o.order_no,
    'payment_type', o.payment_type,
    'review_status', o.review_status
  ),
  '演示数据初始化'
from public.orders o
where o.order_no like 'COD-TEST-%'
  and not exists (
    select 1
    from public.audit_logs a
    where a.entity_type = 'order'
      and a.entity_id = o.id
      and a.action = 'seed_demo'
  );

commit;
