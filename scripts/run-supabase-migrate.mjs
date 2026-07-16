import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = path.resolve("supabase/migrations");
const seedPath = path.resolve("supabase/seed.sql");
const runSeed = process.env.RUN_SEED === "1";

function listMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(migrationsDir, name));
}

async function main() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected.");

  for (const file of listMigrationFiles()) {
    const sql = fs.readFileSync(file, "utf8");
    console.log(`Running ${path.basename(file)}...`);
    await client.query(sql);
    console.log(`OK: ${path.basename(file)}`);
  }

  if (runSeed) {
    const seedSql = fs.readFileSync(seedPath, "utf8");
    console.log("Running seed...");
    await client.query(seedSql);
    console.log("Seed OK.");
  }

  const tables = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'profiles', 'products', 'orders',
        'logistics_shipper', 'product_packages', 'product_package_items',
        'audit_logs'
      )
    order by table_name
  `);
  console.log(
    "Tables:",
    tables.rows.map((r) => r.table_name).join(", "),
  );

  const bucket = await client.query(`
    select id, public from storage.buckets where id = 'product-images'
  `);
  console.log("Storage bucket:", bucket.rows[0] ?? "(missing)");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
