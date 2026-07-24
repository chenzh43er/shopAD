import { createMiddleware } from "hono/factory";
import { normalizeUserRole, type UserRole } from "@shopad/shared";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

type ProfileRow = {
  id: string;
  role: string;
  display_name: string | null;
  is_active?: boolean | null;
};

/** Authenticated staff: super_admin or employee */
export const requireStaff = createMiddleware<{
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

  // 先查基础字段（兼容尚未跑角色迁移的库）；再尽量带上 is_active
  let profile: ProfileRow | null = null;
  let profileError: { message: string } | null = null;

  {
    const withActive = await supabase
      .from("profiles")
      .select("id, role, display_name, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (
      withActive.error &&
      /is_active|column/i.test(withActive.error.message)
    ) {
      const fallback = await supabase
        .from("profiles")
        .select("id, role, display_name")
        .eq("id", user.id)
        .maybeSingle();
      profile = fallback.data;
      profileError = fallback.error;
    } else {
      profile = withActive.data;
      profileError = withActive.error;
    }
  }

  if (profileError) {
    console.error("profiles lookup failed:", profileError.message);
    return c.json(
      { error: `无法验证登录身份：${profileError.message}` },
      500,
    );
  }

  const role = normalizeUserRole(profile?.role);
  if (!profile || !role) {
    return c.json(
      {
        error:
          "账号未授权访问后台（请确认已执行角色迁移，并将 profiles.role 设为 super_admin 或 employee）",
      },
      403,
    );
  }

  if (profile.is_active === false) {
    return c.json({ error: "账号已停用，请联系超级管理员" }, 403);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email ?? "");
  c.set(
    "userName",
    profile.display_name || user.email?.split("@")[0] || user.id,
  );
  c.set("userRole", role as UserRole);

  await next();
});

/** Super admin only (employee management + global settings writes) */
export const requireSuperAdmin = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  if (c.get("userRole") !== "super_admin") {
    return c.json({ error: "需要超级管理员权限" }, 403);
  }
  await next();
});

/** @deprecated Use requireStaff — kept as alias for gradual rename */
export const requireAdmin = requireStaff;
