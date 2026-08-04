import fs from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = fs.readFileSync(
  "supabase/migrations/20260804010000_domains.sql",
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying domains migration...");
await client.query(sql);

const table = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_name = 'domains'
`);
console.log("table:", table.rows[0]?.table_name ?? "(missing)");

const col = await client.query(`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'domain_id'
`);
console.log("products.domain_id:", col.rows[0]?.column_name ?? "(missing)");

await client.end();
console.log("Migration OK");
