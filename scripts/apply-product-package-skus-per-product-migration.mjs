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
    "supabase/migrations/20261027030000_product_package_skus_per_product.sql",
  ),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying per-product sku uniqueness migration...");
await client.query(sql);

const idx = await client.query(`
  select indexname, indexdef
  from pg_indexes
  where schemaname = 'public' and tablename = 'product_package_skus'
  order by indexname
`);
console.log("indexes:");
for (const row of idx.rows) console.log(" -", row.indexname, "|", row.indexdef);

const fn = await client.query(`
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('product_sku_code_taken', 'prepare_package_sku')
  order by p.proname
`);
console.log("functions:", fn.rows.map((r) => r.proname).join(", ") || "(none)");

const nulls = await client.query(`
  select count(*)::int as n
  from public.product_package_skus
  where product_id is null
`);
console.log("rows with null product_id:", nulls.rows[0]?.n);

await client.query("notify pgrst, 'reload schema'");
console.log("PostgREST schema cache reload notified");

await client.end();
console.log("Migration OK");
