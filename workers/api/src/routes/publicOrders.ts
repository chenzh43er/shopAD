import type { Context, Hono } from "hono";
import { persistOrderOwnerMembers } from "../lib/access";
import { attachOrderCurrencyOne } from "../lib/orderCurrency";
import { clientIp, rateLimit } from "../lib/rateLimit";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

type App = Hono<{ Bindings: Env; Variables: Variables }>;
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

/** 公开查询返回字段（不含审核人、内部备注等敏感列） */
const PUBLIC_ORDER_SELECT =
  "id, order_no, product_id, product_name, package_name, customer_name, customer_phone, shipping_address, shipping_province, shipping_city, shipping_district, shipping_detail, shipping_order_no, total_amount, status, payment_type, created_at, updated_at";

const PUBLIC_RATE_LIMIT = 30;
const PUBLIC_RATE_WINDOW_MS = 60_000;
const MIN_PHONE_DIGITS = 8;

function normalizePhoneQuery(raw: string): string {
  return raw.replace(/[\s\-().+]/g, "").trim();
}

/** 搜索用有效数字：去掉前导 0，兼容本地号与国际号 */
function phoneSearchDigits(raw: string): string {
  const n = normalizePhoneQuery(raw);
  if (!n) return "";
  return n.replace(/^0+/, "");
}

async function enforcePublicRateLimit(c: AppContext) {
  const ip = clientIp(c);
  const result = await rateLimit(
    c.env,
    `public-orders:${ip}`,
    PUBLIC_RATE_LIMIT,
    PUBLIC_RATE_WINDOW_MS,
  );
  c.header("X-RateLimit-Limit", String(PUBLIC_RATE_LIMIT));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.ok) {
    c.header("Retry-After", String(result.retryAfterSec));
    return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
  }
  return null;
}

/** 公开查单：无需登录。注册在鉴权 /api 之前，避免与 /orders/:id 冲突。 */
export function registerPublicOrderRoutes(app: App) {
  /** GET /api/orders/by-order-no?order_no= */
  app.get("/api/orders/by-order-no", async (c) => {
    const limited = await enforcePublicRateLimit(c);
    if (limited) return limited;

    const orderNo =
      c.req.query("order_no")?.trim() || c.req.query("orderNo")?.trim() || "";
    if (!orderNo) {
      return c.json({ error: "请提供订单号" }, 400);
    }
    if (orderNo.length > 64) {
      return c.json({ error: "订单号无效" }, 400);
    }

    const supabase = createServiceClient(c.env);
    const { data: order, error } = await supabase
      .from("orders")
      .select(PUBLIC_ORDER_SELECT)
      .eq("order_no", orderNo)
      .maybeSingle();

    if (error) {
      console.error("[publicOrders] by-order-no", error);
      return c.json({ error: "查询失败" }, 500);
    }
    if (!order) return c.json({ error: "订单不存在" }, 404);

    return c.json({
      data: await attachOrderCurrencyOne(supabase, order),
    });
  });

  /** GET /api/orders/by-phone?phone= — 仅返回该手机号最近一单 */
  app.get("/api/orders/by-phone", async (c) => {
    const limited = await enforcePublicRateLimit(c);
    if (limited) return limited;

    const phone = phoneSearchDigits(
      c.req.query("phone") ?? c.req.query("customer_phone") ?? "",
    );
    if (!phone) {
      return c.json({ error: "请提供手机号" }, 400);
    }
    if (phone.length < MIN_PHONE_DIGITS || phone.length > 20 || !/^\d+$/.test(phone)) {
      return c.json({ error: "手机号无效" }, 400);
    }

    const supabase = createServiceClient(c.env);
    // 精确 + 前缀（可走索引）；避免前导 % 全表扫描
    const { data: rows, error } = await supabase
      .from("orders")
      .select(PUBLIC_ORDER_SELECT)
      .or(`customer_phone.eq.${phone},customer_phone.ilike.${phone}%`)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[publicOrders] by-phone", error);
      return c.json({ error: "查询失败" }, 500);
    }

    const order = rows?.[0];
    if (!order) return c.json({ error: "订单不存在" }, 404);

    return c.json({
      data: await attachOrderCurrencyOne(supabase, order),
    });
  });

  /**
   * 落地页下单后异步补写归属成员（商品所属人）。
   * storefront 角色读不到 product_owners，故由 Worker service_role 写入。
   * POST { order_no } | { order_id }
   */
  app.post("/api/orders/fill-owner-member", async (c) => {
    const limited = await enforcePublicRateLimit(c);
    if (limited) return limited;

    let body: { order_no?: unknown; order_id?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "请求体无效" }, 400);
    }

    const orderNo =
      typeof body.order_no === "string" ? body.order_no.trim() : "";
    const orderId =
      typeof body.order_id === "string" ? body.order_id.trim() : "";
    if (!orderNo && !orderId) {
      return c.json({ error: "请提供 order_no 或 order_id" }, 400);
    }
    if (orderNo.length > 64 || orderId.length > 64) {
      return c.json({ error: "参数无效" }, 400);
    }

    const supabase = createServiceClient(c.env);
    let query = supabase
      .from("orders")
      .select("id, product_id, owner_member, order_no")
      .limit(1);
    query = orderId ? query.eq("id", orderId) : query.eq("order_no", orderNo);

    const { data: rows, error } = await query;
    if (error) {
      console.error("[publicOrders] fill-owner-member", error);
      return c.json({ error: "查询失败" }, 500);
    }
    const order = rows?.[0];
    if (!order) return c.json({ error: "订单不存在" }, 404);

    const filled = await persistOrderOwnerMembers(supabase, [order]);
    const id = typeof order.id === "string" ? order.id : "";
    const ownerMember = id ? filled.get(id) ?? null : null;
    return c.json({ ok: true, order_no: order.order_no, owner_member: ownerMember });
  });
}
