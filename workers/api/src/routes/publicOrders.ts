import type { Hono } from "hono";
import { attachOrderCurrencyOne } from "../lib/orderCurrency";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

/** 公开查询返回字段（不含审核人、内部备注等敏感列） */
const PUBLIC_ORDER_SELECT =
  "id, order_no, product_id, product_name, package_name, customer_name, customer_phone, shipping_address, shipping_province, shipping_city, shipping_district, shipping_detail, shipping_order_no, total_amount, status, payment_type, created_at, updated_at";

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

  /** GET /api/orders/by-phone?phone= — 仅返回该手机号最近一单 */
  app.get("/api/orders/by-phone", async (c) => {
    const phone = phoneSearchDigits(
      c.req.query("phone") ?? c.req.query("customer_phone") ?? "",
    );
    if (!phone) {
      return c.json({ error: "请提供手机号" }, 400);
    }

    const supabase = createServiceClient(c.env);
    const { data: rows, error } = await supabase
      .from("orders")
      .select(PUBLIC_ORDER_SELECT)
      .ilike("customer_phone", `%${phone}%`)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) return c.json({ error: error.message }, 500);

    const order = rows?.[0];
    if (!order) return c.json({ error: "订单不存在" }, 404);

    return c.json({
      data: await attachOrderCurrencyOne(supabase, order),
    });
  });
}
