/**
 * 生产库执行订单列表 created_at 索引迁移。
 * 用法：在项目根目录设置 DATABASE_URL 后运行
 *   node scripts/apply-orders-list-indexes-migration.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.resolve(root, ".env") });
config({ path: path.resolve(root, "workers/api/.dev.vars") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is required.\n" +
      "Supabase Dashboard → Project Settings → Database → Connection string (URI)",
  );
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20260828010000_orders_list_created_at_indexes.sql",
  ),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? undefined
    : { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying orders list created_at indexes...");
await client.query(sql);

const indexes = await client.query(`
  select indexname
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'orders_list_cod_created_idx',
      'orders_list_payment_status_created_idx',
      'orders_list_payment_created_idx',
      'orders_product_created_idx',
      'product_owners_product_id_idx'
    )
  order by indexname
`);
console.log(
  "Indexes:",
  indexes.rows.map((r) => r.indexname).join(", ") || "(none)",
);

await client.end();
console.log("Migration OK");
