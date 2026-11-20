import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function loadEnvFile() {
  const file = path.join(repoRoot, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(
    repoRoot,
    "supabase/migrations/20261117030000_product_order_free_shipping.sql",
  ),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying free_shipping migration...");
await client.query(sql);

const productCol = await client.query(`
  select column_name, data_type, column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'free_shipping'
`);
const orderCol = await client.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'orders'
    and column_name = 'free_shipping'
`);
console.log("products.free_shipping:", productCol.rows[0] ?? "(missing)");
console.log("orders.free_shipping:", orderCol.rows[0] ?? "(missing)");

await client.query("notify pgrst, 'reload schema'");
console.log("PostgREST schema cache reload notified");
await client.end();
console.log("Migration OK");
