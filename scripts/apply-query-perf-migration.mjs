/**
 * 应用查询性能迁移：地区库聚合 RPC + 归属成员去重 RPC + 手机号前缀索引
 *
 * 用法（任选其一）：
 *   1) 在 shopAD/.env 设置 DATABASE_URL（推荐 Session pooler / IPv4）后：
 *        node scripts/apply-query-perf-migration.mjs
 *   2) 或临时：
 *        $env:DATABASE_URL="postgresql://postgres.PROJECT:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
 *        node scripts/apply-query-perf-migration.mjs
 *
 * 说明：直连 db.*.supabase.co 多为 IPv6-only；本脚本会在直连失败时自动改走
 *       aws-0-ap-southeast-1.pooler.supabase.com（IPv4）。
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

function readDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();

  // 兼容 product-2 里被注释掉的 DATABASE_URL
  const candidates = [
    path.resolve(root, ".env"),
    path.resolve(root, "../product-2/.env.local"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const m = text.match(/^[ \t]*#?[ \t]*DATABASE_URL=(.+)$/m);
    if (!m) continue;
    const v = m[1].trim().replace(/^['"]|['"]$/g, "");
    if (v.startsWith("postgres")) return v;
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
  const port = Number(portRaw) || 5432;
  return { user, password, host, port, database: dbName };
}

function toPoolerConfigs(parsed) {
  const projectRef =
    parsed.host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null;
  const baseUser = parsed.user.includes(".")
    ? parsed.user
    : projectRef
      ? `${parsed.user}.${projectRef}`
      : parsed.user;

  const regions = ["ap-southeast-1", "ap-east-1", "ap-northeast-1"];
  const configs = [];

  // 先试原连接（本地 / 已是 pooler）
  configs.push({
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
  });

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

const migrations = [
  "supabase/migrations/20260828020000_address_library_stats.sql",
  "supabase/migrations/20260828030000_orders_phone_prefix_idx.sql",
];

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is required.\n" +
      "Supabase Dashboard → Project Settings → Database → Connect →\n" +
      "  Session pooler（IPv4）URI，写入 shopAD/.env 后重试。\n" +
      "或在 SQL Editor 执行：\n" +
      "  https://supabase.com/dashboard/project/aydrvsuezbgqsfkcyswu/sql/new\n" +
      "粘贴 supabase/migrations/20260828020000_*.sql 与 20260828030000_*.sql",
  );
  process.exit(1);
}

const parsed = parsePgUrl(databaseUrl);
if (parsed.user === "storefront") {
  console.warn(
    "警告：当前 DATABASE_URL 用户是 storefront（落地页只读角色），通常无权限 CREATE FUNCTION/INDEX。\n" +
      "请改用 postgres 的 Session pooler 连接串。",
  );
}

const candidates = toPoolerConfigs(parsed);
let client = null;
let connectedLabel = "";

for (const c of candidates) {
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
  console.error(
    "无法连接数据库。\n" +
      "请到 Supabase → Database → Connect 复制 Session pooler URI（用户应为 postgres.xxx），\n" +
      "写入 shopAD/.env 的 DATABASE_URL=... 后重新运行本脚本。",
  );
  process.exit(1);
}

console.log("Connected via", connectedLabel);

try {
  for (const rel of migrations) {
    const sql = fs.readFileSync(path.join(root, rel), "utf8");
    console.log("→", rel);
    await client.query(sql);
  }

  const check = await client.query(`
  select
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('address_library_stats', 'distinct_order_owner_members')
    ) as fn_count,
    (select count(*) from pg_indexes
     where schemaname = 'public'
       and indexname = 'orders_customer_phone_pattern_idx'
    ) as idx_count
`);
  console.log("Functions installed:", check.rows[0]?.fn_count);
  console.log(
    "Phone prefix index:",
    Number(check.rows[0]?.idx_count) > 0 ? "yes" : "no",
  );
  console.log("Done.");
} catch (e) {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
