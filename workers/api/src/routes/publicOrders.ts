import type { Hono } from "hono";
import { attachOrderCurrency, attachOrderCurrencyOne } from "../lib/orderCurrency";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

/** 公开查询返回字段（不含审核人、内部备注等敏感列） */
const PUBLIC_ORDER_SELECT =
  "id, order_no, product_id, product_name, package_name, customer_name, customer_phone, shipping_address, shipping_province, shipping_city, shipping_district, shipping_detail, shipping_order_no, total_amount, status, payment_type, created_at, updated_at";

const LOOKUP_BY_PHONE_MAX = 100;

function parsePage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parsePageSize(raw: string | undefined, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), LOOKUP_BY_PHONE_MAX);
}

function normalizePhoneQuery(raw: string): string {
  return raw.replace(/[\s\-().+]/g, "").trim();
}

/** 搜索用有效数字：去掉前导 0，兼容本地号与国际号 */
function phoneSearchDigits(raw: string): string {
  const n = normalizePhoneQuery(raw);
  if (!n) return "";
  return n.replace(/^0+/, "");
}

/** 公开查单：无需登录。注册在鉴权 /api 之前，避免与 /orders/:id 冲突。 */
export function registerPublicOrderRoutes(app: App) {
  /** GET /api/orders/by-order-no?order_no= */
  app.get("/api/orders/by-order-no", async (c) => {
    const orderNo =
      c.req.query("order_no")?.trim() || c.req.query("orderNo")?.trim() || "";
    if (!orderNo) {
      return c.json({ error: "请提供订单号" }, 400);
    }

    const supabase = createServiceClient(c.env);
    const { data: order, error } = await supabase
      .from("orders")
      .select(PUBLIC_ORDER_SELECT)
      .eq("order_no", orderNo)
      .maybeSingle();

    if (error) return c.json({ error: error.message }, 500);
    if (!order) return c.json({ error: "订单不存在" }, 404);

    return c.json({
      data: await attachOrderCurrencyOne(supabase, order),
    });
  });

  /** GET /api/orders/by-phone?phone= */
  app.get("/api/orders/by-phone", async (c) => {
    const phone = phoneSearchDigits(
      c.req.query("phone") ?? c.req.query("customer_phone") ?? "",
    );
    if (!phone) {
      return c.json({ error: "请提供手机号" }, 400);
    }

    const page = parsePage(c.req.query("page"));
    const pageSize = parsePageSize(c.req.query("pageSize"), 20);

    const supabase = createServiceClient(c.env);
    const { data, error, count } = await supabase
      .from("orders")
      .select(PUBLIC_ORDER_SELECT, { count: "estimated" })
      .ilike("customer_phone", `%${phone}%`)
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) return c.json({ error: error.message }, 500);

    const rows = data ?? [];
    const withCurrency = await attachOrderCurrency(supabase, rows);

    return c.json({
      data: withCurrency,
      total: count ?? 0,
      page,
      pageSize,
    });
  });
}
