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
  /**
   * 落地页缓存失效密钥（须与 product-1/2 的 REVALIDATE_SECRET 一致）
   */
  STOREFRONT_REVALIDATE_SECRET?: string;
  /**
   * 落地页根地址，逗号分隔，如 https://a.example.com,https://b.example.com
   * 未配时回退商品绑定域名 host
   */
  STOREFRONT_REVALIDATE_URLS?: string;
}

export type Variables = {
  userId: string;
  userEmail: string;
  userName: string;
  userRole: UserRole;
};
