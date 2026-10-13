import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn(
    "[ShopAD] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy apps/web/.env.example to .env",
  );
}

function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  if (/service_role/i.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

// 浏览器侧只允许 anon / publishable；严禁把 service_role / secret 打进前端包
if (anonKey && looksLikeServiceRoleKey(anonKey)) {
  throw new Error(
    "[ShopAD] VITE_SUPABASE_ANON_KEY looks like a secret/service_role key. Use the anon/publishable key only.",
  );
}

export const supabase = createClient(url ?? "", anonKey ?? "");

export const SUPABASE_CONFIG_ERROR =
  !url || !anonKey
    ? "未配置 Supabase（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 为空）。请复制 apps/web/.env.example 为 apps/web/.env 并填入后重启 vite。"
    : null;

export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return (
    /networkerror when attempting to fetch resource/i.test(msg) ||
    /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(
      msg,
    ) ||
    (e instanceof TypeError && /fetch/i.test(msg))
  );
}

export function friendlyAuthError(e: unknown): string {
  if (SUPABASE_CONFIG_ERROR) return SUPABASE_CONFIG_ERROR;
  if (isNetworkError(e)) {
    return "无法连接 Supabase（NetworkError）。请检查：1) apps/web/.env 的 VITE_SUPABASE_URL 是否正确；2) 本机能否直连该域名（公司 VPN/代理/防火墙常拦截）；3) 是否用了 http 与 https 混用。";
  }
  return e instanceof Error ? e.message : "登录失败";
}
