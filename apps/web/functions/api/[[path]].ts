/**
 * 将 /api/* 同源代理到 Worker。
 * 浏览器只访问 Pages 域名（shopad.pages.dev / acomedia.work），避免国内直连 *.workers.dev 超时。
 */
const DEFAULT_UPSTREAM = "https://shopad-api.ubeator.workers.dev";

const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

const STRIP_REQUEST_HEADERS = [
  "cookie",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-for",
  "x-real-ip",
];

export async function onRequest(context: {
  request: Request;
  env: { API_UPSTREAM?: string };
}): Promise<Response> {
  const method = context.request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const upstream = (context.env.API_UPSTREAM || DEFAULT_UPSTREAM).replace(
    /\/$/,
    "",
  );
  const incoming = new URL(context.request.url);
  const targetUrl = `${upstream}${incoming.pathname}${incoming.search}`;

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  for (const name of STRIP_REQUEST_HEADERS) {
    headers.delete(name);
  }
  headers.set("X-Forwarded-Host", incoming.host);
  headers.set("X-Forwarded-Proto", incoming.protocol.replace(":", ""));
  // 保留真实客户端 IP 供上游限流（仅信任 Cloudflare 注入）
  const cfIp = context.request.headers.get("cf-connecting-ip");
  if (cfIp) headers.set("cf-connecting-ip", cfIp);

  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = context.request.body;
  }

  const upstreamRes = await fetch(targetUrl, init);

  // 同源代理：去掉上游 CORS 头，避免干扰浏览器同源策略
  const outHeaders = new Headers(upstreamRes.headers);
  outHeaders.delete("access-control-allow-origin");
  outHeaders.delete("access-control-allow-credentials");
  outHeaders.delete("access-control-allow-headers");
  outHeaders.delete("access-control-allow-methods");
  outHeaders.delete("access-control-max-age");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders,
  });
}
