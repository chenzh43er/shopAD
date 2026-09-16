/**
 * 应用「下单自动写归属成员」迁移（函数 + 触发器 + 回填）
 *
 *   node scripts/apply-orders-owner-member-trigger.mjs
 *
 * 需要 postgres 权限的 DATABASE_URL（Session pooler），不能用 storefront。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.resolve(root, ".env") });
config({ path: path.resolve(root, "workers/api/.dev.vars") });
config({ path: path.resolve(root, "../product-2/.env.local") });

const MIGRATION =
  "supabase/migrations/20260916020000_orders_owner_member_from_product.sql";

function readDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  for (const file of [
    path.resolve(root, ".env"),
    path.resolve(root, "../product-2/.env.local"),
  ]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    // 优先未注释的 postgres.* / postgres 用户
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^[ \t]*DATABASE_URL=(.+)$/);
      if (!m) continue;
      const v = m[1].trim().replace(/^['"]|['"]$/g, "");
      if (v.startsWith("postgres")) return v;
    }
  }
  return null;
}

function parsePgUrl(raw) {
  const normalized = raw.replace(/^postgres:/, "postgresql:");
  const withoutScheme = normalized.replace(/^postgresql:\/\//, "");
  const at = withoutScheme.lastIndexOf("@");
  if (at < 0) throw new Error("DATABASE_URL missing @host");
  const creds = withoutScheme.slice(0, at);
  const rest = withoutScheme.slice(at + 1);
  const colon = creds.indexOf(":");
  const user = decodeURIComponent(colon >= 0 ? creds.slice(0, colon) : creds);
  const password = decodeURIComponent(colon >= 0 ? creds.slice(colon + 1) : "");
  const slash = rest.indexOf("/");
  const hostPort = slash >= 0 ? rest.slice(0, slash) : rest;
  const dbAndQuery = slash >= 0 ? rest.slice(slash + 1) : "postgres";
  const dbName = dbAndQuery.split("?")[0] || "postgres";
  const [host, portRaw] = hostPort.split(":");
  return {
    user,
    password,
    host,
    port: Number(portRaw) || 5432,
    database: dbName,
  };
}

function toPoolerConfigs(parsed) {
  const projectRef =
    parsed.host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1] ??
    parsed.user.match(/^postgres\.([a-z0-9]+)$/i)?.[1] ??
    null;
  const baseUser = parsed.user.includes(".")
    ? parsed.user
    : projectRef
      ? `postgres.${projectRef}`
      : parsed.user;
  const regions = ["ap-southeast-1", "ap-east-1", "ap-northeast-1"];
  const configs = [
    {
      label: `${parsed.host}:${parsed.port}`,
      config: {
        user: parsed.user,
        password: parsed.password,
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
        ssl: parsed.host.includes("localhost")
          ? undefined
          : { rejectUnauthorized: false },
        connectionTimeoutMillis: 8000,
      },
    },
  ];
  if (projectRef || parsed.host.includes("pooler.supabase.com")) {
    for (const region of regions) {
      for (const port of [6543, 5432]) {
        configs.push({
          label: `pooler ${region}:${port} as ${baseUser}`,
          config: {
            user: baseUser,
            password: parsed.password,
            host: `aws-0-${region}.pooler.supabase.com`,
            port,
            database: parsed.database,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 8000,
          },
        });
      }
    }
  }
  return configs;
}

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) {
  console.error(
    "需要 postgres 权限的 DATABASE_URL。\n" +
      "或在 Supabase SQL Editor 执行：\n" +
      `  ${MIGRATION}`,
  );
  process.exit(1);
}

const parsed = parsePgUrl(databaseUrl);
if (parsed.user === "storefront" || parsed.user.startsWith("storefront.")) {
  console.error(
    "当前 DATABASE_URL 是 storefront（无 DDL 权限）。\n" +
      "请改用 postgres Session pooler 连接串后重试，或在 SQL Editor 粘贴迁移文件。",
  );
  process.exit(1);
}

let client = null;
let connectedLabel = "";
for (const c of toPoolerConfigs(parsed)) {
  const tryClient = new pg.Client(c.config);
  try {
    await tryClient.connect();
    client = tryClient;
    connectedLabel = c.label;
    break;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.log("  skip", c.label, "→", msg);
    await tryClient.end().catch(() => {});
  }
}

if (!client) {
  console.error("无法连接数据库。");
  process.exit(1);
}

console.log("Connected via", connectedLabel);
try {
  const sql = fs.readFileSync(path.join(root, MIGRATION), "utf8");
  console.log("→", MIGRATION);
  await client.query(sql);
  const check = await client.query(`
    select
      exists(
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'product_owner_member_label'
      ) as has_fn,
      exists(
        select 1 from pg_trigger
        where tgname = 'orders_set_owner_member_from_product_trg'
      ) as has_trg
  `);
  console.log("Function:", check.rows[0]?.has_fn ? "yes" : "NO");
  console.log("Trigger:", check.rows[0]?.has_trg ? "yes" : "NO");
  console.log("Done.");
} catch (e) {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
