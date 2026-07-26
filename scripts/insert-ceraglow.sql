-- Ceraglow Youth Cream（来源：laryssa.orderonline.id）
-- 可重复执行：按 link_suffix 更新商品；套餐按名称去重插入/刷新
-- 落地页：https://laryssa.orderonline.id/ceraglow-youth-cream-bpom-bl62-65

begin;

-- 已存在则刷新，否则插入
update public.products set
  name = 'Ceraglow Youth Cream BPOM BL62-65',
  description = E'Ceraglow Youth Cream BPOM BL62-65\n\nYang Anda Dapatkan:\n- Sudah BPOM Dan Jaminan 100% Barang Original\n- Wajah Glowing tanpa Flek Hitam, Kerutan, dan Jerawat\n- Aman Untuk Semua Jenis Kulit & Tanpa Efek Samping\n- Diskon 50% Dan Diskon Ongkir Seluruh Indonesia\n- Beli 1 Dapat 2 Bisa COD (Bayar Ditempat)\n\nPilihan Produk:\n- Promo Beli 1 Rp. 120.000\n- Lebih Hemat Beli 1 dapat 2 Rp. 165.000\n\nKontak: +62 851 4819 7834\nAlamat: Jl. Pondok Ungu, Harapan Jaya, Kec. Bekasi Utara, Kota Bekasi, Jawa Barat 17124\n\n来源落地页：https://laryssa.orderonline.id/ceraglow-youth-cream-bpom-bl62-65',
  price = 120000.00,
  cover_url = 'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg',
  status = 'on_sale',
  sku_code = 'CERAGLOW-YC',
  sku_display = 'Ceraglow Youth Cream BPOM BL62-65',
  weight = 0.30,
  title_external = 'Ceraglow Youth Cream BPOM BL62-65',
  packages_enabled = true,
  gallery_urls = array[
    'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg',
    'https://cdn.orderonline.id/uploads/images_7569161766594604519.jpeg',
    'https://cdn.orderonline.id/uploads/images_3586691766594604863.jpeg'
  ]::text[],
  detail_image_urls = array[
    'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg',
    'https://cdn.orderonline.id/uploads/images_7569161766594604519.jpeg',
    'https://cdn.orderonline.id/uploads/images_3586691766594604863.jpeg'
  ]::text[],
  extra_html = array[
    E'<section><h3>Yang Anda Dapatkan</h3><ul><li>Sudah BPOM Dan Jaminan 100% Barang Original</li><li>Wajah Glowing tanpa Flek Hitam, Kerutan, dan Jerawat</li><li>Aman Untuk Semua Jenis Kulit &amp; Tanpa Efek Samping</li><li>Diskon 50% Dan Diskon Ongkir Seluruh Indonesia</li><li>Beli 1 Dapat 2 Bisa COD (Bayar Ditempat)</li></ul></section>',
    E'<section><h3>Testimoni</h3><blockquote><strong>Atin Rahmawati (PNS)</strong><br/>Aku udah coba berbagai krim anti kerut, tapi Ceraglow Youth Cream BPOM ini beda banget! Kerutan di wajah mulai memudar, kulit jadi lebih kencang, halus, dan lembap banget.</blockquote><blockquote><strong>Dewi Aulia (Mahasiswi)</strong><br/>Setelah pake Ceraglow Youth Cream BPOM, kulitku jadi lebih kencang, halus, dan kenyal. Kerutan memudar, wajah juga kelihatan lebih cerah dan glowing.</blockquote><blockquote><strong>Siska Dewi (Pegawai Swasta)</strong><br/>Setelah pakai Ceraglow Youth Cream BPOM ini, kulit wajah jadi lebih kencang, lembut, dan cerah! Kerutan halus memudar, kulit terasa kenyal banget.</blockquote></section>'
  ]::text[],
  updated_at = now()
where link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
   or name = 'Ceraglow Youth Cream BPOM BL62-65';

insert into public.products (
  name, description, price, cover_url, status,
  sku_code, sku_display, weight,
  link_suffix, title_external, packages_enabled,
  gallery_urls, detail_image_urls, extra_html
)
select
  'Ceraglow Youth Cream BPOM BL62-65',
  E'Ceraglow Youth Cream BPOM BL62-65\n\nYang Anda Dapatkan:\n- Sudah BPOM Dan Jaminan 100% Barang Original\n- Wajah Glowing tanpa Flek Hitam, Kerutan, dan Jerawat\n- Aman Untuk Semua Jenis Kulit & Tanpa Efek Samping\n- Diskon 50% Dan Diskon Ongkir Seluruh Indonesia\n- Beli 1 Dapat 2 Bisa COD (Bayar Ditempat)\n\nPilihan Produk:\n- Promo Beli 1 Rp. 120.000\n- Lebih Hemat Beli 1 dapat 2 Rp. 165.000\n\nKontak: +62 851 4819 7834\nAlamat: Jl. Pondok Ungu, Harapan Jaya, Kec. Bekasi Utara, Kota Bekasi, Jawa Barat 17124\n\n来源落地页：https://laryssa.orderonline.id/ceraglow-youth-cream-bpom-bl62-65',
  120000.00::numeric,
  'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg',
  'on_sale',
  'CERAGLOW-YC',
  'Ceraglow Youth Cream BPOM BL62-65',
  0.30::numeric,
  'ceraglow-youth-cream-bpom-bl62-65',
  'Ceraglow Youth Cream BPOM BL62-65',
  true,
  array[
    'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg',
    'https://cdn.orderonline.id/uploads/images_7569161766594604519.jpeg',
    'https://cdn.orderonline.id/uploads/images_3586691766594604863.jpeg'
  ]::text[],
  array[
    'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg',
    'https://cdn.orderonline.id/uploads/images_7569161766594604519.jpeg',
    'https://cdn.orderonline.id/uploads/images_3586691766594604863.jpeg'
  ]::text[],
  array[
    E'<section><h3>Yang Anda Dapatkan</h3><ul><li>Sudah BPOM Dan Jaminan 100% Barang Original</li><li>Wajah Glowing tanpa Flek Hitam, Kerutan, dan Jerawat</li><li>Aman Untuk Semua Jenis Kulit &amp; Tanpa Efek Samping</li><li>Diskon 50% Dan Diskon Ongkir Seluruh Indonesia</li><li>Beli 1 Dapat 2 Bisa COD (Bayar Ditempat)</li></ul></section>',
    E'<section><h3>Testimoni</h3><blockquote><strong>Atin Rahmawati (PNS)</strong><br/>Aku udah coba berbagai krim anti kerut, tapi Ceraglow Youth Cream BPOM ini beda banget! Kerutan di wajah mulai memudar, kulit jadi lebih kencang, halus, dan lembap banget.</blockquote><blockquote><strong>Dewi Aulia (Mahasiswi)</strong><br/>Setelah pake Ceraglow Youth Cream BPOM, kulitku jadi lebih kencang, halus, dan kenyal. Kerutan memudar, wajah juga kelihatan lebih cerah dan glowing.</blockquote><blockquote><strong>Siska Dewi (Pegawai Swasta)</strong><br/>Setelah pakai Ceraglow Youth Cream BPOM ini, kulit wajah jadi lebih kencang, lembut, dan cerah! Kerutan halus memudar, kulit terasa kenyal banget.</blockquote></section>'
  ]::text[]
where not exists (
  select 1 from public.products p
  where p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
     or p.name = 'Ceraglow Youth Cream BPOM BL62-65'
);

-- 只保留本脚本定义的套餐，清理旧/杂项套餐
delete from public.product_packages pp
using public.products p
where pp.product_id = p.id
  and p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
  and pp.name not in ('Promo Beli 1', 'Lebih Hemat Beli 1 dapat 2');

with pkgs(name, name_external, original_price, discount_price, sort_order, summary, is_visible, image_url, qty) as (
  values
    (
      'Promo Beli 1',
      'Promo Beli 1 Rp. 120.000',
      240000.00::numeric,
      120000.00::numeric,
      0,
      '落地页：Promo Beli 1 Rp. 120.000（Diskon 50%）',
      true,
      'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg',
      1
    ),
    (
      'Lebih Hemat Beli 1 dapat 2',
      'Lebih Hemat Beli 1 dapat 2 Rp. 165.000',
      330000.00::numeric,
      165000.00::numeric,
      1,
      '落地页：Lebih Hemat Beli 1 dapat 2 Rp. 165.000（Diskon 50%）',
      true,
      'https://cdn.orderonline.id/uploads/images_7569161766594604519.jpeg',
      2
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
  join public.products p on p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
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
join public.products p on p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
left join ins_pkg on ins_pkg.name = pkgs.name and ins_pkg.product_id = p.id
left join public.product_packages existing
  on existing.product_id = p.id and existing.name = pkgs.name
where not exists (
  select 1
  from public.product_package_items i
  where i.package_id = coalesce(ins_pkg.id, existing.id)
);

-- 同步已存在套餐价格/说明
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
    ('Promo Beli 1', 'Promo Beli 1 Rp. 120.000', 240000.00::numeric, 120000.00::numeric, 0,
     '落地页：Promo Beli 1 Rp. 120.000（Diskon 50%）', true,
     'https://cdn.orderonline.id/uploads/images_3548121766594604918.jpeg'),
    ('Lebih Hemat Beli 1 dapat 2', 'Lebih Hemat Beli 1 dapat 2 Rp. 165.000', 330000.00::numeric, 165000.00::numeric, 1,
     '落地页：Lebih Hemat Beli 1 dapat 2 Rp. 165.000（Diskon 50%）', true,
     'https://cdn.orderonline.id/uploads/images_7569161766594604519.jpeg')
) as v(name, name_external, original_price, discount_price, sort_order, summary, is_visible, image_url)
join public.products p on p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
where pp.product_id = p.id and pp.name = v.name;

-- 同步套餐明细数量
update public.product_package_items i
set quantity = v.qty
from (
  values
    ('Promo Beli 1', 1),
    ('Lebih Hemat Beli 1 dapat 2', 2)
) as v(name, qty)
join public.product_packages pp on pp.name = v.name
join public.products p on p.id = pp.product_id and p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
where i.package_id = pp.id;

commit;

select
  p.id,
  p.name,
  p.link_suffix,
  p.price,
  p.status,
  p.packages_enabled,
  p.cover_url,
  cardinality(p.gallery_urls) as gallery_count,
  cardinality(p.detail_image_urls) as detail_count,
  (select count(*)::int from public.product_packages pp where pp.product_id = p.id) as package_count
from public.products p
where p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65';
