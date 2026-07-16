import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const sql = fs.readFileSync(
  path.join(root, "supabase/scripts/reset_cod_orders.sql"),
  "utf8",
);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

await client.connect();
try {
  const res = await client.query(sql);
  const results = Array.isArray(res) ? res : [res];
  for (const r of results) {
    if (r.rows?.length) console.table(r.rows);
    else if (r.command) console.log(r.command, r.rowCount ?? "");
  }
  console.log("OK: orders cleared and reseeded");
} finally {
  await client.end();
}
