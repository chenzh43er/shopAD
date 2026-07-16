import { Hono } from "hono";
import type { UpsertLogisticsShipperInput } from "@shopad/shared";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

function trimOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function parseShipperBody(
  body: UpsertLogisticsShipperInput,
  partial = false,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return { ok: false, error: "寄件人姓名不能为空" };
    }
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.phone !== undefined) data.phone = trimOrNull(body.phone);
  if (body.province !== undefined) data.province = trimOrNull(body.province);
  if (body.city !== undefined) data.city = trimOrNull(body.city);
  if (body.district !== undefined) data.district = trimOrNull(body.district);
  if (body.address !== undefined) data.address = trimOrNull(body.address);
  if (body.address_info !== undefined) {
    data.address_info = trimOrNull(body.address_info);
  }
  if (body.consignor_flag !== undefined) {
    data.consignor_flag =
      typeof body.consignor_flag === "string" && body.consignor_flag.trim()
        ? body.consignor_flag.trim()
        : "0";
  }
  if (body.consignor_name !== undefined) {
    data.consignor_name = trimOrNull(body.consignor_name);
  }
  if (body.consignor_phone !== undefined) {
    data.consignor_phone = trimOrNull(body.consignor_phone);
  }
  if (body.is_default !== undefined) {
    data.is_default = Boolean(body.is_default);
  }

  return { ok: true, data };
}

async function clearOtherDefaults(
  supabase: ReturnType<typeof createServiceClient>,
  exceptId?: string,
) {
  let q = supabase
    .from("logistics_shipper")
    .update({ is_default: false })
    .eq("is_default", true);
  if (exceptId) q = q.neq("id", exceptId);
  await q;
}

export const shippersRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

shippersRoutes.get("/", async (c) => {
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("logistics_shipper")
    .select("*")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [], total: data?.length ?? 0 });
});

shippersRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("logistics_shipper")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "寄件人不存在" }, 404);
  return c.json(data);
});

shippersRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as UpsertLogisticsShipperInput;
  const parsed = parseShipperBody(body, false);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const supabase = createServiceClient(c.env);
  if (parsed.data.is_default) {
    await clearOtherDefaults(supabase);
  }

  const row = {
    consignor_flag: "0",
    is_default: false,
    ...parsed.data,
  };

  const { data, error } = await supabase
    .from("logistics_shipper")
    .insert(row)
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

shippersRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as UpsertLogisticsShipperInput;
  const parsed = parseShipperBody(body, true);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: "没有可更新的字段" }, 400);
  }

  const supabase = createServiceClient(c.env);
  if (parsed.data.is_default === true) {
    await clearOtherDefaults(supabase, id);
  }

  const { data, error } = await supabase
    .from("logistics_shipper")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "寄件人不存在" }, 404);
  return c.json(data);
});

shippersRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);

  const { data: existing, error: findError } = await supabase
    .from("logistics_shipper")
    .select("id, is_default")
    .eq("id", id)
    .maybeSingle();

  if (findError) return c.json({ error: findError.message }, 500);
  if (!existing) return c.json({ error: "寄件人不存在" }, 404);
  if (existing.is_default) {
    return c.json({ error: "默认寄件人不可删除，请先设置其他默认项" }, 400);
  }

  const { error } = await supabase
    .from("logistics_shipper")
    .delete()
    .eq("id", id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});
