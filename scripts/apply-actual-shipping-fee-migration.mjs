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
    "supabase/migrations/20261117010000_address_regions_actual_shipping_fee.sql",
  ),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying address_regions.actual_shipping_fee...");
await client.query(sql);

const col = await client.query(`
  select column_name, data_type, numeric_precision, numeric_scale
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'address_regions'
    and column_name = 'actual_shipping_fee'
`);
console.log("address_regions.actual_shipping_fee:", col.rows[0] ?? "(missing)");

await client.query("notify pgrst, 'reload schema'");
console.log("PostgREST schema cache reload notified");

await client.end();
console.log("Migration OK");
