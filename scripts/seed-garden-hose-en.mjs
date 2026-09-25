/**
 * 为沙特测试商品补全 /sa_en 英语覆盖（product-locales Storage）
 * 用法：node scripts/seed-garden-hose-en.mjs
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, "workers/api/.dev.vars") });
config({ path: resolve(root, "../product-1/.env.local") });

const LINK_SUFFIX = "anbob-ry-alhdyk-alkabl-lltmdd";
const BUCKET = "product-locales";

// 测试用公开图（Unsplash 固定尺寸，稳定可用）
const IMG = [
  "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=800&fit=crop",
  "https://images.unsplash.com/photo-1592419044706-39796d40f98c?w=800&h=800&fit=crop",
  "https://images.unsplash.com/photo-1466692476866-aef1dfb1e735?w=800&h=800&fit=crop",
  "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800&h=800&fit=crop",
  "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=800&h=800&fit=crop",
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

async function uploadJson(path, body) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(`${path}: ${error.message}`);
}

const { data: product, error: pErr } = await supabase
  .from("products")
  .select("id, name, link_suffix, status")
  .eq("link_suffix", LINK_SUFFIX)
  .maybeSingle();

if (pErr) throw new Error(pErr.message);
if (!product) {
  console.error(`未找到商品 link_suffix=${LINK_SUFFIX}`);
  process.exit(1);
}

console.log("product:", product.id, product.name);

const enLocale = {
  label: "英语",
  locale: "en",
  title_external: "Expandable Garden Hose Pipe",
  facebook_pixel_id: null,
  google_conversion_id: null,
  google_label: null,
  description:
    "Expandable Garden Hose Pipe\n\nStretch up to 3× length. Lightweight, tangle-free, great for garden watering, car wash and outdoor cleaning. Cash on delivery available.",
  description_entries: [
    "Expands up to 3× its original length",
    "Multi-pattern spray nozzle for watering & cleaning",
    "Lightweight and easy to store without tangling",
    "Leak-resistant and durable for daily use",
    "Ideal for garden, car wash and outdoor cleaning",
    "Free delivery — Cash on delivery (COD)",
  ],
  cover_url: IMG[0],
  gallery_urls: [IMG[0], IMG[1], IMG[2], IMG[3]],
  detail_image_urls: [IMG[1], IMG[2], IMG[4], IMG[3]],
  updated_at: new Date().toISOString(),
};

await uploadJson(`products/${product.id}/en.json`, enLocale);
console.log("uploaded products/.../en.json");

const { data: packages, error: pkgErr } = await supabase
  .from("product_packages")
  .select("id, name, sort_order")
  .eq("product_id", product.id)
  .order("sort_order", { ascending: true });

if (pkgErr) throw new Error(pkgErr.message);

const pkgMap = {};
for (const pkg of packages ?? []) {
  const is30 = /30/.test(pkg.name) || Number(pkg.sort_order) === 0;
  pkgMap[pkg.id] = {
    en: {
      name: is30 ? "30m Hose" : "15m Hose",
      name_external: is30
        ? "Expandable Garden Hose (30 meters)"
        : "Expandable Garden Hose (15 meters)",
    },
  };
  console.log("package", pkg.id, pkg.name, "→", pkgMap[pkg.id].en.name);
}

await uploadJson(`packages/${product.id}.json`, pkgMap);
console.log("uploaded packages/...json");

const publicBase = `${url}/storage/v1/object/public/${BUCKET}`;
console.log("\nOK — test URLs:");
console.log(`  /sa/${LINK_SUFFIX}`);
console.log(`  /sa_en/${LINK_SUFFIX}`);
console.log(`  locale JSON: ${publicBase}/products/${product.id}/en.json`);
