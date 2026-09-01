/**
 * Redis on/off 对比压测（shopAD Worker）
 * 用法: node scripts/bench-redis-regions.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const apiBase = process.env.API_BASE ?? "http://127.0.0.1:8787";
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS ?? 45000);
const ROUNDS = Number(process.env.ROUNDS ?? 5);

function loadDevVars() {
  const text = readFileSync(resolve(root, "workers/api/.dev.vars"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${apiBase}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error("API health timeout");
}

async function fetchTimed(url, headers) {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
  });
  const body = await res.text();
  const ms = performance.now() - t0;
  return { res, body, ms };
}

async function timeRequest(url, headers, n = ROUNDS) {
  const times = [];
  for (let i = 0; i < n; i++) {
    process.stdout.write(`  req ${i + 1}/${n}... `);
    try {
      const { res, body, ms } = await fetchTimed(url, headers);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 240)}`);
      }
      console.log(`${ms.toFixed(0)}ms (${body.length} bytes)`);
      times.push(ms);
    } catch (e) {
      console.log(`FAIL ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  }
  return times;
}

function summarize(label, times) {
  const cold = times[0];
  const hot = times.slice(1);
  const hotAvg = hot.reduce((a, b) => a + b, 0) / Math.max(1, hot.length);
  const hotMin = Math.min(...hot);
  console.log(
    `${label}: cold=${cold.toFixed(0)}ms | hot avg=${hotAvg.toFixed(0)}ms min=${hotMin.toFixed(0)}ms`,
  );
  return { cold, hotAvg, hotMin, times };
}

async function main() {
  const env = loadDevVars();
  if (!env.SUPABASE_URL) throw new Error("missing SUPABASE_URL in .dev.vars");

  const email = process.env.ADMIN_EMAIL ?? "admin@shopad.local";
  const password = process.env.ADMIN_PASSWORD ?? "Admin@888897";

  console.log("Waiting for API...");
  const health = await waitHealth();
  console.log("health:", health);

  console.log("Signing in as", email);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (authErr || !auth.session) {
    throw new Error(`登录失败: ${authErr?.message ?? "no session"}`);
  }
  const token = auth.session.access_token;
  const headers = { Authorization: `Bearer ${token}` };
  console.log("auth ok");

  // 快速探活鉴权
  {
    const { res, body, ms } = await fetchTimed(`${apiBase}/api/me`, headers);
    console.log(`/api/me => ${res.status} ${ms.toFixed(0)}ms ${body.slice(0, 80)}`);
    if (!res.ok) throw new Error("staff auth failed via /api/me");
  }

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: libs, error: libErr } = await admin
    .from("address_libraries")
    .select("id, name");
  if (libErr) throw new Error(libErr.message);
  if (!libs?.length) throw new Error("没有地址库");

  let best = null;
  for (const lib of libs) {
    const { count, error } = await admin
      .from("address_regions")
      .select("id", { count: "exact", head: true })
      .eq("library_id", lib.id);
    if (error) throw new Error(error.message);
    const n = count ?? 0;
    if (!best || n > best.count) best = { ...lib, count: n };
  }
  console.log(
    `bench library: ${best.name} (${best.id}) regions=${best.count}`,
  );

  const url = `${apiBase}/api/address-libraries/${best.id}/regions?page=1&pageSize=50`;
  const productsUrl = `${apiBase}/api/products?page=1&pageSize=20`;

  console.log("\n=== regions ===");
  const regions = summarize("regions", await timeRequest(url, headers));

  console.log("\n=== products ===");
  const products = summarize(
    "products",
    await timeRequest(productsUrl, headers),
  );

  const out = {
    redis: health.redis,
    library: best,
    regions,
    products,
  };
  console.log("\nJSON_RESULT " + JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
