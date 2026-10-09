/**
 * 生成 SA 市场待审核 COD 测试订单（默认 3 条）
 * 用法：node scripts/insert-sa-pending-orders.mjs [数量] [link_suffix]
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, "workers/api/.dev.vars") });
config({ path: resolve(root, "../product-1/.env.local") });

const COUNT = Math.max(1, Number(process.argv[2] || 3));
const LINK_SUFFIX_ARG = process.argv[3] || null;
const ORDER_PREFIX = "SA-PENDING";
const SHIPPING_FEE_SAR = 20;

const customers = [
  {
    name: "أحمد محمد العتيبي",
    phone: "966501234501",
    province: "الرياض",
    city: "الرياض",
    district: "العليا",
    detail: "شارع العليا، مبنى 12",
  },
  {
    name: "فاطمة عبدالله الشمري",
    phone: "966501234502",
    province: "مكة المكرمة",
    city: "جدة",
    district: "الروضة",
    detail: "حي الروضة، شارع الأمير سلطان",
  },
  {
    name: "خالد سعد القحطاني",
    phone: "966501234503",
    province: "المنطقة الشرقية",
    city: "الدمام",
    district: "الفيصلية",
    detail: "حي الفيصلية، قرب الميناء",
  },
  {
    name: "نورة إبراهيم الحربي",
    phone: "966501234504",
    province: "الرياض",
    city: "الرياض",
    district: "الملز",
    detail: "حي الملز، شارع الستين",
  },
  {
    name: "سارة يوسف الدوسري",
    phone: "966501234505",
    province: "مكة المكرمة",
    city: "مكة المكرمة",
    district: "العزيزية",
    detail: "حي العزيزية، قرب الحرم",
  },
];

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 1) 找 SA 商品（dial 966 或 SAR）
let product = null;
if (LINK_SUFFIX_ARG) {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, link_suffix, status, sku_code, price, weight, region_id, currency_id",
    )
    .eq("link_suffix", LINK_SUFFIX_ARG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  product = data;
} else {
  const { data: libs, error: lErr } = await supabase
    .from("address_libraries")
    .select("id")
    .eq("dial_code", "966");
  if (lErr) throw new Error(lErr.message);
  const regionIds = (libs ?? []).map((r) => r.id);

  let q = supabase
    .from("products")
    .select(
      "id, name, link_suffix, status, sku_code, price, weight, region_id, currency_id",
    )
    .eq("status", "on_sale")
    .order("created_at", { ascending: false })
    .limit(20);

  if (regionIds.length) {
    q = q.in("region_id", regionIds);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  product = data?.[0] ?? null;

  if (!product) {
    const { data: currency } = await supabase
      .from("currencies")
      .select("id")
      .eq("code", "SAR")
      .maybeSingle();
    if (currency) {
      const { data: byCur, error: cErr } = await supabase
        .from("products")
        .select(
          "id, name, link_suffix, status, sku_code, price, weight, region_id, currency_id",
        )
        .eq("currency_id", currency.id)
        .eq("status", "on_sale")
        .order("created_at", { ascending: false })
        .limit(1);
      if (cErr) throw new Error(cErr.message);
      product = byCur?.[0] ?? null;
    }
  }
}

if (!product) {
  console.error("未找到 SA 商品（dial_code=966 / SAR）。请先 seed SA 商品。");
  process.exit(1);
}

console.log(
  "product:",
  product.link_suffix,
  product.name,
  "status=",
  product.status,
);

// 2) 套餐
const { data: packages, error: pkgErr } = await supabase
  .from("product_packages")
  .select("id, name, name_external, original_price, discount_price, is_visible")
  .eq("product_id", product.id)
  .eq("is_visible", true)
  .order("sort_order");
if (pkgErr) throw new Error(pkgErr.message);

// 3) 真实地址（若有）覆盖默认客户地址
if (product.region_id) {
  const { data: regions } = await supabase
    .from("address_regions")
    .select("province, city, district")
    .eq("library_id", product.region_id)
    .limit(20);
  if (regions?.length) {
    for (let i = 0; i < customers.length; i++) {
      const r = regions[i % regions.length];
      customers[i] = {
        ...customers[i],
        province: r.province,
        city: r.city,
        district: r.district,
      };
    }
  }
}

const stamp = Date.now().toString(36).toUpperCase();
const rows = [];

for (let i = 0; i < COUNT; i++) {
  const c = customers[i % customers.length];
  // 错开手机号，避免重复检测干扰
  const phone = `9665${String(10000000 + (Date.now() % 1000000) + i).slice(-8)}`;
  const pkg = packages?.length ? packages[i % packages.length] : null;
  const quantity = 1;
  const unitPrice = Number(
    pkg?.discount_price ?? pkg?.original_price ?? product.price ?? 0,
  );
  const goodsTotal = unitPrice * quantity;
  const total = goodsTotal + SHIPPING_FEE_SAR;
  const orderNo = `${ORDER_PREFIX}-${stamp}-${String(i + 1).padStart(2, "0")}`;
  const address = `${c.detail}, ${c.district}, ${c.city}, ${c.province}`;

  rows.push({
    order_no: orderNo,
    customer_name: c.name,
    customer_phone: phone,
    shipping_address: address,
    shipping_province: c.province,
    shipping_city: c.city,
    shipping_district: c.district,
    shipping_detail: c.detail,
    total_amount: total,
    status: "awaiting_review",
    remark: `SA 待审核测试单 #${i + 1}`,
    owner_member: "测试员",
    payment_method: "货到付款",
    payment_type: "cod",
    review_status: "pending",
    cod_amount: total,
    express_type: "EZ",
    shipping_fee: SHIPPING_FEE_SAR,
    other_fee: 0,
    package_count: 1,
    weight: Number(product.weight ?? 0.5),
    item_value: goodsTotal,
    item_category: "日用百货",
    item_type: "BARANG",
    product_id: product.id,
    product_name: product.name,
    package_id: pkg?.id ?? null,
    package_name: pkg?.name ?? null,
    package_name_external: pkg?.name_external ?? null,
    unit_price: unitPrice,
    quantity,
    sku_code: product.sku_code,
  });
}

const { data: inserted, error: insErr } = await supabase
  .from("orders")
  .insert(rows)
  .select(
    "order_no, customer_name, customer_phone, package_name, unit_price, shipping_fee, total_amount, status, review_status",
  );

if (insErr) {
  console.error("插入失败:", insErr.message);
  process.exit(1);
}

console.log(
  `Inserted ${inserted.length} SA pending-review orders for ${product.name} (${product.link_suffix})`,
);
console.table(
  inserted.map((o) => ({
    order_no: o.order_no,
    customer: o.customer_name,
    phone: o.customer_phone,
    package: o.package_name,
    unit: o.unit_price,
    ship: o.shipping_fee,
    total: o.total_amount,
    status: o.status,
    review: o.review_status,
  })),
);
