/**
 * （可选）创建 profile_regions 关系表。
 * 当前应用已将地区权限存于 auth.users.user_metadata.region_ids，无需执行本脚本。
 * 若需启用关系表，请设置 DATABASE_URL 后运行。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.resolve(root, ".env") });
config({ path: path.resolve(root, "workers/api/.dev.vars") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is required.\n" +
      "Supabase Dashboard → Project Settings → Database → Connection string (URI)\n" +
      "或在项目根目录 .env 中设置 DATABASE_URL 后重试。",
  );
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260827020000_profile_regions.sql"),
  "utf8",
);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? undefined
    : { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected, applying profile_regions migration...");
await client.query(sql);

const table = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_name = 'profile_regions'
`);
console.log("table:", table.rows[0]?.table_name ?? "(missing)");

await client.end();
console.log("Migration OK");
