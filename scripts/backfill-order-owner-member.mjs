/**
 * 回填订单归属成员：按商品所属人 display_name（多名以「、」连接）。
 *
 * 用法：
 *   node scripts/backfill-order-owner-member.mjs
 *
 * 读取 workers/api/.dev.vars 中的 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。
 * 亦可在 Supabase SQL Editor 执行：
 *   supabase/migrations/20260916010000_backfill_order_owner_member.sql
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.resolve(root, "workers/api/.dev.vars") });
config({ path: path.resolve(root, ".env") });

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error(
    "需要 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY（workers/api/.dev.vars）",
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE = 1000;

/** @returns {Promise<Map<string, string>>} */
async function loadProductOwnerLabels() {
  /** @type {Map<string, string[]>} */
  const byProduct = new Map();
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("product_owners")
      .select("product_id, profile:profiles!product_owners_profile_id_fkey(id, display_name)")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`读 product_owners 失败: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const productId = row.product_id;
      if (typeof productId !== "string" || !productId) continue;
      const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
      const name =
        profile && typeof profile.display_name === "string"
          ? profile.display_name.trim()
          : "";
      if (!name) continue;
      if (!byProduct.has(productId)) byProduct.set(productId, []);
      byProduct.get(productId).push(name);
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  /** @type {Map<string, string>} */
  const labels = new Map();
  for (const [productId, names] of byProduct) {
    const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b, "zh"));
    if (unique.length) labels.set(productId, unique.join("、"));
  }
  return labels;
}

async function countOrders() {
  const { count: total, error: e1 } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .not("product_id", "is", null);
  if (e1) throw new Error(e1.message);

  const { count: empty, error: e2 } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .not("product_id", "is", null)
    .or("owner_member.is.null,owner_member.eq.");
  if (e2) throw new Error(e2.message);

  return { total: total ?? 0, empty: empty ?? 0 };
}

console.log("Loading product owner labels...");
const labels = await loadProductOwnerLabels();
console.log(`Products with owners: ${labels.size}`);

const before = await countOrders();
console.log("Before:", before);

let scanned = 0;
let updated = 0;
let skipped = 0;
let from = 0;

for (;;) {
  const { data, error } = await supabase
    .from("orders")
    .select("id, product_id, owner_member, order_no")
    .not("product_id", "is", null)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`读 orders 失败: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) break;

  /** @type {Map<string, string[]>} label -> order ids */
  const batches = new Map();
  for (const row of rows) {
    scanned += 1;
    const productId =
      typeof row.product_id === "string" ? row.product_id : "";
    const next = productId ? labels.get(productId) ?? "" : "";
    if (!next) {
      skipped += 1;
      continue;
    }
    const cur =
      typeof row.owner_member === "string" ? row.owner_member.trim() : "";
    if (cur === next) {
      skipped += 1;
      continue;
    }
    if (!batches.has(next)) batches.set(next, []);
    batches.get(next).push(row.id);
  }

  for (const [ownerMember, ids] of batches) {
    // 分块更新，避免 URL / payload 过大
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error: upErr } = await supabase
        .from("orders")
        .update({ owner_member: ownerMember })
        .in("id", chunk);
      if (upErr) {
        throw new Error(`更新失败 (${ownerMember}): ${upErr.message}`);
      }
      updated += chunk.length;
    }
  }

  if (rows.length < PAGE) break;
  from += PAGE;
  console.log(`… scanned ${scanned}, updated ${updated}`);
}

const after = await countOrders();
console.log("After:", after);
console.log({ scanned, updated, skippedSameOrNoOwner: skipped });

const { data: sample, error: sampleErr } = await supabase
  .from("orders")
  .select("order_no, owner_member, product_name")
  .not("owner_member", "is", null)
  .neq("owner_member", "")
  .order("updated_at", { ascending: false })
  .limit(8);
if (sampleErr) {
  console.warn("Sample query failed:", sampleErr.message);
} else {
  console.log("Sample:");
  for (const row of sample ?? []) {
    console.log(
      `  ${row.order_no} | ${row.owner_member} | ${row.product_name ?? ""}`,
    );
  }
}

console.log("Done.");
