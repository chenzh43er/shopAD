import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../types";

/**
 * PostgREST：带 Prefer count 时，.range(from, to) 的 from 超出结果集
 * （例如筛完/删单后仍停在高页）会报 416 / PGRST103。
 */
export function isPostgrestRangeNotSatisfiable(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST103") return true;
  return /requested range not satisfiable/i.test(error.message ?? "");
}

export function createServiceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createAnonClient(env: Env, accessToken?: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
}
