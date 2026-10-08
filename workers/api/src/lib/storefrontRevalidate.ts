import type { Env } from "../types";

function normalizeBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function parseConfiguredBases(env: Env): string[] {
  const raw = env.STOREFRONT_REVALIDATE_URLS?.trim();
  if (!raw) return [];
  const bases: string[] = [];
  for (const part of raw.split(",")) {
    const base = normalizeBaseUrl(part);
    if (base) bases.push(base);
  }
  return [...new Set(bases)];
}

function basesFromHosts(
  hosts: Array<string | null | undefined> | undefined,
): string[] {
  if (!hosts?.length) return [];
  const bases: string[] = [];
  for (const host of hosts) {
    if (!host?.trim()) continue;
    const base = normalizeBaseUrl(host);
    if (base) bases.push(base);
  }
  return [...new Set(bases)];
}

function normalizeSuffixes(
  linkSuffixes: Array<string | null | undefined>,
): string[] {
  return [
    ...new Set(
      linkSuffixes
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

/**
 * 后台改商品后，通知落地页 Next.js 失效 ISR / tag 缓存。
 * 未配置 SECRET 时静默跳过；失败只打日志，不影响后台保存。
 */
export async function notifyStorefrontRevalidate(
  env: Env,
  opts: {
    linkSuffixes: Array<string | null | undefined>;
    /** 商品绑定域名 host；未配 STOREFRONT_REVALIDATE_URLS 时用 https://{host} */
    hosts?: Array<string | null | undefined>;
  },
): Promise<void> {
  const secret = env.STOREFRONT_REVALIDATE_SECRET?.trim();
  if (!secret) return;

  const suffixes = normalizeSuffixes(opts.linkSuffixes);
  if (suffixes.length === 0) return;

  const bases = [
    ...parseConfiguredBases(env),
    ...basesFromHosts(opts.hosts),
  ];
  const uniqueBases = [...new Set(bases)];
  if (uniqueBases.length === 0) {
    console.warn(
      "storefront revalidate skipped: set STOREFRONT_REVALIDATE_URLS or product domain host",
    );
    return;
  }

  await Promise.all(
    uniqueBases.flatMap((base) =>
      suffixes.map(async (linkSuffix) => {
        try {
          const res = await fetch(`${base}/api/revalidate`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-revalidate-secret": secret,
            },
            body: JSON.stringify({ linkSuffix }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.warn(
              `storefront revalidate ${base} ${linkSuffix}: ${res.status} ${text.slice(0, 200)}`,
            );
          }
        } catch (e) {
          console.warn(
            `storefront revalidate ${base} ${linkSuffix} failed:`,
            e instanceof Error ? e.message : e,
          );
        }
      }),
    ),
  );
}

/** 在 Worker 请求生命周期内尽量跑完；失败忽略 */
export function scheduleStorefrontRevalidate(
  c: {
    env: Env;
    executionCtx?: { waitUntil: (promise: Promise<unknown>) => void };
  },
  opts: {
    linkSuffixes: Array<string | null | undefined>;
    hosts?: Array<string | null | undefined>;
  },
): void {
  const task = notifyStorefrontRevalidate(c.env, opts);
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(task);
  } else {
    void task;
  }
}

export function hostFromProductDomain(
  domain: unknown,
): string | null {
  if (!domain || typeof domain !== "object") return null;
  const host = (domain as { host?: unknown }).host;
  return typeof host === "string" && host.trim() ? host.trim() : null;
}
