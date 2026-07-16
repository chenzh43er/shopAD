-- 清空全部订单，重灌 COD + 普通订单测试数据
-- 用法：node scripts/reset-orders.mjs

begin;

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

alter table public.orders
  add column if not exists shipping_order_no text;

delete from public.audit_logs where entity_type = 'order';
truncate table public.orders restart identity cascade;

with demo_orders as (
  select * from (
    values
      -- ========== COD ==========
      ('COD-TEST-001', '吴十', '13200132000', '重庆市渝中区解放碑步行街 9 号',
       '重庆', '重庆市', '渝中区', '解放碑步行街 9 号',
       '护肤精华套装', '体验装', 2, 'awaiting_review', 'cod', 'pending',
       null::text, null::text, '货到付款', 276.00::numeric, 'EZ', 14.00::numeric, 0::numeric,
       1, 0.80::numeric, null::text, null::text, 276.00::numeric, '美妆护肤', 'BARANG',
       'COD 待审核：可测审核通过/拒绝'),
      ('COD-TEST-002', '林十四', '12800128000', '厦门市思明区湖滨南路 18 号',
       '福建', '厦门市', '思明区', '湖滨南路 18 号',
       '蓝牙耳机 Pro', '单耳机', 1, 'awaiting_review', 'cod', 'pending',
       null::text, null::text, '货到付款', 179.00::numeric, 'EZ', 15.00::numeric, 0::numeric,
       1, 0.30::numeric, null::text, null::text, 179.00::numeric, '数码配件', 'BARANG',
       'COD 待审核：第二笔'),
      ('COD-TEST-003', '黄十五', '12700127000', '长沙市岳麓区麓山南路 66 号',
       '湖南', '长沙市', '岳麓区', '麓山南路 66 号',
       '示例水杯', '单杯装', 1, 'awaiting_review', 'cod', 'pending',
       null::text, null::text, '货到付款', 49.00::numeric, 'EZ', 10.00::numeric, 0::numeric,
       1, 0.50::numeric, null::text, null::text, 49.00::numeric, '日用百货', 'BARANG',
       'COD 待审核：第三笔'),
      ('COD-TEST-004', '陈十三', '12900129000', '苏州市工业园区星湖街 328 号',
       '江苏', '苏州市', '工业园区', '星湖街 328 号',
       '示例水杯', '双杯装', 1, 'awaiting_shipment', 'cod', 'approved',
       null::text, null::text, '货到付款', 89.00::numeric, 'EZ', 12.00::numeric, 0::numeric,
       1, 1.00::numeric, 'BASIC', 'Y', 89.00::numeric, '日用百货', 'BARANG',
       'COD 待发货：可测选择寄件人发货'),
      ('COD-TEST-005', '何十六', '12600126000', '青岛市市南区香港中路 100 号',
       '山东', '青岛市', '市南区', '香港中路 100 号',
       '运动跑鞋', '标准配色', 1, 'awaiting_shipment', 'cod', 'approved',
       null::text, null::text, '货到付款', 299.00::numeric, 'EZ', 20.00::numeric, 0::numeric,
       1, 1.00::numeric, 'BASIC', 'Y', 299.00::numeric, '鞋服', 'BARANG',
       'COD 待发货：第二笔'),
      ('COD-TEST-006', '周九', '13300133000', '深圳市南山区科技园路 1 号',
       '广东', '深圳市', '南山区', '科技园路 1 号',
       '蓝牙耳机 Pro', '耳机+充电盒套装', 1, 'cancelled', 'cod', 'rejected',
       null::text, null::text, '货到付款', 229.00::numeric, 'EZ', 16.00::numeric, 0::numeric,
       1, 0.35::numeric, 'BASIC', 'Y', 229.00::numeric, '数码配件', 'BARANG',
       'COD 审核未通过'),
      ('COD-TEST-007', '王五', '13700137000', '杭州市西湖区文三路 88 号',
       '浙江', '杭州市', '西湖区', '文三路 88 号',
       '护肤精华套装', '正装套餐', 1, 'cod_shipped', 'cod', 'approved',
       '26071622000001', 'ZJL', '货到付款', 238.00::numeric, 'EZ', 18.00::numeric, 2.00::numeric,
       1, 0.80::numeric, 'BASIC', 'Y', 238.00::numeric, '美妆护肤', 'BARANG',
       'COD 已发货：可测改为已完成'),
      ('COD-TEST-008', '赵六', '13600136000', '成都市武侯区天府大道 200 号',
       '四川', '成都市', '武侯区', '天府大道 200 号',
       '运动跑鞋', '限量白', 1, 'cod_completed', 'cod', 'approved',
       '26071622000002', 'ZJL', '货到付款', 329.00::numeric, 'EZ', 22.00::numeric, 0::numeric,
       1, 1.00::numeric, 'BASIC', 'Y', 329.00::numeric, '鞋服', 'BARANG',
       'COD 已完成'),
      -- ========== 普通订单（非 COD） ==========
      ('ORD-TEST-001', '张三', '13800138000', '上海市浦东新区示例路 1 号',
       '上海', '上海市', '浦东新区', '示例路 1 号',
       '示例水杯', '双杯装', 1, 'pending', 'non_cod', 'not_required',
       null::text, null::text, '月结', null::numeric, 'EZ', 12.00::numeric, 0::numeric,
       1, 1.00::numeric, null::text, null::text, 89.00::numeric, '日用百货', 'BARANG',
       '普通订单：待支付'),
      ('ORD-TEST-002', '李四', '13900139000', '广州市天河区体育西路 100 号',
       '广东', '广州市', '天河区', '体育西路 100 号',
       '蓝牙耳机 Pro', '单耳机', 1, 'paid', 'non_cod', 'not_required',
       null::text, '小李', '在线支付', null::numeric, 'EZ', 15.00::numeric, 0::numeric,
       1, 0.30::numeric, null::text, null::text, 179.00::numeric, '数码配件', 'BARANG',
       '普通订单：已支付'),
      ('ORD-TEST-003', '郑十一', '13100131000', '武汉市江汉区解放大道 300 号',
       '湖北', '武汉市', '江汉区', '解放大道 300 号',
       '运动跑鞋', '限量白', 1, 'shipped', 'non_cod', 'not_required',
       '26071611000001', '小王', '在线支付', null::numeric, 'EZ', 22.00::numeric, 0::numeric,
       1, 1.00::numeric, null::text, null::text, 329.00::numeric, '鞋服', 'BARANG',
       '普通订单：已发货'),
      ('ORD-TEST-004', '冯十二', '13000130000', '西安市雁塔区高新路 66 号',
       '陕西', '西安市', '雁塔区', '高新路 66 号',
       '示例水杯', '双杯装', 1, 'completed', 'non_cod', 'not_required',
       '26071611000002', '小李', '月结', null::numeric, 'EZ', 12.00::numeric, 0::numeric,
       1, 1.00::numeric, null::text, null::text, 89.00::numeric, '日用百货', 'BARANG',
       '普通订单：已完成'),
      ('ORD-TEST-005', '钱七', '13500135000', '南京市鼓楼区中山路 50 号',
       '江苏', '南京市', '鼓楼区', '中山路 50 号',
       '示例笔记本', null, 2, 'cancelled', 'non_cod', 'not_required',
       null::text, null::text, '在线支付', null::numeric, 'EZ', 10.00::numeric, 0::numeric,
       1, 0.40::numeric, null::text, null::text, 37.00::numeric, '文具', 'BARANG',
       '普通订单：已取消')
  ) as t(
    order_no, customer_name, customer_phone, shipping_address,
    shipping_province, shipping_city, shipping_district, shipping_detail,
    product_name, package_name, quantity, status, payment_type, review_status,
    shipping_order_no, owner_member, payment_method, cod_amount, express_type, shipping_fee, other_fee,
    package_count, weight, insurance_type, insurance_flag, item_value, item_category, item_type,
    remark
  )
)
insert into public.orders (
  order_no, customer_name, customer_phone, shipping_address,
  shipping_province, shipping_city, shipping_district, shipping_detail,
  total_amount, status, remark, owner_member, shipping_order_no, payment_method,
  payment_type, review_status, cod_amount, express_type, shipping_fee, other_fee,
  package_count, weight, insurance_type, insurance_flag, item_value, item_category, item_type,
  product_id, product_name, package_id, package_name, package_name_external,
  unit_price, quantity, sku_code
)
select
  d.order_no, d.customer_name, d.customer_phone, d.shipping_address,
  d.shipping_province, d.shipping_city, d.shipping_district, d.shipping_detail,
  case
    when pk.id is not null then coalesce(pk.discount_price, pk.original_price) * d.quantity
    else p.price * d.quantity
  end as total_amount,
  d.status, d.remark, d.owner_member, d.shipping_order_no, d.payment_method,
  d.payment_type, d.review_status, d.cod_amount, d.express_type, d.shipping_fee, d.other_fee,
  d.package_count, d.weight, d.insurance_type, d.insurance_flag, d.item_value, d.item_category, d.item_type,
  p.id, p.name, pk.id, pk.name, pk.name_external,
  case
    when pk.id is not null then coalesce(pk.discount_price, pk.original_price)
    else p.price
  end as unit_price,
  d.quantity, p.sku_code
from demo_orders d
join public.products p on p.name = d.product_name
left join lateral (
  select id, name, name_external, original_price, discount_price
  from public.product_packages
  where product_id = p.id and name = d.package_name
  limit 1
) pk on true;

insert into public.audit_logs (
  entity_type, entity_id, action, actor_name, actor_email,
  from_value, to_value, changes, remark
)
select
  'order', o.id, 'seed_demo', '系统种子', 'seed@shopad.local',
  null, o.status,
  jsonb_build_object(
    'order_no', o.order_no,
    'payment_type', o.payment_type,
    'review_status', o.review_status
  ),
  '测试数据初始化'
from public.orders o
where o.order_no like 'COD-TEST-%' or o.order_no like 'ORD-TEST-%';

commit;

select order_no, status, payment_type, review_status, owner_member, shipping_order_no, customer_name
from public.orders
order by order_no;
