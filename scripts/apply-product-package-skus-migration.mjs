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
    "supabase/migrations/20261026020000_product_package_skus.sql",
  ),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying product_package_skus migration...");
await client.query(sql);

const table = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_name = 'product_package_skus'
`);
console.log(
  "product_package_skus table:",
  table.rows[0]?.table_name ?? "(missing)",
);

const oldTable = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_name = 'product_skus'
`);
console.log(
  "old product_skus table:",
  oldTable.rows[0]?.table_name ?? "(dropped)",
);

const flag = await client.query(`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'independent_attrs_enabled'
`);
console.log(
  "products.independent_attrs_enabled:",
  flag.rows[0]?.column_name ?? "(removed)",
);

const indexes = await client.query(`
  select indexname
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'product_package_skus'
  order by indexname
`);
console.log(
  "product_package_skus indexes:",
  indexes.rows.map((r) => r.indexname).join(", ") || "(none)",
);

const fn = await client.query(`
  select proname
  from pg_proc
  join pg_namespace n on n.oid = pg_proc.pronamespace
  where n.nspname = 'public' and proname = 'product_sku_code_taken'
`);
console.log(
  "product_sku_code_taken():",
  fn.rows[0]?.proname ?? "(missing)",
);

const count = await client.query(`
  select count(*)::int as n from public.product_package_skus
`);
console.log("product_package_skus rows:", count.rows[0]?.n);

await client.query("notify pgrst, 'reload schema'");
console.log("PostgREST schema cache reload notified");

await client.end();
console.log("Migration OK");
