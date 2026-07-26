import { supabase } from "./supabase";

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

  const res = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    headers,
  });

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
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
