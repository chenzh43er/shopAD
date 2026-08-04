import { Hono } from "hono";
import type { UpsertDomainInput } from "@shopad/shared";
import { createServiceClient } from "../lib/supabase";
import { requireSuperAdmin } from "../middleware/auth";
import type { Env, Variables } from "../types";

/** 规范化主机名：去协议、路径、端口空白，转小写 */
function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "");
  host = host.split("/")[0] ?? host;
  host = host.split("?")[0] ?? host;
  host = host.replace(/:\d+$/, "");
  host = host.replace(/\.$/, "");
  return host;
}

function isValidHost(host: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
    host,
  );
}

function parseDomainBody(
  body: UpsertDomainInput,
  partial = false,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const data: Record<string, unknown> = {};

  if (!partial || body.host !== undefined) {
    if (typeof body.host !== "string" || !body.host.trim()) {
      return { ok: false, error: "域名不能为空" };
    }
    const host = normalizeHost(body.host);
    if (!isValidHost(host)) {
      return {
        ok: false,
        error: "域名格式无效，请填写如 shop.example.com",
      };
    }
    data.host = host;
  }

  if (!partial || body.name !== undefined) {
    if (body.name === undefined || body.name === null) {
      if (!partial) data.name = "";
    } else if (typeof body.name !== "string") {
      return { ok: false, error: "显示名称无效" };
    } else {
      data.name = body.name.trim();
    }
  }

  if (body.remark !== undefined) {
    if (body.remark === null || body.remark === "") {
      data.remark = null;
    } else if (typeof body.remark !== "string") {
      return { ok: false, error: "备注无效" };
    } else {
      data.remark = body.remark.trim() || null;
    }
  }

  if (body.enabled !== undefined) {
    data.enabled = Boolean(body.enabled);
  }
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== "number" || !Number.isFinite(body.sort_order)) {
      return { ok: false, error: "排序无效" };
    }
    data.sort_order = Math.trunc(body.sort_order);
  }

  return { ok: true, data };
}

export const domainsRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

domainsRoutes.get("/", async (c) => {
  const supabase = createServiceClient(c.env);
  const enabledOnly = c.req.query("enabled") === "1";
  let q = supabase
    .from("domains")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("host", { ascending: true });
  if (enabledOnly) q = q.eq("enabled", true);

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [], total: data?.length ?? 0 });
});

domainsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("domains")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "域名不存在" }, 404);
  return c.json(data);
});

domainsRoutes.post("/", requireSuperAdmin, async (c) => {
  const body = (await c.req.json()) as UpsertDomainInput;
  const parsed = parseDomainBody(body, false);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const supabase = createServiceClient(c.env);
  const row = {
    name: "",
    enabled: true,
    sort_order: 0,
    ...parsed.data,
  };

  const { data, error } = await supabase
    .from("domains")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (/domains_host_unique|duplicate key/i.test(error.message)) {
      return c.json({ error: "该域名已存在" }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
  return c.json(data, 201);
});

domainsRoutes.patch("/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as UpsertDomainInput;
  const parsed = parseDomainBody(body, true);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: "没有可更新的字段" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("domains")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (/domains_host_unique|duplicate key/i.test(error.message)) {
      return c.json({ error: "该域名已存在" }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
  if (!data) return c.json({ error: "域名不存在" }, 404);
  return c.json(data);
});

domainsRoutes.delete("/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);

  const { data: existing, error: findError } = await supabase
    .from("domains")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (findError) return c.json({ error: findError.message }, 500);
  if (!existing) return c.json({ error: "域名不存在" }, 404);

  const { count, error: useError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("domain_id", id);
  if (useError) return c.json({ error: useError.message }, 500);
  if ((count ?? 0) > 0) {
    return c.json({ error: "仍有商品使用该域名，无法删除" }, 400);
  }

  const { error } = await supabase.from("domains").delete().eq("id", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});
