import fs from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = fs.readFileSync(
  "supabase/migrations/20260804020000_domains_drop_default.sql",
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, dropping domains.is_default...");
await client.query(sql);

const col = await client.query(`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'domains'
    and column_name = 'is_default'
`);
console.log(
  "domains.is_default:",
  col.rows[0]?.column_name ?? "(dropped)",
);

await client.end();
console.log("Migration OK");
