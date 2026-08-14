/** Isolate 内简易限流（多 isolate 不共享；仍能挡住单节点暴力扫库） */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; remaining: 0; resetAt: number; retryAfterSec: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    if (buckets.size >= MAX_KEYS) {
      // 简单淘汰：删掉已过期或最早一条，避免 Map 无限涨
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

export function clientIp(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return "unknown";
}
