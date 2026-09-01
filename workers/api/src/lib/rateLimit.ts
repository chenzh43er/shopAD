import type { Env } from "../types";
import { RedisKeys, redisIncrWindow } from "./redis";

/** Isolate 内简易限流；Redis 开启时跨 isolate 共享 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; remaining: 0; resetAt: number; retryAfterSec: number };

function rateLimitMemory(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    if (buckets.size >= MAX_KEYS) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
        if (buckets.size < MAX_KEYS) break;
      }
      if (buckets.size >= MAX_KEYS) {
        const first = buckets.keys().next().value;
        if (first !== undefined) buckets.delete(first);
      }
    }
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redisKey = RedisKeys.rateLimit(key);
  const remote = await redisIncrWindow(env, redisKey, windowMs);
  if (!remote) {
    return rateLimitMemory(key, limit, windowMs);
  }

  const now = Date.now();
  const resetAt = now + Math.max(1, remote.ttlMs);
  if (remote.count > limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt,
      retryAfterSec: Math.max(1, Math.ceil(remote.ttlMs / 1000)),
    };
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - remote.count),
    resetAt,
  };
}

export function clientIp(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return "unknown";
}
