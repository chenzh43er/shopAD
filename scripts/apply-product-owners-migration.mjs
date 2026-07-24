import fs from "node:fs";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = fs.readFileSync(
  "supabase/migrations/20260724020000_product_owners.sql",
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying product_owners migration...");
await client.query(sql);

const table = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_name = 'product_owners'
`);
console.log("table:", table.rows[0]?.table_name ?? "(missing)");

const count = await client.query(`
  select count(*)::int as n from public.product_owners
`);
console.log("product_owners rows:", count.rows[0]?.n);

await client.end();
console.log("Migration OK");
