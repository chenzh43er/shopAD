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
  "supabase/migrations/20260724030000_cod_refused_status.sql",
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying cod_refused status migration...");
await client.query(sql);

const check = await client.query(`
  select pg_get_constraintdef(oid) as def
  from pg_constraint
  where conname = 'orders_status_check'
    and conrelid = 'public.orders'::regclass
`);
console.log("orders_status_check:", check.rows[0]?.def ?? "(missing)");

await client.end();
console.log("Migration OK");
