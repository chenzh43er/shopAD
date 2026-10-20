// 为已有订单的 gift_snapshot 补写「赠品套餐内件数」(package_count)。
// 历史快照缺少 package_count，导致物流导出「套餐内件数×赠品数量」被当成 ×1。
// 按订单商品当前赠品配置回填，仅补字段，不增删赠品项。
// 用法：node scripts/backfill-order-gift-package-count.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  const file = path.join(repoRoot, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

const giftConfigCache = new Map();

async function giftConfigForProduct(productId) {
  if (giftConfigCache.has(productId)) return giftConfigCache.get(productId);
  const { rows } = await client.query(
    `select pg.quantity, gp.sku_code, gp.name, pg.package_id,
       (select coalesce(sum(ppi.quantity)::int, 1)
        from public.product_package_items ppi
        where ppi.package_id = pg.package_id) as pkg_count
     from public.product_gifts pg
     join public.products gp on gp.id = pg.gift_product_id
     where pg.product_id = $1`,
    [productId],
  );
  const map = new Map();
  for (const r of rows) {
    const key = (r.sku_code || r.name || "").trim();
    if (!key) continue;
    const pkgCount = Math.max(1, Math.floor(Number(r.pkg_count) || 1));
    const qty = Math.max(1, Math.floor(Number(r.quantity) || 1));
    const arr = map.get(key) ?? [];
    arr.push({ pkgCount, qty });
    map.set(key, arr);
  }
  giftConfigCache.set(productId, map);
  return map;
}

function resolvePackageCount(configMap, item) {
  const key = (item.sku_code || item.name || "").trim();
  const candidates = configMap.get(key) ?? [];
  if (candidates.length === 0) return 1;
  const distinct = new Set(candidates.map((c) => c.pkgCount));
  if (distinct.size === 1) return candidates[0].pkgCount;
  const qty = Math.floor(Number(item.quantity) || 1);
  const byQty = candidates.filter((c) => c.qty === qty);
  if (byQty.length > 0 && new Set(byQty.map((c) => c.pkgCount)).size === 1) {
    return byQty[0].pkgCount;
  }
  return Math.max(...candidates.map((c) => c.pkgCount));
}

await client.connect();
console.log("Connected, backfilling orders.gift_snapshot.package_count ...");

const { rows: orders } = await client.query(
  `select id, product_id, gift_snapshot
   from public.orders
   where gift_snapshot is not null
     and jsonb_typeof(gift_snapshot) = 'array'
     and jsonb_array_length(gift_snapshot) > 0
     and exists (
       select 1 from jsonb_array_elements(gift_snapshot) e
       where (e ->> 'package_count') is null
     )`,
);

console.log("orders needing backfill: " + orders.length);

let updated = 0;
for (const order of orders) {
  if (!order.product_id) continue;
  const configMap = await giftConfigForProduct(order.product_id);
  const snapshot = order.gift_snapshot;
  let changed = false;
  for (const item of snapshot) {
    if (item.package_count == null) {
      item.package_count = resolvePackageCount(configMap, item);
      changed = true;
    }
  }
  if (!changed) continue;
  await client.query(
    "update public.orders set gift_snapshot = $2::jsonb where id = $1",
    [order.id, JSON.stringify(snapshot)],
  );
  updated += 1;
}

console.log("orders updated: " + updated);
await client.query("notify pgrst, 'reload schema'");
await client.end();
console.log("Backfill OK");
