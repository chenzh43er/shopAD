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
    "supabase/migrations/20261020100000_product_gifts_name.sql",
  ),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying product_gifts.gift_name migration...");
await client.query(sql);

const col = await client.query(`
  select column_name, data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'product_gifts'
    and column_name = 'gift_name'
`);
console.log("product_gifts.gift_name:", col.rows[0]?.column_name ?? "(missing)");

const count = await client.query(`
  select count(*)::int as n
  from public.product_gifts
  where gift_name is not null and btrim(gift_name) <> ''
`);
console.log("product_gifts with custom name:", count.rows[0]?.n);

await client.query("notify pgrst, 'reload schema'");
console.log("PostgREST schema cache reload notified");

await client.end();
console.log("Migration OK");
