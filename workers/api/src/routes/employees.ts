import { Hono } from "hono";
import {
  isUserRole,
  normalizeUserRole,
  type CreateEmployeeInput,
  type Profile,
  type UpdateEmployeeInput,
  type UserRole,
} from "@shopad/shared";
import { createServiceClient } from "../lib/supabase";
import { requireSuperAdmin } from "../middleware/auth";
import type { Env, Variables } from "../types";

type ServiceClient = ReturnType<typeof createServiceClient>;

type ProfileRow = {
  id: string;
  role: string;
  display_name: string | null;
  is_active?: boolean | null;
  created_by?: string | null;
  created_at: string;
};

function trimDisplayName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function isMissingColumnError(message: string): boolean {
  return /is_active|created_by|schema cache|column/i.test(message);
}

async function fetchProfileRow(
  supabase: ServiceClient,
  userId: string,
): Promise<ProfileRow | null> {
  const full = await supabase
    .from("profiles")
    .select("id, role, display_name, is_active, created_by, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (!full.error) return full.data;

  if (isMissingColumnError(full.error.message)) {
    const basic = await supabase
      .from("profiles")
      .select("id, role, display_name, created_at")
      .eq("id", userId)
      .maybeSingle();
    if (basic.error) throw new Error(basic.error.message);
    return basic.data
      ? { ...basic.data, is_active: true, created_by: null }
      : null;
  }

  throw new Error(full.error.message);
}

async function updateProfileCompat(
  supabase: ServiceClient,
  userId: string,
  fields: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const full = await supabase.from("profiles").update(fields).eq("id", userId);
  if (!full.error) return { error: null };

  if (!isMissingColumnError(full.error.message)) {
    return { error: full.error.message };
  }

  const basicFields = { ...fields };
  delete basicFields.is_active;
  delete basicFields.created_by;

  if (Object.keys(basicFields).length === 0) {
    // 仅更新扩展列且库未迁移：忽略，不阻断创建
    return { error: null };
  }

  const basic = await supabase
    .from("profiles")
    .update(basicFields)
    .eq("id", userId);

  if (!basic.error) return { error: null };

  // role 约束仍是旧的 admin-only 时，给出明确提示
  if (/profiles_role_check|check constraint|role/i.test(basic.error.message)) {
    return {
      error:
        "数据库角色约束未更新。请先在 Supabase 执行迁移 20260724010000_roles_and_employees.sql",
    };
  }

  return { error: basic.error.message };
}

async function loadProfilesWithEmail(
  supabase: ServiceClient,
): Promise<Profile[]> {
  let list: ProfileRow[] = [];

  const full = await supabase
    .from("profiles")
    .select("id, role, display_name, is_active, created_by, created_at")
    .order("created_at", { ascending: true });

  if (full.error && isMissingColumnError(full.error.message)) {
    const basic = await supabase
      .from("profiles")
      .select("id, role, display_name, created_at")
      .order("created_at", { ascending: true });
    if (basic.error) throw new Error(basic.error.message);
    list = (basic.data ?? []).map((row) => ({
      ...row,
      is_active: true,
      created_by: null,
    }));
  } else if (full.error) {
    throw new Error(full.error.message);
  } else {
    list = full.data ?? [];
  }

  const result: Profile[] = [];

  for (const row of list) {
    const role = normalizeUserRole(row.role);
    if (!role) continue;
    const { data: userData } = await supabase.auth.admin.getUserById(row.id);
    result.push({
      id: row.id,
      email: userData.user?.email ?? null,
      role,
      display_name: row.display_name,
      is_active: row.is_active !== false,
      created_by: row.created_by ?? null,
      created_at: row.created_at,
    });
  }

  return result;
}

export const meRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

meRoutes.get("/", async (c) => {
  const supabase = createServiceClient(c.env);
  try {
    const profile = await fetchProfileRow(supabase, c.get("userId"));
    if (!profile) return c.json({ error: "账号资料不存在" }, 404);

    const role = normalizeUserRole(profile.role) ?? c.get("userRole");
    const payload: Profile = {
      id: profile.id,
      email: c.get("userEmail") || null,
      role,
      display_name: profile.display_name,
      is_active: profile.is_active !== false,
      created_by: profile.created_by ?? null,
      created_at: profile.created_at,
    };
    return c.json(payload);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "加载账号资料失败" },
      500,
    );
  }
});

export const employeesRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

employeesRoutes.use("*", requireSuperAdmin);

employeesRoutes.get("/", async (c) => {
  const supabase = createServiceClient(c.env);
  try {
    const data = await loadProfilesWithEmail(supabase);
    return c.json({ data, total: data.length });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "加载员工失败" },
      500,
    );
  }
});

employeesRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as CreateEmployeeInput;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = trimDisplayName(body.display_name);
  const role: UserRole =
    body.role && isUserRole(body.role) ? body.role : "employee";

  if (!email || !email.includes("@")) {
    return c.json({ error: "请填写有效邮箱" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "密码至少 6 位" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName ?? email.split("@")[0],
        role,
      },
    });

  if (createError || !created.user) {
    return c.json(
      { error: createError?.message || "创建账号失败" },
      400,
    );
  }

  const { error: profileError } = await updateProfileCompat(
    supabase,
    created.user.id,
    {
      role,
      display_name: displayName ?? email.split("@")[0],
      is_active: true,
      created_by: c.get("userId"),
    },
  );

  if (profileError) {
    // 尽量回滚刚创建的 auth 用户，避免留下半成品账号
    await supabase.auth.admin.deleteUser(created.user.id);
    return c.json({ error: profileError }, 500);
  }

  const profile: Profile = {
    id: created.user.id,
    email: created.user.email ?? email,
    role,
    display_name: displayName ?? email.split("@")[0],
    is_active: true,
    created_by: c.get("userId"),
    created_at: new Date().toISOString(),
  };
  return c.json(profile, 201);
});

employeesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as UpdateEmployeeInput;
  const supabase = createServiceClient(c.env);

  let existing: ProfileRow | null;
  try {
    existing = await fetchProfileRow(supabase, id);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "加载员工失败" },
      500,
    );
  }
  if (!existing) return c.json({ error: "员工不存在" }, 404);

  if (id === c.get("userId") && body.is_active === false) {
    return c.json({ error: "不能停用自己的账号" }, 400);
  }
  if (id === c.get("userId") && body.role === "employee") {
    return c.json({ error: "不能降低自己的权限" }, 400);
  }

  const patch: Record<string, unknown> = {};
  if (body.display_name !== undefined) {
    patch.display_name = trimDisplayName(body.display_name);
  }
  if (body.role !== undefined) {
    if (!isUserRole(body.role)) {
      return c.json({ error: "角色无效" }, 400);
    }
    patch.role = body.role;
  }
  if (body.is_active !== undefined) {
    patch.is_active = Boolean(body.is_active);
  }

  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await updateProfileCompat(
      supabase,
      id,
      patch,
    );
    if (updateError) return c.json({ error: updateError }, 500);
  }

  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 6) {
      return c.json({ error: "密码至少 6 位" }, 400);
    }
    const { error: pwdError } = await supabase.auth.admin.updateUserById(id, {
      password: body.password,
    });
    if (pwdError) return c.json({ error: pwdError.message }, 400);
  }

  const { data: userData } = await supabase.auth.admin.getUserById(id);
  const nextRole =
    (patch.role as UserRole | undefined) ??
    normalizeUserRole(existing.role) ??
    "employee";
  const profile: Profile = {
    id,
    email: userData.user?.email ?? null,
    role: nextRole,
    display_name:
      body.display_name !== undefined
        ? trimDisplayName(body.display_name)
        : existing.display_name,
    is_active:
      body.is_active !== undefined
        ? Boolean(body.is_active)
        : existing.is_active !== false,
    created_by: existing.created_by ?? null,
    created_at: existing.created_at,
  };
  return c.json(profile);
});
