/**
 * 修正已上架双语测试商品文案：
 * - 去掉「免运费 / Free delivery」卖点（结账收 ر.س 20）
 * - 套餐名 قطعة واحدة1 → قطعة واحدة
 *
 * 用法：node scripts/fix-sa-bilingual-copy.mjs [link_suffix]
 * 默认：sa-bilingual-test-fojvuv
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, "workers/api/.dev.vars") });
config({ path: resolve(root, "../product-1/.env.local") });

const LINK_SUFFIX = process.argv[2] || "sa-bilingual-test-fojvuv";
const BUCKET = "product-locales";

const AR_SHIPPING_LINE = "توصيل سريع — الدفع عند الاستلام (COD)";
const EN_SHIPPING_LINE = "Fast delivery — Cash on delivery (COD)";
const FREE_AR = /توصيل\s*مجاني/;
const FREE_EN = /free\s+delivery/i;

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function patchEntries(entries, freeRe, replacement) {
  if (!Array.isArray(entries)) return { entries: entries ?? [], changed: false };
  let changed = false;
  const next = entries.map((line) => {
    const s = String(line ?? "");
    if (freeRe.test(s)) {
      changed = true;
      return replacement;
    }
    return s;
  });
  return { entries: next, changed };
}

const { data: product, error: pErr } = await supabase
  .from("products")
  .select("id, link_suffix, description_entries")
  .eq("link_suffix", LINK_SUFFIX)
  .maybeSingle();
if (pErr) throw new Error(pErr.message);
if (!product) {
  console.error(`未找到商品 link_suffix=${LINK_SUFFIX}`);
  process.exit(1);
}

const arPatch = patchEntries(
  product.description_entries,
  FREE_AR,
  AR_SHIPPING_LINE,
);
if (arPatch.changed) {
  const { error } = await supabase
    .from("products")
    .update({ description_entries: arPatch.entries })
    .eq("id", product.id);
  if (error) throw new Error(`更新阿语卖点失败: ${error.message}`);
  console.log("updated products.description_entries");
} else {
  console.log("products.description_entries already OK");
}

const { data: packages, error: pkgErr } = await supabase
  .from("product_packages")
  .select("id, name, name_external, summary, sort_order")
  .eq("product_id", product.id);
if (pkgErr) throw new Error(pkgErr.message);

for (const pkg of packages ?? []) {
  const updates = {};
  if (pkg.sort_order === 0 || /واحدة\s*1|عبوة واحدة1/.test(`${pkg.name}|${pkg.name_external}|${pkg.summary}`)) {
    if (pkg.name === "عبوة واحدة1") updates.name = "عبوة واحدة";
    if (pkg.name_external?.includes("قطعة واحدة1")) {
      updates.name_external = pkg.name_external.replace("قطعة واحدة1", "قطعة واحدة");
    }
    if (pkg.summary === "قطعة واحدة1") updates.summary = "قطعة واحدة";
  }
  if (Object.keys(updates).length === 0) continue;
  const { error } = await supabase
    .from("product_packages")
    .update(updates)
    .eq("id", pkg.id);
  if (error) throw new Error(`更新套餐失败: ${error.message}`);
  console.log("updated package", pkg.id, updates);
}

const enPath = `products/${product.id}/en.json`;
const { data: enBlob, error: enDlErr } = await supabase.storage
  .from(BUCKET)
  .download(enPath);
if (enDlErr) {
  console.warn("skip en.json:", enDlErr.message);
} else {
  const enJson = JSON.parse(await enBlob.text());
  const enPatch = patchEntries(
    enJson.description_entries,
    FREE_EN,
    EN_SHIPPING_LINE,
  );
  if (enPatch.changed) {
    enJson.description_entries = enPatch.entries;
    enJson.updated_at = new Date().toISOString();
    const bytes = new TextEncoder().encode(JSON.stringify(enJson));
    const { error } = await supabase.storage.from(BUCKET).upload(enPath, bytes, {
      contentType: "application/json",
      upsert: true,
    });
    if (error) throw new Error(`更新 en.json 失败: ${error.message}`);
    console.log("updated", enPath);
  } else {
    console.log("en.json description_entries already OK");
  }
}

console.log("\nOK — fixed copy for", LINK_SUFFIX, product.id);
