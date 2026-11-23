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
    "supabase/migrations/20261124010000_product_packages_is_default.sql",
  ),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying product_packages.is_default migration...");
await client.query(sql);

const column = await client.query(`
  select column_name, data_type, column_default, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'product_packages'
    and column_name = 'is_default'
`);
console.log("column:", column.rows[0] ?? "(missing)");

const defaults = await client.query(`
  select product_id, count(*)::int as total,
         count(*) filter (where is_default)::int as defaults
  from public.product_packages
  group by product_id
  having count(*) filter (where is_default) <> 1
  limit 20
`);
console.log("products without exactly one default:", defaults.rows);

await client.end();
