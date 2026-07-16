import { createMiddleware } from "hono/factory";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "未登录或缺少凭证" }, 401);
  }

  const token = header.slice(7);
  const supabase = createServiceClient(c.env);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return c.json({ error: "无效或过期的登录凭证" }, 401);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return c.json({ error: "无法验证管理员身份" }, 500);
  }

  if (!profile || profile.role !== "admin") {
    return c.json({ error: "需要管理员权限" }, 403);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email ?? "");
  c.set(
    "userName",
    profile.display_name || user.email?.split("@")[0] || user.id,
  );

  await next();
});
