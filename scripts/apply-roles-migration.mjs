import fs from "node:fs";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = fs.readFileSync(
  "supabase/migrations/20260724010000_roles_and_employees.sql",
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying roles migration...");
await client.query(sql);

const cols = await client.query(`
  select column_name
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
  order by ordinal_position
`);
console.log(
  "profiles columns:",
  cols.rows.map((r) => r.column_name).join(", "),
);

const roles = await client.query(`
  select role, count(*)::int as n
  from public.profiles
  group by role
  order by role
`);
console.log("roles:", roles.rows);

await client.end();
console.log("Migration OK");
