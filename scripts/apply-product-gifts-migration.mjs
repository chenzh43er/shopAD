import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sql = fs.readFileSync(
  path.join(repoRoot, "supabase/migrations/20261019010000_product_gifts.sql"),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying product_gifts migration...");
await client.query(sql);

const table = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_name = 'product_gifts'
`);
console.log("table:", table.rows[0]?.table_name ?? "(missing)");

const col = await client.query(`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'orders'
    and column_name = 'gift_snapshot'
`);
console.log("orders.gift_snapshot:", col.rows[0]?.column_name ?? "(missing)");

const count = await client.query(`
  select count(*)::int as n from public.product_gifts
`);
console.log("product_gifts rows:", count.rows[0]?.n);

await client.end();
console.log("Migration OK");
