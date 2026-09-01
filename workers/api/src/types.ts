import type { UserRole } from "@shopad/shared";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Optional legacy JWT secret; auth now uses supabase.auth.getUser */
  SUPABASE_JWT_SECRET?: string;
  CORS_ORIGINS: string;
  /**
   * 可选 Redis（Upstash）。仅当为 "true" 且配置了 UPSTASH_* 时启用。
   * 设为 "false" 或留空即回退内存缓存 / 直打 DB。
   */
  REDIS_ENABLED?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export type Variables = {
  userId: string;
  userEmail: string;
  userName: string;
  userRole: UserRole;
};
