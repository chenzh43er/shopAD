-- 阿拉伯语测试商品：可伸缩花园水管（对齐 SouqAyaal 参考页）
-- 可重复执行：按 link_suffix 更新商品；套餐按名称去重插入/刷新
-- 落地页：http://localhost:3000/anbob-ry-alhdyk-alkabl-lltmdd
-- 参考：https://souqayaal.youcan.store/products/anbob-ry-alhdyk-alkabl-lltmdd

begin;

-- 图片 CDN（YouCan 参考站）
-- gallery / detail 共用

update public.products set
  name = 'أنبوب ري الحديقة القابل للتمدد',
  description = E'أنبوب ري الحديقة القابل للتمدد\n\nExpandable Garden Hose Pipe',
  price = 99.00,
  cover_url = 'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png',
  status = 'on_sale',
  sku_code = 'DJ-0592',
  sku_display = 'Garden Hose Expandable',
  weight = 0.80,
  title_external = 'أنبوب ري الحديقة القابل للتمدد',
  packages_enabled = true,
  sales_count = 0,
  currency_id = (select id from public.currencies where code = 'SAR' limit 1),
  region_id = (
    select id from public.address_libraries
    where dial_code = '966'
    order by created_at asc
    limit 1
  ),
  gallery_urls = array[
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/OrzuMQE0snxbNdx4UYHvSee9rsCcMZL8V277vfEn.webp',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/MzzzV65FyNoMfnaQsGBCuBCsY6oTAu4XEmxtYJ0F.jpg',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/OvI8UTcD9xSGWeqbKLXI835NAeyB8xxkh4CxQ3DS.webp',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/zCKob1hn2pC1rr4u2wP3EhDACQ7eEutYMgGTtCml.webp'
  ]::text[],
  detail_image_urls = array[
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/Mir2pGCAbl8N5NNCaRSj47zcbPlK87NcDO5ejEUO.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/GN9TpiCPdVWgoRn7l3hAM8PAgQDXUurZrZapNufJ.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/ZkQPUiuWCw6Cx7uxdJ7ZFwGpo7Z0JOOGkekfB11L.gif',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/q5MZhP7nlsrdPcPNez90xrGvrRt57EgJe2b72qf6.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/o7JXHiY5e88ceQQVyX0mRwuia26DP4rlh2uS8ATB.gif',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/YcJZVAtA7LQdFCaMWjN8WYDxPMsEe5H8SeCCjkP5.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/EXjZYEf0NOqhBaFjP3Xp8pcqJjgc62CrRxwzjycX.png'
  ]::text[],
  description_entries = array[
    'خرطوم قابل للتمدد حتى 3 أضعاف طوله الأصلي',
    'رأس رش متعدد الأنماط للري والتنظيف',
    'خفيف الوزن وسهل التخزين',
    'توصيل مجاني — الدفع عند الاستلام'
  ]::text[],
  updated_at = now()
where link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd'
   or name = 'أنبوب ري الحديقة القابل للتمدد';

insert into public.products (
  name, description, price, cover_url, status,
  sku_code, sku_display, weight,
  link_suffix, title_external, packages_enabled,
  gallery_urls, detail_image_urls, description_entries,
  sales_count, currency_id, region_id
)
select
  'أنبوب ري الحديقة القابل للتمدد',
  E'أنبوب ري الحديقة القابل للتمدد\n\nExpandable Garden Hose Pipe',
  99.00::numeric,
  'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png',
  'on_sale',
  'DJ-0592',
  'Garden Hose Expandable',
  0.80::numeric,
  'anbob-ry-alhdyk-alkabl-lltmdd',
  'أنبوب ري الحديقة القابل للتمدد',
  true,
  array[
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/OrzuMQE0snxbNdx4UYHvSee9rsCcMZL8V277vfEn.webp',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/MzzzV65FyNoMfnaQsGBCuBCsY6oTAu4XEmxtYJ0F.jpg',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/OvI8UTcD9xSGWeqbKLXI835NAeyB8xxkh4CxQ3DS.webp',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/zCKob1hn2pC1rr4u2wP3EhDACQ7eEutYMgGTtCml.webp'
  ]::text[],
  array[
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/Mir2pGCAbl8N5NNCaRSj47zcbPlK87NcDO5ejEUO.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/GN9TpiCPdVWgoRn7l3hAM8PAgQDXUurZrZapNufJ.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/ZkQPUiuWCw6Cx7uxdJ7ZFwGpo7Z0JOOGkekfB11L.gif',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/q5MZhP7nlsrdPcPNez90xrGvrRt57EgJe2b72qf6.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/o7JXHiY5e88ceQQVyX0mRwuia26DP4rlh2uS8ATB.gif',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/YcJZVAtA7LQdFCaMWjN8WYDxPMsEe5H8SeCCjkP5.png',
    'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/others/EXjZYEf0NOqhBaFjP3Xp8pcqJjgc62CrRxwzjycX.png'
  ]::text[],
  array[
    'خرطوم قابل للتمدد حتى 3 أضعاف طوله الأصلي',
    'رأس رش متعدد الأنماط للري والتنظيف',
    'خفيف الوزن وسهل التخزين',
    'توصيل مجاني — الدفع عند الاستلام'
  ]::text[],
  0,
  (select id from public.currencies where code = 'SAR' limit 1),
  (
    select id from public.address_libraries
    where dial_code = '966'
    order by created_at asc
    limit 1
  )
where not exists (
  select 1 from public.products p
  where p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd'
     or p.name = 'أنبوب ري الحديقة القابل للتمدد'
);

delete from public.product_packages pp
using public.products p
where pp.product_id = p.id
  and p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd'
  and pp.name not in (
    'خرطوم 30 متر',
    'خرطوم 15 متر'
  );

with pkgs(name, name_external, original_price, discount_price, sort_order, summary, is_visible, image_url, qty) as (
  values
    (
      'خرطوم 30 متر',
      'خرطوم حديقة قابل للتمدد (30 مترًا)',
      219.00::numeric,
      99.00::numeric,
      0,
      '30m expandable garden hose',
      true,
      'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png',
      1
    ),
    (
      'خرطوم 15 متر',
      'خرطوم حديقة قابل للتمدد (15 مترًا)',
      219.00::numeric,
      99.00::numeric,
      1,
      '15m expandable garden hose',
      true,
      'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/51GNWUbvzNPmixmkXYDCvT10wNaRMZwThkc5JJCJ.png',
      1
    )
),
ins_pkg as (
  insert into public.product_packages (
    product_id, name, name_external, original_price, discount_price,
    sort_order, summary, is_visible, image_url
  )
  select
    p.id, pkgs.name, pkgs.name_external, pkgs.original_price, pkgs.discount_price,
    pkgs.sort_order, pkgs.summary, pkgs.is_visible, pkgs.image_url
  from pkgs
  join public.products p on p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd'
  where not exists (
    select 1
    from public.product_packages pp
    where pp.product_id = p.id and pp.name = pkgs.name
  )
  returning id, name, product_id
)
insert into public.product_package_items (
  package_id, quantity, independent_attrs, sort_order, ref_product_id
)
select
  coalesce(ins_pkg.id, existing.id),
  pkgs.qty,
  false,
  0,
  p.id
from pkgs
join public.products p on p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd'
left join ins_pkg on ins_pkg.name = pkgs.name and ins_pkg.product_id = p.id
left join public.product_packages existing
  on existing.product_id = p.id and existing.name = pkgs.name
where not exists (
  select 1
  from public.product_package_items i
  where i.package_id = coalesce(ins_pkg.id, existing.id)
);

update public.product_packages pp
set
  name_external = v.name_external,
  original_price = v.original_price,
  discount_price = v.discount_price,
  sort_order = v.sort_order,
  summary = v.summary,
  is_visible = v.is_visible,
  image_url = v.image_url,
  updated_at = now()
from (
  values
    ('خرطوم 30 متر', 'خرطوم حديقة قابل للتمدد (30 مترًا)', 219.00::numeric, 99.00::numeric, 0,
     '30m expandable garden hose', true,
     'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png'),
    ('خرطوم 15 متر', 'خرطوم حديقة قابل للتمدد (15 مترًا)', 219.00::numeric, 99.00::numeric, 1,
     '15m expandable garden hose', true,
     'https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e/products/51GNWUbvzNPmixmkXYDCvT10wNaRMZwThkc5JJCJ.png')
) as v(name, name_external, original_price, discount_price, sort_order, summary, is_visible, image_url)
join public.products p on p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd'
where pp.product_id = p.id and pp.name = v.name;

-- 让所有后台账号可见（员工还需在权限中分配沙特地区 dial_code=966）
update public.products p
set created_by = coalesce(
  p.created_by,
  (select id from public.profiles order by case when role = 'super_admin' then 0 else 1 end, created_at asc limit 1)
)
where p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd';

insert into public.product_owners (product_id, profile_id, created_by)
select p.id, pr.id, pr.id
from public.products p
cross join public.profiles pr
where p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd'
on conflict (product_id, profile_id) do nothing;

commit;

select
  p.id,
  p.name,
  p.link_suffix,
  p.price,
  p.status,
  p.packages_enabled,
  p.sales_count,
  c.code as currency,
  al.dial_code,
  (select count(*)::int from public.product_packages pp where pp.product_id = p.id) as package_count
from public.products p
left join public.currencies c on c.id = p.currency_id
left join public.address_libraries al on al.id = p.region_id
where p.link_suffix = 'anbob-ry-alhdyk-alkabl-lltmdd';
