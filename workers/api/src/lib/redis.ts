import { Redis } from "@upstash/redis";

import type { Env } from "../types";

/**
 * Upstash Redis 可选缓存层。
 * 关闭方式：REDIS_ENABLED=false（或未设置），或去掉 UPSTASH_* 凭证。
 * Redis 故障时各调用方应回退内存 / 直打 DB，不阻断主流程。
 */
export function isRedisEnabled(env: Env): boolean {
  const flag = String(env.REDIS_ENABLED ?? "")
    .trim()
    .toLowerCase();
  return (
    (flag === "true" || flag === "1" || flag === "on") &&
    Boolean(env.UPSTASH_REDIS_REST_URL?.trim()) &&
    Boolean(env.UPSTASH_REDIS_REST_TOKEN?.trim())
  );
}

export function getRedis(env: Env): Redis | null {
  if (!isRedisEnabled(env)) return null;
  try {
    return new Redis({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!,
    });
  } catch (e) {
    console.error("[redis] client init failed:", e);
    return null;
  }
}

export async function cacheGetJson<T>(
  env: Env,
  key: string,
): Promise<T | null> {
  const redis = getRedis(env);
  if (!redis) return null;
  try {
    const value = await redis.get<T>(key);
    return value ?? null;
  } catch (e) {
    console.error("[redis] get failed:", key, e);
    return null;
  }
}

export async function cacheSetJson(
  env: Env,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<boolean> {
  const redis = getRedis(env);
  if (!redis) return false;
  try {
    await redis.set(key, value, { ex: Math.max(1, Math.floor(ttlSeconds)) });
    return true;
  } catch (e) {
    console.error("[redis] set failed:", key, e);
    return false;
  }
}

export async function cacheDel(env: Env, ...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const redis = getRedis(env);
  if (!redis) return;
  try {
    await redis.del(...keys);
  } catch (e) {
    console.error("[redis] del failed:", keys, e);
  }
}

/** 滑动窗口计数：INCR + 首次 PEXPIRE；失败返回 null（调用方回退内存） */
export async function redisIncrWindow(
  env: Env,
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number } | null> {
  const redis = getRedis(env);
  if (!redis) return null;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }
    let ttlMs = await redis.pttl(key);
    if (ttlMs < 0) {
      await redis.pexpire(key, windowMs);
      ttlMs = windowMs;
    }
    return { count, ttlMs };
  } catch (e) {
    console.error("[redis] incr window failed:", key, e);
    return null;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const RedisKeys = {
  auth: (tokenHash: string) => `shopad:auth:${tokenHash}`,
  scopeRegions: (userId: string) => `shopad:scope:regions:${userId}`,
  scopeProducts: (userId: string) => `shopad:scope:products:${userId}`,
  regionsRaw: (libraryId: string) => `shopad:regions:raw:${libraryId}`,
  rateLimit: (key: string) => `shopad:rl:${key}`,
} as const;
