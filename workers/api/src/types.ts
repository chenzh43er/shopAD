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
  /**
   * CF R2（S3 兼容）。配齐后商品图直传 R2（ID 模式）；
   * 未配则回退 Supabase Storage。密钥走 wrangler secret / .dev.vars。
   */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  /** R2 公开基地址：已 proxied 的自定义域，如 https://static.quan2go.com（勿用 r2.dev） */
  R2_PUBLIC_BASE_URL?: string;
}

export type Variables = {
  userId: string;
  userEmail: string;
  userName: string;
  userRole: UserRole;
};
