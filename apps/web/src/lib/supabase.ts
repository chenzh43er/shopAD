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
