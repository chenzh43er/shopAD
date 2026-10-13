import { supabase, isNetworkError } from "./supabase";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let cachedAccessToken: string | null | undefined;
let tokenListenerBound = false;

function ensureTokenListener() {
  if (tokenListenerBound) return;
  tokenListenerBound = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedAccessToken = session?.access_token ?? null;
  });
}

async function getAccessToken(): Promise<string | null> {
  ensureTokenListener();
  // 仅信任非空缓存；null 必须重读，否则刚 login 时 onAuthStateChange 尚未写入，
  // 会带着空 Authorization 打 /api/me → 401「未登录或缺少凭证」并被 AuthContext 清会话。
  if (cachedAccessToken) return cachedAccessToken;
  const { data } = await supabase.auth.getSession();
  cachedAccessToken = data.session?.access_token ?? null;
  return cachedAccessToken;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, ...requestInit } = init;
  const token = accessToken ?? (await getAccessToken());
  if (accessToken) {
    cachedAccessToken = accessToken;
  }
  const headers = new Headers(requestInit.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (
    requestInit.body &&
    !(requestInit.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      headers,
    });
  } catch (e) {
    // fetch 本身抛错（DNS/拒绝连接/CORS/离线）：Firefox 报 "NetworkError when attempting to fetch resource"
    if (isNetworkError(e)) {
      throw new ApiError(
        API_BASE
          ? `连不上 API（${API_BASE}${path}）。请确认 Worker 地址可访问、CORS 白名单包含当前域名。`
          : "连不上本地 API。请先开 `pnpm dev:api`（wrangler :8788）再开前端；保持 VITE_API_BASE_URL 为空走 Vite 代理。浏览器 Network 面板看 /api/me 是否 pending/failed 可确认。",
        0,
      );
    }
    throw e;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const looksLikeHtml =
    /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text);

  // 同源 /api 未打到 Worker 时会变成 HTML（本地常见：未 pnpm dev:api，或代理端口被其他项目占用）
  if (looksLikeHtml || (text && !contentType.includes("application/json"))) {
    throw new ApiError(
      API_BASE
        ? `API 返回了非 JSON 响应（${res.status}）。请检查 Worker 是否正常。`
        : looksLikeHtml
          ? "API 返回了 HTML 而非 JSON。本地请先 pnpm dev:api（:8788）再开前端；生产请确认 Pages Functions 已部署。勿把 VITE_API_BASE_URL 设为 *.workers.dev。"
          : `API 返回了非 JSON 响应（${res.status}）。请确认本地 API（:8788）或生产 /api 代理正常。`,
      res.status === 200 ? 502 : res.status,
    );
  }

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(`API 响应无法解析为 JSON（${res.status}）`, res.status);
    }
  }

  if (!res.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `请求失败 (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return payload as T;
}
