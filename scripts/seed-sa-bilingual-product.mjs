/**
 * 上架沙特双语测试商品：阿语主字段（/sa）+ 英语覆盖（/sa_en）
 * 用法：node scripts/seed-sa-bilingual-product.mjs
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, "workers/api/.dev.vars") });
config({ path: resolve(root, "../product-1/.env.local") });

const LINK_SUFFIX = `sa-bilingual-test-${Date.now().toString(36).slice(-6)}`;
const BUCKET = "product-locales";

// 稳定可用的测试图（Unsplash）
const IMGS = {
  arCover:
    "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800&h=800&fit=crop",
  arGallery: [
    "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800&h=800&fit=crop",
    "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=800&fit=crop",
    "https://images.unsplash.com/photo-1466692476866-aef1dfb1e735?w=800&h=800&fit=crop",
  ],
  arDetail: [
    "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800&h=800&fit=crop",
    "https://images.unsplash.com/photo-1592419044706-39796d40f98c?w=800&h=800&fit=crop",
  ],
  enCover:
    "https://images.unsplash.com/photo-1592419044706-39796d40f98c?w=800&h=800&fit=crop",
  enGallery: [
    "https://images.unsplash.com/photo-1592419044706-39796d40f98c?w=800&h=800&fit=crop",
    "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800&h=800&fit=crop",
    "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=800&fit=crop",
  ],
  pkg30:
    "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=600&h=600&fit=crop",
  pkg15:
    "https://images.unsplash.com/photo-1466692476866-aef1dfb1e735?w=600&h=600&fit=crop",
  pkg30En:
    "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=600&h=600&fit=crop",
  pkg15En:
    "https://images.unsplash.com/photo-1592419044706-39796d40f98c?w=600&h=600&fit=crop",
};

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function uploadJson(path, body) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(`${path}: ${error.message}`);
}

// 1) 币种 + 沙特地区
const { data: currency, error: cErr } = await supabase
  .from("currencies")
  .select("id, code")
  .eq("code", "SAR")
  .maybeSingle();
if (cErr) throw new Error(cErr.message);
if (!currency) throw new Error("未找到 SAR 币种");

const { data: libraries, error: lErr } = await supabase
  .from("address_libraries")
  .select("id, name, dial_code")
  .eq("dial_code", "966")
  .order("created_at", { ascending: true })
  .limit(1);
if (lErr) throw new Error(lErr.message);
const region = libraries?.[0];
if (!region) throw new Error("未找到沙特地区（dial_code=966），请先 seed:saudi");

const { data: domain } = await supabase
  .from("domains")
  .select("id, host")
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();

// 2) 创建商品（阿语主字段）
const productRow = {
  name: "مصباح LED ذكي للمنزل",
  title_external: "مصباح LED ذكي للمنزل — عرض خاص",
  description:
    "مصباح LED ذكي قابل للتعتيم مع تحكم عبر التطبيق.\n\nإضاءة موفرة للطاقة ومناسبة لغرفة المعيشة والنوم.",
  description_entries: [
    "تحكم عن بُعد عبر التطبيق",
    "تعتيم وتغيير درجة الحرارة اللونية",
    "توفير للطاقة وعمر طويل",
    "تركيب سهل بدون كهربائي",
    "توصيل مجاني — الدفع عند الاستلام (COD)",
  ],
  price: 89,
  cover_url: IMGS.arCover,
  gallery_urls: IMGS.arGallery,
  detail_image_urls: IMGS.arDetail,
  status: "on_sale",
  sku_code: "SA-LED-01",
  sku_display: "Smart LED Lamp",
  weight: 0.6,
  link_suffix: LINK_SUFFIX,
  packages_enabled: true,
  sales_count: 128,
  currency_id: currency.id,
  region_id: region.id,
  domain_id: domain?.id ?? null,
};

const { data: product, error: pErr } = await supabase
  .from("products")
  .insert(productRow)
  .select("id, name, link_suffix, status")
  .single();
if (pErr) throw new Error(`创建商品失败: ${pErr.message}`);
console.log("product:", product.id, product.link_suffix);

// 3) 所属人：挂全部 profiles
const { data: profiles } = await supabase.from("profiles").select("id");
for (const p of profiles ?? []) {
  await supabase.from("product_owners").upsert(
    {
      product_id: product.id,
      profile_id: p.id,
      created_by: p.id,
    },
    { onConflict: "product_id,profile_id" },
  );
}

// 4) 套餐（阿语默认）
const packageRows = [
  {
    product_id: product.id,
    name: "عبوة واحدة1",
    name_external: "مصباح LED ذكي — قطعة واحدة1",
    original_price: 159,
    discount_price: 89,
    summary: "قطعة واحدة1",
    image_url: IMGS.pkg30,
    is_visible: true,
    sort_order: 0,
  },
  {
    product_id: product.id,
    name: "عبوة ×2",
    name_external: "مصباح LED ذكي — قطعتان",
    original_price: 298,
    discount_price: 149,
    summary: "قطعتان بسعر أوفر",
    image_url: IMGS.pkg15,
    is_visible: true,
    sort_order: 1,
  },
];

const { data: packages, error: pkgErr } = await supabase
  .from("product_packages")
  .insert(packageRows)
  .select("id, name, sort_order");
if (pkgErr) throw new Error(`创建套餐失败: ${pkgErr.message}`);

const bySort = new Map((packages ?? []).map((p) => [p.sort_order, p]));
const itemRows = [];
for (const pkg of packages ?? []) {
  const qty = pkg.sort_order === 0 ? 1 : 2;
  itemRows.push({
    package_id: pkg.id,
    ref_product_id: product.id,
    quantity: qty,
    independent_attrs: false,
    sort_order: 0,
  });
}
const { error: itemErr } = await supabase
  .from("product_package_items")
  .insert(itemRows);
if (itemErr) throw new Error(`套餐明细失败: ${itemErr.message}`);

// 5) 英语商品覆盖 /sa_en
await uploadJson(`products/${product.id}/en.json`, {
  label: "英语",
  locale: "en",
  title_external: "Smart LED Home Lamp — Special Offer",
  facebook_pixel_id: null,
  google_conversion_id: null,
  google_label: null,
  description:
    "Dimmable smart LED lamp with app control.\n\nEnergy-efficient lighting for living room and bedroom. Cash on delivery available.",
  description_entries: [
    "Remote control via mobile app",
    "Dimming & color temperature adjust",
    "Energy saving with long lifespan",
    "Easy install — no electrician needed",
    "Free delivery — Cash on delivery (COD)",
  ],
  cover_url: IMGS.enCover,
  gallery_urls: IMGS.enGallery,
  detail_image_urls: IMGS.arDetail,
  updated_at: new Date().toISOString(),
});
console.log("uploaded en locale");

// 6) 英语套餐名 + 图
const pkg1 = bySort.get(0);
const pkg2 = bySort.get(1);
const pkgLocaleMap = {};
if (pkg1) {
  pkgLocaleMap[pkg1.id] = {
    en: {
      name: "1-Pack",
      name_external: "Smart LED Lamp — 1 piece",
      image_url: IMGS.pkg30En,
    },
  };
}
if (pkg2) {
  pkgLocaleMap[pkg2.id] = {
    en: {
      name: "2-Pack",
      name_external: "Smart LED Lamp — 2 pieces",
      image_url: IMGS.pkg15En,
    },
  };
}
await uploadJson(`packages/${product.id}.json`, pkgLocaleMap);
console.log("uploaded package en locales");

console.log("\nOK — 沙特双语测试商品已上架");
console.log(`  商品名(阿): ${productRow.name}`);
console.log(`  link_suffix: ${LINK_SUFFIX}`);
console.log(`  地区: ${region.name} (+${region.dial_code}) / SAR`);
console.log(`  阿语: http://localhost:3000/sa/${LINK_SUFFIX}`);
console.log(`  英语: http://localhost:3000/sa_en/${LINK_SUFFIX}`);
