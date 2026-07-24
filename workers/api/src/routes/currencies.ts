import { Hono } from "hono";
import type { UpsertCurrencyInput } from "@shopad/shared";
import { createServiceClient } from "../lib/supabase";
import { requireSuperAdmin } from "../middleware/auth";
import type { Env, Variables } from "../types";

function trimRequired(
  value: unknown,
  label: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: `${label}不能为空` };
  }
  return { ok: true, value: value.trim() };
}

function parseCurrencyBody(
  body: UpsertCurrencyInput,
  partial = false,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const data: Record<string, unknown> = {};

  if (!partial || body.code !== undefined) {
    const code = trimRequired(body.code, "币种代码");
    if (!code.ok) return code;
    const upper = code.value.toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) {
      return { ok: false, error: "币种代码须为 3 位大写字母（ISO 4217）" };
    }
    data.code = upper;
  }

  if (!partial || body.name !== undefined) {
    const name = trimRequired(body.name, "英文名称");
    if (!name.ok) return name;
    data.name = name.value;
  }

  if (!partial || body.name_zh !== undefined) {
    const nameZh = trimRequired(body.name_zh, "中文名称");
    if (!nameZh.ok) return nameZh;
    data.name_zh = nameZh.value;
  }

  if (!partial || body.symbol !== undefined) {
    const symbol = trimRequired(body.symbol, "货币符号");
    if (!symbol.ok) return symbol;
    data.symbol = symbol.value;
  }

  if (body.numeric_code !== undefined) {
    if (body.numeric_code === null || body.numeric_code === ("" as never)) {
      data.numeric_code = null;
    } else if (
      typeof body.numeric_code !== "number" ||
      !Number.isInteger(body.numeric_code) ||
      body.numeric_code < 0
    ) {
      return { ok: false, error: "数字代码无效" };
    } else {
      data.numeric_code = body.numeric_code;
    }
  }

  if (body.symbol_suffix !== undefined) {
    data.symbol_suffix = Boolean(body.symbol_suffix);
  }
  if (body.is_default !== undefined) {
    data.is_default = Boolean(body.is_default);
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

async function clearOtherDefaults(
  supabase: ReturnType<typeof createServiceClient>,
  exceptId?: string,
) {
  let q = supabase
    .from("currencies")
    .update({ is_default: false })
    .eq("is_default", true);
  if (exceptId) q = q.neq("id", exceptId);
  await q;
}

export const currenciesRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

currenciesRoutes.get("/", async (c) => {
  const supabase = createServiceClient(c.env);
  const enabledOnly = c.req.query("enabled") === "1";
  let q = supabase
    .from("currencies")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  if (enabledOnly) q = q.eq("enabled", true);

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [], total: data?.length ?? 0 });
});

currenciesRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("currencies")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "币种不存在" }, 404);
  return c.json(data);
});

currenciesRoutes.post("/", requireSuperAdmin, async (c) => {
  const body = (await c.req.json()) as UpsertCurrencyInput;
  const parsed = parseCurrencyBody(body, false);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const supabase = createServiceClient(c.env);
  if (parsed.data.is_default) {
    await clearOtherDefaults(supabase);
  }

  const row = {
    symbol_suffix: false,
    is_default: false,
    enabled: true,
    sort_order: 0,
    ...parsed.data,
  };

  const { data, error } = await supabase
    .from("currencies")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (/currencies_code_unique|duplicate key/i.test(error.message)) {
      return c.json({ error: "币种代码已存在" }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
  return c.json(data, 201);
});

currenciesRoutes.patch("/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as UpsertCurrencyInput;
  const parsed = parseCurrencyBody(body, true);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: "没有可更新的字段" }, 400);
  }

  const supabase = createServiceClient(c.env);

  if (parsed.data.is_default === false) {
    const { data: existing } = await supabase
      .from("currencies")
      .select("is_default")
      .eq("id", id)
      .maybeSingle();
    if (existing?.is_default) {
      return c.json({ error: "请先将其他币种设为默认，再取消当前默认" }, 400);
    }
  }

  if (parsed.data.is_default === true) {
    await clearOtherDefaults(supabase, id);
  }

  const { data, error } = await supabase
    .from("currencies")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (/currencies_code_unique|duplicate key/i.test(error.message)) {
      return c.json({ error: "币种代码已存在" }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
  if (!data) return c.json({ error: "币种不存在" }, 404);
  return c.json(data);
});

currenciesRoutes.delete("/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);

  const { data: existing, error: findError } = await supabase
    .from("currencies")
    .select("id, is_default")
    .eq("id", id)
    .maybeSingle();

  if (findError) return c.json({ error: findError.message }, 500);
  if (!existing) return c.json({ error: "币种不存在" }, 404);
  if (existing.is_default) {
    return c.json({ error: "默认币种不可删除，请先设置其他默认项" }, 400);
  }

  const { count, error: useError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("currency_id", id);
  if (useError) return c.json({ error: useError.message }, 500);
  if ((count ?? 0) > 0) {
    return c.json({ error: "仍有商品使用该币种，无法删除" }, 400);
  }

  const { error } = await supabase.from("currencies").delete().eq("id", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});
