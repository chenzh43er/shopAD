import type { Env } from "../types";

export function isR2Configured(env: Env): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET &&
      env.R2_PUBLIC_BASE_URL,
  );
}

export function r2PublicUrl(env: Env, key: string): string {
  const base = (env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/${key.replace(/^\/+/, "")}`;
}

/** Supabase 老 URL → R2 镜像 key（与 product-1 迁移脚本 / toR2MirrorUrl 同规则） */
export function r2MirrorKeyFromSupabaseUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(".supabase.co")) return null;
    const marker = "/storage/v1/object/public/";
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    const objectPath = u.pathname.slice(idx + marker.length).replace(/^\/+/, "");
    if (!objectPath) return null;
    return `supabase-mirror/${objectPath.split("?")[0]}`;
  } catch {
    return null;
  }
}

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as ArrayBuffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: ArrayBuffer,
  data: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

/**
 * S3 兼容 PUT（R2），Workers 内无 SDK 时用 SigV4 直调。
 * 返回公开 URL（R2_PUBLIC_BASE_URL 自定义 proxied 域）。
 */
export async function r2PutObject(
  env: Env,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ path: string; url: string }> {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";

  const payloadHash = await sha256Hex(body);
  const canonicalUri = `/${env.R2_BUCKET}/${key
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders =
    "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const enc = new TextEncoder();
  const kDate = await hmacSha256(
    enc.encode(`AWS4${env.R2_SECRET_ACCESS_KEY}`).buffer as ArrayBuffer,
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signingKey = await crypto.subtle.importKey(
    "raw",
    kSigning,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    enc.encode(stringToSign),
  );
  const signature = [...new Uint8Array(signatureBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Cache-Control": "public, max-age=31536000, immutable",
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return { path: key, url: r2PublicUrl(env, key) };
}
