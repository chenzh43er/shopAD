/**
 * 自动对比 Redis on / off（会改 .dev.vars、重启 Worker、压测、恢复 on）
 * 用法: node scripts/bench-redis-ab.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const apiDir = resolve(root, "workers/api");
const requireFromApi = createRequire(resolve(apiDir, "package.json"));
const { Redis } = requireFromApi("@upstash/redis");
const devVarsPath = resolve(apiDir, ".dev.vars");
const apiBase = process.env.API_BASE ?? "http://127.0.0.1:8787";
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS ?? 120000);

function loadDevVars(text = readFileSync(devVarsPath, "utf8")) {
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

function setRedisEnabled(enabled) {
  let text = readFileSync(devVarsPath, "utf8");
  if (/^REDIS_ENABLED=/m.test(text)) {
    text = text.replace(
      /^REDIS_ENABLED=.*$/m,
      `REDIS_ENABLED=${enabled ? "true" : "false"}`,
    );
  } else {
    text += `\nREDIS_ENABLED=${enabled ? "true" : "false"}\n`;
  }
  writeFileSync(devVarsPath, text, "utf8");
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function killPort(port) {
  // Windows
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync(`netstat -ano | findstr :${port}`, {
      encoding: "utf8",
    });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* nothing listening */
  }
  await sleep(800);
}

function startWorker() {
  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--filter", "@shopad/api", "dev"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: true,
    },
  );
  let buf = "";
  const onData = (chunk) => {
    buf += chunk.toString();
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return { child, getLog: () => buf };
}

async function waitHealth(wantRedis, maxMs = 90000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${apiBase}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        last = await res.json();
        if (!wantRedis || last.redis === wantRedis) return last;
      }
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error(
    `health timeout want=${wantRedis} last=${JSON.stringify(last)}`,
  );
}

async function flushShopadRedis(env) {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  // 简单：扫常见前缀键（Upstash 支持 keys，数据量小可接受）
  const keys = await redis.keys("shopad:*");
  if (keys.length) {
    await redis.del(...keys);
  }
  console.log(`flushed redis keys: ${keys.length}`);
}

async function fetchTimed(url, headers) {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
  });
  const body = await res.text();
  return { res, body, ms: performance.now() - t0 };
}

async function timeRequest(label, url, headers, n = ROUNDS) {
  const times = [];
  console.log(`\n=== ${label} ===`);
  for (let i = 0; i < n; i++) {
    process.stdout.write(`  req ${i + 1}/${n}... `);
    const { res, body, ms } = await fetchTimed(url, headers);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    console.log(`${ms.toFixed(0)}ms`);
    times.push(ms);
  }
  const cold = times[0];
  const hot = times.slice(1);
  const hotAvg = hot.reduce((a, b) => a + b, 0) / Math.max(1, hot.length);
  const hotMin = Math.min(...hot);
  console.log(
    `${label}: cold=${cold.toFixed(0)}ms hotAvg=${hotAvg.toFixed(0)}ms hotMin=${hotMin.toFixed(0)}ms`,
  );
  return { cold, hotAvg, hotMin, times };
}

async function runMode(mode, urls, headers, env) {
  console.log(`\n######## MODE redis=${mode} ########`);
  setRedisEnabled(mode === "on");
  await killPort(8787);
  const { child, getLog } = startWorker();
  try {
    const health = await waitHealth(mode);
    console.log("health:", health);
    if (mode === "on") {
      await flushShopadRedis(env);
    }
    // 先预热 auth，避免 regions/products 第一次被鉴权拖累
    await timeRequest("me", urls.me, headers, 3);
    const regions = await timeRequest("regions", urls.regions, headers);
    const products = await timeRequest("products", urls.products, headers);
    const me = await timeRequest("me-hot", urls.me, headers);
    return { health, regions, products, me };
  } catch (e) {
    console.error("worker log tail:\n", getLog().slice(-2000));
    throw e;
  } finally {
    child.kill("SIGTERM");
    await killPort(8787);
  }
}

async function main() {
  const env = loadDevVars();
  if (!env.SUPABASE_URL) throw new Error("missing SUPABASE_URL");

  const email = process.env.ADMIN_EMAIL ?? "admin@shopad.local";
  const password = process.env.ADMIN_PASSWORD ?? "Admin@888897";

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
  const headers = { Authorization: `Bearer ${auth.session.access_token}` };

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: libs, error: libErr } = await admin
    .from("address_libraries")
    .select("id, name");
  if (libErr) throw new Error(libErr.message);

  let best = null;
  for (const lib of libs ?? []) {
    const { count, error } = await admin
      .from("address_regions")
      .select("id", { count: "exact", head: true })
      .eq("library_id", lib.id);
    if (error) throw new Error(error.message);
    const n = count ?? 0;
    if (!best || n > best.count) best = { ...lib, count: n };
  }
  if (!best) throw new Error("无地址库");
  console.log(`library: ${best.name} regions=${best.count} id=${best.id}`);

  const urls = {
    regions: `${apiBase}/api/address-libraries/${best.id}/regions?page=1&pageSize=50`,
    products: `${apiBase}/api/products?page=1&pageSize=20`,
    me: `${apiBase}/api/me`,
  };

  // 先 off 再 on，最后恢复 on
  const off = await runMode("off", urls, headers, env);
  const on = await runMode("on", urls, headers, env);
  setRedisEnabled(true);

  const summary = {
    library: best,
    note: "regions 已禁用 Redis 大缓存；对比鉴权/权限小 key",
    off,
    on,
    delta: {
      regionsHotAvgMs: +(on.regions.hotAvg - off.regions.hotAvg).toFixed(0),
      productsHotAvgMs: +(on.products.hotAvg - off.products.hotAvg).toFixed(0),
      meHotAvgMs: +(on.me.hotAvg - off.me.hotAvg).toFixed(0),
    },
  };

  console.log("\n======== VERDICT ========");
  console.log(
    `regions hotAvg: off ${off.regions.hotAvg.toFixed(0)}ms → on ${on.regions.hotAvg.toFixed(0)}ms (Δ ${summary.delta.regionsHotAvgMs}ms)`,
  );
  console.log(
    `products hotAvg: off ${off.products.hotAvg.toFixed(0)}ms → on ${on.products.hotAvg.toFixed(0)}ms (Δ ${summary.delta.productsHotAvgMs}ms)`,
  );
  console.log(
    `me hotAvg: off ${off.me.hotAvg.toFixed(0)}ms → on ${on.me.hotAvg.toFixed(0)}ms (Δ ${summary.delta.meHotAvgMs}ms)`,
  );

  const smallDelta = Math.min(
    summary.delta.productsHotAvgMs,
    summary.delta.meHotAvgMs,
  );
  const regionsOk = Math.abs(summary.delta.regionsHotAvgMs) < 200;
  let verdict;
  if (!regionsOk && summary.delta.regionsHotAvgMs > 200) {
    verdict = "地区树仍被 Redis 拖慢（检查是否未关掉大缓存）";
  } else if (smallDelta < -30) {
    verdict = "小 key 缓存有收益；地区树与 off 接近，可保持 Redis ON";
  } else if (smallDelta > 80) {
    verdict = "小 key 也变慢（本机→SG RTT）；生产边缘节点可能更好，本地可先 OFF";
  } else {
    verdict =
      "本地差异不明显；Redis ON 可留作多 isolate 限流/鉴权共享，地区树未走 Redis";
  }
  console.log("判断:", verdict);
  console.log("\nJSON_RESULT " + JSON.stringify(summary));
}

main().catch((e) => {
  console.error(e);
  setRedisEnabled(true);
  process.exit(1);
});
