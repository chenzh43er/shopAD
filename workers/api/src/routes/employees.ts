import { Hono } from "hono";
import {
  isUserRole,
  isSuperAdmin as checkSuperAdmin,
  normalizeUserRole,
  type CreateEmployeeInput,
  type Profile,
  type UpdateEmployeeInput,
  type UserRole,
} from "@shopad/shared";
import { createServiceClient } from "../lib/supabase";
import {
  listAllowedRegionIds,
  loadProfileRegionIds,
  parseRegionIdsFromMetadata,
  syncProfileRegions,
} from "../lib/access";
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

function parseRegionIds(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const ids = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return ids;
}

function validateEmployeeRegionIds(
  role: UserRole,
  regionIds: string[] | undefined,
  opts?: { required?: boolean },
): { ok: true } | { ok: false; error: string } {
  if (role === "super_admin") return { ok: true };
  const required = opts?.required ?? false;
  if (required && (!regionIds || regionIds.length === 0)) {
    return { ok: false, error: "员工须至少分配一个地区" };
  }
  return { ok: true };
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
      region_ids: parseRegionIdsFromMetadata(userData.user?.user_metadata),
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
    let regionIds: string[] = [];
    if (!checkSuperAdmin(role)) {
      const allowed = await listAllowedRegionIds(supabase, c);
      regionIds = allowed === "all" ? [] : allowed;
    }
    const payload: Profile = {
      id: profile.id,
      email: c.get("userEmail") || null,
      role,
      display_name: profile.display_name,
      is_active: profile.is_active !== false,
      created_by: profile.created_by ?? null,
      created_at: profile.created_at,
      region_ids: regionIds,
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

  const regionIds = parseRegionIds(body.region_ids);
  if (regionIds === null && body.region_ids !== undefined) {
    return c.json({ error: "地区权限格式无效" }, 400);
  }
  const regionCheck = validateEmployeeRegionIds(role, regionIds ?? undefined, {
    required: true,
  });
  if (!regionCheck.ok) {
    return c.json({ error: regionCheck.error }, 400);
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
        region_ids: role === "employee" ? (regionIds ?? []) : [],
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

  let savedRegionIds: string[] = [];
  if (role === "employee" && regionIds && regionIds.length > 0) {
    const synced = await syncProfileRegions(
      supabase,
      created.user.id,
      regionIds,
      c.get("userId"),
    );
    if (!synced.ok) {
      await supabase.auth.admin.deleteUser(created.user.id);
      return c.json({ error: synced.error }, 400);
    }
    savedRegionIds = regionIds;
  }

  const profile: Profile = {
    id: created.user.id,
    email: created.user.email ?? email,
    role,
    display_name: displayName ?? email.split("@")[0],
    is_active: true,
    created_by: c.get("userId"),
    created_at: new Date().toISOString(),
    region_ids: savedRegionIds,
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

  const parsedRegionIds = parseRegionIds(body.region_ids);
  if (parsedRegionIds === null && body.region_ids !== undefined) {
    return c.json({ error: "地区权限格式无效" }, 400);
  }

  const nextRole =
    (patch.role as UserRole | undefined) ??
    normalizeUserRole(existing.role) ??
    "employee";

  if (parsedRegionIds !== null) {
    const regionCheck = validateEmployeeRegionIds(nextRole, parsedRegionIds, {
      required: nextRole === "employee",
    });
    if (!regionCheck.ok) {
      return c.json({ error: regionCheck.error }, 400);
    }
  } else if (nextRole === "employee") {
    const existingRegions = await loadProfileRegionIds(supabase, [id]);
    const current = existingRegions.get(id) ?? [];
    const regionCheck = validateEmployeeRegionIds(nextRole, current, {
      required: true,
    });
    if (!regionCheck.ok) {
      return c.json({ error: regionCheck.error }, 400);
    }
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

  let savedRegionIds: string[] | undefined;
  if (parsedRegionIds !== null) {
    const toSync = nextRole === "super_admin" ? [] : parsedRegionIds;
    const synced = await syncProfileRegions(
      supabase,
      id,
      toSync,
      c.get("userId"),
    );
    if (!synced.ok) return c.json({ error: synced.error }, 400);
    savedRegionIds = toSync;
  } else if (nextRole === "super_admin") {
    const synced = await syncProfileRegions(supabase, id, [], c.get("userId"));
    if (!synced.ok) return c.json({ error: synced.error }, 400);
    savedRegionIds = [];
  } else {
    savedRegionIds = (await loadProfileRegionIds(supabase, [id])).get(id) ?? [];
  }

  const { data: userData } = await supabase.auth.admin.getUserById(id);
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
    region_ids: savedRegionIds,
  };
  return c.json(profile);
});

employeesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("userId")) {
    return c.json({ error: "不能删除自己的账号" }, 400);
  }

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

  if (normalizeUserRole(existing.role) === "super_admin") {
    const { count, error: countError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");
    if (countError) return c.json({ error: countError.message }, 500);
    if ((count ?? 0) <= 1) {
      return c.json({ error: "不能删除最后一个超级管理员" }, 400);
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});
