import { Hono } from "hono";
import {
  canAdvanceCodOrder,
  canTransitionOrder,
  ORDER_STATUSES,
  type OrderStatus,
  type PaymentType,
  type ReviewStatus,
} from "@shopad/shared";
import {
  attachActors,
  attachActorsOne,
  listAuditLogs,
  writeAuditLog,
} from "../lib/audit";
import {
  applyOrderOwnerScope,
  assertOrderAccess,
  isSuperAdmin,
  listOwnedProductIds,
  scopeProductsByOwner,
} from "../lib/access";
import {
  attachOrderCurrency,
  attachOrderCurrencyOne,
} from "../lib/orderCurrency";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

const FINANCE_EXPORT_MAX_ROWS = 5000;
const FINANCE_EXPORT_SELECT =
  "id, order_no, product_id, product_name, created_at, updated_at, total_amount, owner_member, sku_code, quantity";

function parseCsvIds(raw: unknown, max = 500): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) parts.push(item.trim());
    }
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(/[\s,，;；]+/)) {
      if (part.trim()) parts.push(part.trim());
    }
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of parts) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= max) break;
  }
  return result;
}

function parseDateBound(
  raw: unknown,
  label: string,
): { ok: true; iso: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: `请提供${label}` };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: `${label}无效` };
  }
  return { ok: true, iso: d.toISOString() };
}

function parsePage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parsePageSize(raw: string | undefined, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

const MAX_BATCH_ORDER_NOS = 200;

/** 解析批量订单号：支持逗号 / 空白 / 换行分隔 */
function parseOrderNos(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\s,，;；]+/)) {
    const no = part.trim();
    if (!no || seen.has(no)) continue;
    if (result.length >= MAX_BATCH_ORDER_NOS) break;
    seen.add(no);
    result.push(no);
  }
  return result;
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

function actorFrom(c: { get: (k: keyof Variables) => string }) {
  return {
    id: c.get("userId"),
    email: c.get("userEmail"),
    name: c.get("userName"),
  };
}

type Actor = ReturnType<typeof actorFrom>;
type ServiceClient = ReturnType<typeof createServiceClient>;

/** COD 待审核订单：通过 → 待发货；拒绝 → 已取消 */
async function applyCodPendingReview(
  supabase: ServiceClient,
  order: {
    id: string;
    status: string;
    payment_type: string;
    review_status: string;
  },
  decision: "approved" | "rejected",
  actor: Actor,
  remark?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (order.payment_type !== "cod") {
    return { ok: false, error: "非货到付款订单无需审核" };
  }
  if (order.review_status !== "pending") {
    return { ok: false, error: "当前订单不在待审核状态" };
  }

  const reason =
    typeof remark === "string" ? remark.trim() : remark == null ? "" : "";
  if (decision === "rejected" && !reason) {
    return { ok: false, error: "标记无效订单前请填写拒绝理由" };
  }

  const nextReview = decision as ReviewStatus;
  const nextFulfillment =
    nextReview === "approved" ? "awaiting_shipment" : "cancelled";
  const patch: Record<string, unknown> = {
    review_status: nextReview,
    status: nextFulfillment,
    reviewed_by: actor.id,
    reviewed_at: new Date().toISOString(),
    updated_by: actor.id,
  };
  if (decision === "rejected") {
    patch.reject_reason = reason;
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", order.id);

  if (updateError) return { ok: false, error: updateError.message };

  await writeAuditLog(supabase, {
    entityType: "order",
    entityId: order.id,
    action: "review",
    actor,
    fromValue: "pending",
    toValue: nextReview,
    remark: reason || null,
  });

  if (order.status !== nextFulfillment) {
    await writeAuditLog(supabase, {
      entityType: "order",
      entityId: order.id,
      action: "status_change",
      actor,
      fromValue: order.status,
      toValue: nextFulfillment,
      remark:
        nextReview === "approved"
          ? "COD 审核通过，自动进入待发货"
          : reason || "标记为无效订单",
    });
  }

  return { ok: true };
}

/** COD 已发货 → 已签收 */
async function applyCodReceive(
  supabase: ServiceClient,
  order: {
    id: string;
    status: string;
    payment_type: string;
    review_status: string;
  },
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (order.payment_type !== "cod") {
    return { ok: false, error: "非货到付款订单不可 COD 签收" };
  }
  if (order.status !== "cod_shipped") {
    return { ok: false, error: "仅已发货订单可签收" };
  }
  if (order.review_status !== "approved") {
    return { ok: false, error: "订单审核未通过，无法签收" };
  }

  const from = order.status as OrderStatus;
  const to: OrderStatus = "cod_completed";
  if (!canTransitionOrder(from, to)) {
    return { ok: false, error: `不允许从「${from}」变更为「${to}」` };
  }
  if (
    !canAdvanceCodOrder(
      order.payment_type as PaymentType,
      order.review_status as ReviewStatus,
      to,
    )
  ) {
    return { ok: false, error: "状态变更不符合支付类别或审核规则" };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: to,
      updated_by: actor.id,
    })
    .eq("id", order.id);

  if (updateError) return { ok: false, error: updateError.message };

  await writeAuditLog(supabase, {
    entityType: "order",
    entityId: order.id,
    action: "status_change",
    actor,
    fromValue: from,
    toValue: to,
    remark: "批量签收",
  });

  return { ok: true };
}

/** COD 已发货 → 拒绝签收 */
async function applyCodRefuse(
  supabase: ServiceClient,
  order: {
    id: string;
    status: string;
    payment_type: string;
    review_status: string;
  },
  actor: Actor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (order.payment_type !== "cod") {
    return { ok: false, error: "非货到付款订单不可 COD 拒绝签收" };
  }
  if (order.status !== "cod_shipped") {
    return { ok: false, error: "仅已发货订单可拒绝签收" };
  }
  if (order.review_status !== "approved") {
    return { ok: false, error: "订单审核未通过，无法拒绝签收" };
  }

  const from = order.status as OrderStatus;
  const to: OrderStatus = "cod_refused";
  if (!canTransitionOrder(from, to)) {
    return { ok: false, error: `不允许从「${from}」变更为「${to}」` };
  }
  if (
    !canAdvanceCodOrder(
      order.payment_type as PaymentType,
      order.review_status as ReviewStatus,
      to,
    )
  ) {
    return { ok: false, error: "状态变更不符合支付类别或审核规则" };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: to,
      updated_by: actor.id,
    })
    .eq("id", order.id);

  if (updateError) return { ok: false, error: updateError.message };

  await writeAuditLog(supabase, {
    entityType: "order",
    entityId: order.id,
    action: "status_change",
    actor,
    fromValue: from,
    toValue: to,
    remark: "批量拒绝签收",
  });

  return { ok: true };
}

type ShipperSnapshot = {
  id: string;
  name: string;
  phone: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  address_info: string | null;
  consignor_flag: string | null;
  consignor_name: string | null;
  consignor_phone: string | null;
};

/** COD 待发货 → 已发货 */
async function applyCodShip(
  supabase: ServiceClient,
  order: {
    id: string;
    status: string;
    payment_type: string;
    review_status: string;
  },
  actor: Actor,
  input: {
    shipping_order_no: string;
    owner_member: string;
    shipper: ShipperSnapshot;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (order.payment_type !== "cod") {
    return { ok: false, error: "非货到付款订单不可 COD 发货" };
  }
  if (order.status !== "awaiting_shipment") {
    return { ok: false, error: "仅待发货订单可发货" };
  }
  if (order.review_status !== "approved") {
    return { ok: false, error: "订单审核未通过，无法发货" };
  }

  const shippingOrderNo = input.shipping_order_no.trim();
  const ownerMember = input.owner_member.trim();
  if (!shippingOrderNo) {
    return { ok: false, error: "发货前请填写运单号" };
  }
  if (!ownerMember) {
    return { ok: false, error: "发货前请填写归属成员" };
  }

  const from = order.status as OrderStatus;
  const to: OrderStatus = "cod_shipped";
  if (!canTransitionOrder(from, to)) {
    return { ok: false, error: `不允许从「${from}」变更为「${to}」` };
  }
  if (
    !canAdvanceCodOrder(
      order.payment_type as PaymentType,
      order.review_status as ReviewStatus,
      to,
    )
  ) {
    return { ok: false, error: "状态变更不符合支付类别或审核规则" };
  }

  const shipper = input.shipper;
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: to,
      updated_by: actor.id,
      shipping_order_no: shippingOrderNo,
      owner_member: ownerMember,
      shipper_id: shipper.id,
      shipper_name: shipper.name,
      shipper_phone: shipper.phone,
      shipper_province: shipper.province,
      shipper_city: shipper.city,
      shipper_district: shipper.district,
      shipper_address: shipper.address,
      shipper_address_info: shipper.address_info,
      consignor_flag: shipper.consignor_flag,
      consignor_name: shipper.consignor_name,
      consignor_phone: shipper.consignor_phone,
    })
    .eq("id", order.id);

  if (updateError) return { ok: false, error: updateError.message };

  await writeAuditLog(supabase, {
    entityType: "order",
    entityId: order.id,
    action: "status_change",
    actor,
    fromValue: from,
    toValue: to,
    remark: `批量发货；运单号：${shippingOrderNo}；归属成员：${ownerMember}；寄件人：${shipper.name}`,
  });

  return { ok: true };
}

export const ordersRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

ordersRoutes.get("/", async (c) => {
  const page = parsePage(c.req.query("page"));
  const pageSize = parsePageSize(c.req.query("pageSize"));
  const status = c.req.query("status");
  const orderNo = c.req.query("order_no")?.trim();
  const orderNos = parseOrderNos(c.req.query("order_nos"));
  const reviewStatus = c.req.query("review_status")?.trim();
  const paymentType = c.req.query("payment_type")?.trim();
  const dateFrom = c.req.query("date_from")?.trim();
  const dateTo = c.req.query("date_to")?.trim();

  const supabase = createServiceClient(c.env);
  let query = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  try {
    const scoped = await applyOrderOwnerScope(query, supabase, c);
    if (!scoped.ok) {
      return c.json({ data: [], total: 0, page, pageSize });
    }
    query = scoped.query;
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  // 批量订单号精确匹配时，不按子状态收窄，便于跨 Tab 查出结果
  const batchByOrderNo = orderNos.length > 0;
  if (!batchByOrderNo && status) {
    if (!isOrderStatus(status)) {
      return c.json({ error: `无效的订单状态：${status}` }, 400);
    }
    query = query.eq("status", status);
  }
  if (batchByOrderNo) {
    query = query.in("order_no", orderNos);
  } else if (orderNo) {
    query = query.ilike("order_no", `%${orderNo}%`);
  }
  if (!batchByOrderNo && reviewStatus) {
    if (
      reviewStatus !== "not_required" &&
      reviewStatus !== "pending" &&
      reviewStatus !== "approved" &&
      reviewStatus !== "rejected"
    ) {
      return c.json({ error: `无效的审核状态：${reviewStatus}` }, 400);
    }
    query = query.eq("review_status", reviewStatus);
  }
  if (paymentType === "cod" || paymentType === "non_cod") {
    query = query.eq("payment_type", paymentType);
  }
  // 按最近更新时间筛选日期区间
  if (dateFrom) {
    const from = new Date(dateFrom);
    if (Number.isNaN(from.getTime())) {
      return c.json({ error: "开始日期无效" }, 400);
    }
    query = query.gte("updated_at", from.toISOString());
  }
  if (dateTo) {
    const to = new Date(dateTo);
    if (Number.isNaN(to.getTime())) {
      return c.json({ error: "结束日期无效" }, 400);
    }
    query = query.lte("updated_at", to.toISOString());
  }

  const { data, error, count } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const withActors = await attachActors(supabase, data ?? []);
  const withCurrency = await attachOrderCurrency(supabase, withActors);

  return c.json({
    data: withCurrency,
    total: count ?? 0,
    page,
    pageSize,
  });
});

/** 财务导出筛选项：有权限的商品 +（管理员）已出现的归属成员 */
ordersRoutes.get("/finance-export/meta", async (c) => {
  const supabase = createServiceClient(c.env);

  let productQuery = supabase
    .from("products")
    .select("id, name")
    .neq("status", "off_sale")
    .order("name", { ascending: true })
    .limit(2000);

  try {
    const scoped = await scopeProductsByOwner(productQuery, supabase, c);
    if (!scoped.ok) {
      return c.json({ products: [], owner_members: [] as string[] });
    }
    productQuery = scoped.query;
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const { data: products, error: productError } = await productQuery;
  if (productError) return c.json({ error: productError.message }, 500);

  let ownerMembers: string[] = [];
  if (isSuperAdmin(c)) {
    const { data: rows, error: ownerError } = await supabase
      .from("orders")
      .select("owner_member")
      .eq("payment_type", "cod")
      .eq("status", "cod_completed")
      .not("owner_member", "is", null)
      .neq("owner_member", "")
      .limit(5000);
    if (ownerError) return c.json({ error: ownerError.message }, 500);
    ownerMembers = [
      ...new Set(
        (rows ?? [])
          .map((r) =>
            typeof r.owner_member === "string" ? r.owner_member.trim() : "",
          )
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  return c.json({
    products: (products ?? []).map((p) => ({
      id: p.id as string,
      name: (p.name as string) || "",
    })),
    owner_members: ownerMembers,
  });
});

/**
 * 已签收订单财务导出数据（对齐财务系统导出模板列）。
 * 管理员可按归属成员多选；所有人可按有权限的商品多选。
 */
ordersRoutes.post("/finance-export", async (c) => {
  const body = (await c.req.json()) as {
    date_from?: unknown;
    date_to?: unknown;
    product_ids?: unknown;
    owner_members?: unknown;
  };

  const from = parseDateBound(body.date_from, "开始日期");
  if (!from.ok) return c.json({ error: from.error }, 400);
  const to = parseDateBound(body.date_to, "结束日期");
  if (!to.ok) return c.json({ error: to.error }, 400);
  if (from.iso > to.iso) {
    return c.json({ error: "开始日期不能晚于结束日期" }, 400);
  }

  const productIds = parseCsvIds(body.product_ids);
  const ownerMembers = parseCsvIds(body.owner_members, 200);

  if (ownerMembers.length > 0 && !isSuperAdmin(c)) {
    return c.json({ error: "仅管理员可按归属成员筛选导出" }, 403);
  }

  const supabase = createServiceClient(c.env);

  let allowedProductIds: string[] | "all";
  try {
    allowedProductIds = await listOwnedProductIds(supabase, c);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  if (allowedProductIds !== "all" && allowedProductIds.length === 0) {
    return c.json({ data: [], total: 0 });
  }

  let filterProductIds: string[] | null = null;
  if (productIds.length > 0) {
    if (allowedProductIds === "all") {
      filterProductIds = productIds;
    } else {
      const owned = new Set(allowedProductIds);
      filterProductIds = productIds.filter((id) => owned.has(id));
      if (filterProductIds.length === 0) {
        return c.json({ data: [], total: 0 });
      }
    }
  } else if (allowedProductIds !== "all") {
    filterProductIds = allowedProductIds;
  }

  let query = supabase
    .from("orders")
    .select(FINANCE_EXPORT_SELECT)
    .eq("payment_type", "cod")
    .eq("status", "cod_completed")
    .gte("updated_at", from.iso)
    .lte("updated_at", to.iso)
    .order("created_at", { ascending: false })
    .limit(FINANCE_EXPORT_MAX_ROWS);

  if (filterProductIds) {
    query = query.in("product_id", filterProductIds);
  }
  if (ownerMembers.length > 0) {
    query = query.in("owner_member", ownerMembers);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const rows = (data ?? []).map((row) => {
    const qty = typeof row.quantity === "number" ? row.quantity : Number(row.quantity) || 0;
    const sku =
      typeof row.sku_code === "string" && row.sku_code.trim()
        ? row.sku_code.trim()
        : "";
    return {
      order_no: typeof row.order_no === "string" ? row.order_no : "",
      product_name:
        typeof row.product_name === "string" ? row.product_name : "",
      created_at: typeof row.created_at === "string" ? row.created_at : "",
      total_amount:
        typeof row.total_amount === "number"
          ? row.total_amount
          : Number(row.total_amount) || 0,
      owner_member:
        typeof row.owner_member === "string" ? row.owner_member : "",
      sku_quantity: sku ? `${sku} * ${qty}` : "",
      quantity: qty,
    };
  });

  return c.json({
    data: rows,
    total: rows.length,
    truncated: rows.length >= FINANCE_EXPORT_MAX_ROWS,
  });
});

ordersRoutes.get("/:id/logs", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, product_id")
    .eq("id", id)
    .maybeSingle();
  if (orderError) return c.json({ error: orderError.message }, 500);
  if (!order) return c.json({ error: "订单不存在" }, 404);

  try {
    const access = await assertOrderAccess(supabase, order, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const { data, error } = await listAuditLogs(supabase, "order", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
});

ordersRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);

  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!order) return c.json({ error: "订单不存在" }, 404);

  try {
    const access = await assertOrderAccess(supabase, order, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const withActors = await attachActorsOne(supabase, order);
  return c.json(await attachOrderCurrencyOne(supabase, withActors));
});

ordersRoutes.patch("/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as {
    status?: OrderStatus;
    remark?: string | null;
    reject_reason?: string | null;
    shipper_id?: string | null;
    shipping_order_no?: string | null;
    owner_member?: string | null;
    shipper?: {
      name?: string;
      phone?: string | null;
      province?: string | null;
      city?: string | null;
      district?: string | null;
      address?: string | null;
      address_info?: string | null;
      consignor_flag?: string | null;
      consignor_name?: string | null;
      consignor_phone?: string | null;
    } | null;
  };
  const actor = actorFrom(c);

  if (!isOrderStatus(body.status)) {
    return c.json({ error: "状态无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status, shipper_id, product_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!order) return c.json({ error: "订单不存在" }, 404);

  try {
    const access = await assertOrderAccess(supabase, order, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const from = order.status as OrderStatus;
  const to = body.status;
  if (!canTransitionOrder(from, to)) {
    return c.json(
      { error: `不允许从「${from}」变更为「${to}」` },
      400,
    );
  }

  if (
    !canAdvanceCodOrder(
      order.payment_type as PaymentType,
      order.review_status as ReviewStatus,
      to,
    )
  ) {
    return c.json(
      {
        error:
          "状态变更不符合支付类别或审核规则（COD 须审核通过后才可待发货/发货）",
      },
      400,
    );
  }

  const invalidReason = (
    typeof body.reject_reason === "string"
      ? body.reject_reason
      : typeof body.remark === "string"
        ? body.remark
        : ""
  ).trim();
  if (to === "cancelled" && !invalidReason) {
    return c.json({ error: "标记无效订单前请填写拒绝理由" }, 400);
  }

  const needsShipper = to === "shipped" || to === "cod_shipped";
  const patch: Record<string, unknown> = {
    status: to,
    updated_by: actor.id,
  };

  if (to === "cancelled") {
    patch.reject_reason = invalidReason;
    if (order.payment_type === "cod") {
      patch.review_status = "rejected";
      patch.reviewed_by = actor.id;
      patch.reviewed_at = new Date().toISOString();
    }
  }

  if (needsShipper) {
    const shippingOrderNo =
      typeof body.shipping_order_no === "string"
        ? body.shipping_order_no.trim()
        : "";
    const ownerMember =
      typeof body.owner_member === "string" ? body.owner_member.trim() : "";

    if (!shippingOrderNo) {
      return c.json({ error: "发货前请填写发货订单号" }, 400);
    }
    if (!ownerMember) {
      return c.json({ error: "发货前请填写归属成员" }, 400);
    }

    patch.shipping_order_no = shippingOrderNo;
    patch.owner_member = ownerMember;

    const bodyShipper =
      body.shipper && typeof body.shipper === "object"
        ? (body.shipper as Record<string, unknown>)
        : null;
    const shipperName =
      typeof bodyShipper?.name === "string" ? bodyShipper.name.trim() : "";

    // 优先使用发货表单填写的寄件人快照；也可仅传 shipper_id 从配置带出
    if (shipperName) {
      const trim = (v: unknown) =>
        typeof v === "string" && v.trim() ? v.trim() : null;
      patch.shipper_id =
        typeof body.shipper_id === "string" && body.shipper_id.trim()
          ? body.shipper_id.trim()
          : order.shipper_id;
      patch.shipper_name = shipperName;
      patch.shipper_phone = trim(bodyShipper?.phone);
      patch.shipper_province = trim(bodyShipper?.province);
      patch.shipper_city = trim(bodyShipper?.city);
      patch.shipper_district = trim(bodyShipper?.district);
      patch.shipper_address = trim(bodyShipper?.address);
      patch.shipper_address_info = trim(bodyShipper?.address_info);
      patch.consignor_flag = trim(bodyShipper?.consignor_flag) ?? "0";
      patch.consignor_name = trim(bodyShipper?.consignor_name);
      patch.consignor_phone = trim(bodyShipper?.consignor_phone);
    } else {
      const shipperId =
        typeof body.shipper_id === "string" && body.shipper_id.trim()
          ? body.shipper_id.trim()
          : order.shipper_id;

      if (!shipperId) {
        return c.json({ error: "发货前请填写寄件人信息" }, 400);
      }

      const { data: shipper, error: shipperError } = await supabase
        .from("logistics_shipper")
        .select("*")
        .eq("id", shipperId)
        .maybeSingle();

      if (shipperError) return c.json({ error: shipperError.message }, 500);
      if (!shipper) return c.json({ error: "寄件人不存在" }, 400);

      patch.shipper_id = shipper.id;
      patch.shipper_name = shipper.name;
      patch.shipper_phone = shipper.phone;
      patch.shipper_province = shipper.province;
      patch.shipper_city = shipper.city;
      patch.shipper_district = shipper.district;
      patch.shipper_address = shipper.address;
      patch.shipper_address_info = shipper.address_info;
      patch.consignor_flag = shipper.consignor_flag;
      patch.consignor_name = shipper.consignor_name;
      patch.consignor_phone = shipper.consignor_phone;
    }
  }

  const { data, error: updateError } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) return c.json({ error: updateError.message }, 500);

  await writeAuditLog(supabase, {
    entityType: "order",
    entityId: id,
    action: "status_change",
    actor,
    fromValue: from,
    toValue: to,
    remark: needsShipper
      ? `发货订单号：${String(patch.shipping_order_no ?? "")}；归属成员：${String(patch.owner_member ?? "")}；寄件人：${String(patch.shipper_name ?? "")}`
      : to === "cancelled"
        ? invalidReason
        : null,
  });

  const withActors = await attachActorsOne(supabase, data);
  return c.json(await attachOrderCurrencyOne(supabase, withActors));
});

ordersRoutes.post("/batch-review", async (c) => {
  const body = (await c.req.json()) as {
    ids?: unknown;
    decision?: "approved" | "rejected";
    remark?: string | null;
  };
  const actor = actorFrom(c);

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return c.json({ error: "审核结论无效" }, 400);
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要审核的订单" }, 400);
  }
  if (body.ids.length > 100) {
    return c.json({ error: "单次最多审核 100 笔订单" }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status, product_id")
    .in("id", ids);

  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    const order = byId.get(id);
    if (!order) {
      failed.push({ id, error: "订单不存在" });
      continue;
    }
    try {
      const access = await assertOrderAccess(supabase, order, c);
      if (!access.ok) {
        failed.push({ id, error: access.error });
        continue;
      }
    } catch (e) {
      failed.push({
        id,
        error: e instanceof Error ? e.message : "权限校验失败",
      });
      continue;
    }
    const result = await applyCodPendingReview(
      supabase,
      order,
      body.decision,
      actor,
      body.remark,
    );
    if (result.ok) succeeded.push(id);
    else failed.push({ id, error: result.error });
  }

  return c.json({ succeeded, failed });
});

/** COD 已发货批量签收 → 已签收 */
ordersRoutes.post("/batch-complete", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要签收的订单" }, 400);
  }
  if (body.ids.length > 100) {
    return c.json({ error: "单次最多签收 100 笔订单" }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status, product_id")
    .in("id", ids);

  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    const order = byId.get(id);
    if (!order) {
      failed.push({ id, error: "订单不存在" });
      continue;
    }
    try {
      const access = await assertOrderAccess(supabase, order, c);
      if (!access.ok) {
        failed.push({ id, error: access.error });
        continue;
      }
    } catch (e) {
      failed.push({
        id,
        error: e instanceof Error ? e.message : "权限校验失败",
      });
      continue;
    }
    const result = await applyCodReceive(supabase, order, actor);
    if (result.ok) succeeded.push(id);
    else failed.push({ id, error: result.error });
  }

  return c.json({ succeeded, failed });
});

/** COD 已发货批量拒绝签收 → 拒绝签收 */
ordersRoutes.post("/batch-refuse", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要拒绝签收的订单" }, 400);
  }
  if (body.ids.length > 100) {
    return c.json({ error: "单次最多拒绝签收 100 笔订单" }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status, product_id")
    .in("id", ids);

  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    const order = byId.get(id);
    if (!order) {
      failed.push({ id, error: "订单不存在" });
      continue;
    }
    try {
      const access = await assertOrderAccess(supabase, order, c);
      if (!access.ok) {
        failed.push({ id, error: access.error });
        continue;
      }
    } catch (e) {
      failed.push({
        id,
        error: e instanceof Error ? e.message : "权限校验失败",
      });
      continue;
    }
    const result = await applyCodRefuse(supabase, order, actor);
    if (result.ok) succeeded.push(id);
    else failed.push({ id, error: result.error });
  }

  return c.json({ succeeded, failed });
});

/** COD 待发货批量发货 → 已发货 */
ordersRoutes.post("/batch-ship", async (c) => {
  const body = (await c.req.json()) as {
    items?: unknown;
    shipper_id?: unknown;
    owner_member?: unknown;
  };
  const actor = actorFrom(c);

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: "请提供要发货的订单列表" }, 400);
  }
  if (body.items.length > 200) {
    return c.json({ error: "单次最多发货 200 笔订单" }, 400);
  }

  const ownerMember =
    typeof body.owner_member === "string" ? body.owner_member.trim() : "";
  if (!ownerMember) {
    return c.json({ error: "请填写归属成员" }, 400);
  }

  const shipperId =
    typeof body.shipper_id === "string" ? body.shipper_id.trim() : "";
  if (!shipperId) {
    return c.json({ error: "请选择寄件人" }, 400);
  }

  const items: Array<{ order_no: string; shipping_order_no: string }> = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object") {
      return c.json({ error: "发货列表格式无效" }, 400);
    }
    const row = raw as Record<string, unknown>;
    const orderNo =
      typeof row.order_no === "string" ? row.order_no.trim() : "";
    const shippingOrderNo =
      typeof row.shipping_order_no === "string"
        ? row.shipping_order_no.trim()
        : "";
    if (!orderNo || !shippingOrderNo) {
      return c.json({ error: "每笔发货须包含订单号与运单号" }, 400);
    }
    items.push({ order_no: orderNo, shipping_order_no: shippingOrderNo });
  }

  const supabase = createServiceClient(c.env);

  const { data: shipper, error: shipperError } = await supabase
    .from("logistics_shipper")
    .select("*")
    .eq("id", shipperId)
    .maybeSingle();

  if (shipperError) return c.json({ error: shipperError.message }, 500);
  if (!shipper) return c.json({ error: "寄件人不存在" }, 400);

  const shipperSnap: ShipperSnapshot = {
    id: shipper.id,
    name: shipper.name,
    phone: shipper.phone,
    province: shipper.province,
    city: shipper.city,
    district: shipper.district,
    address: shipper.address,
    address_info: shipper.address_info,
    consignor_flag: shipper.consignor_flag,
    consignor_name: shipper.consignor_name,
    consignor_phone: shipper.consignor_phone,
  };

  const orderNos = items.map((i) => i.order_no);
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_no, status, payment_type, review_status, product_id")
    .in("order_no", orderNos);

  if (error) return c.json({ error: error.message }, 500);

  const byOrderNo = new Map((orders ?? []).map((o) => [o.order_no, o]));
  const succeeded: Array<{ id: string; order_no: string }> = [];
  const failed: Array<{ order_no: string; error: string }> = [];

  for (const item of items) {
    const order = byOrderNo.get(item.order_no);
    if (!order) {
      failed.push({ order_no: item.order_no, error: "订单不存在" });
      continue;
    }
    try {
      const access = await assertOrderAccess(supabase, order, c);
      if (!access.ok) {
        failed.push({ order_no: item.order_no, error: access.error });
        continue;
      }
    } catch (e) {
      failed.push({
        order_no: item.order_no,
        error: e instanceof Error ? e.message : "权限校验失败",
      });
      continue;
    }

    const result = await applyCodShip(supabase, order, actor, {
      shipping_order_no: item.shipping_order_no,
      owner_member: ownerMember,
      shipper: shipperSnap,
    });
    if (result.ok) {
      succeeded.push({ id: order.id, order_no: item.order_no });
    } else {
      failed.push({ order_no: item.order_no, error: result.error });
    }
  }

  return c.json({ succeeded, failed });
});

ordersRoutes.patch("/:id/review", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as {
    decision?: "approved" | "rejected" | "reopen";
    remark?: string | null;
    reject_reason?: string | null;
  };
  const actor = actorFrom(c);

  if (
    body.decision !== "approved" &&
    body.decision !== "rejected" &&
    body.decision !== "reopen"
  ) {
    return c.json({ error: "审核结论无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status, product_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!order) return c.json({ error: "订单不存在" }, 404);

  try {
    const access = await assertOrderAccess(supabase, order, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  if (order.payment_type !== "cod") {
    return c.json({ error: "非货到付款订单无需审核" }, 400);
  }

  const rejectReason =
    typeof body.reject_reason === "string"
      ? body.reject_reason
      : typeof body.remark === "string"
        ? body.remark
        : null;

  // 无效订单 → 改回待审核
  if (body.decision === "reopen") {
    if (order.review_status !== "rejected" && order.status !== "cancelled") {
      return c.json({ error: "仅无效订单可改回待审核" }, 400);
    }

    const { data, error: updateError } = await supabase
      .from("orders")
      .update({
        review_status: "pending",
        status: "awaiting_review",
        reviewed_by: null,
        reviewed_at: null,
        updated_by: actor.id,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) return c.json({ error: updateError.message }, 500);

    await writeAuditLog(supabase, {
      entityType: "order",
      entityId: id,
      action: "review",
      actor,
      fromValue: order.review_status,
      toValue: "pending",
      remark: body.remark ?? "无效订单改回待审核",
    });

    if (order.status !== "awaiting_review") {
      await writeAuditLog(supabase, {
        entityType: "order",
        entityId: id,
        action: "status_change",
        actor,
        fromValue: order.status,
        toValue: "awaiting_review",
        remark: "COD 无效订单改回待审核",
      });
    }

    return c.json(
      await attachOrderCurrencyOne(
        supabase,
        await attachActorsOne(supabase, data),
      ),
    );
  }

  const result = await applyCodPendingReview(
    supabase,
    order,
    body.decision,
    actor,
    rejectReason,
  );
  if (!result.ok) return c.json({ error: result.error }, 400);

  const { data, error: reloadError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (reloadError) return c.json({ error: reloadError.message }, 500);
  return c.json(
    await attachOrderCurrencyOne(
      supabase,
      await attachActorsOne(supabase, data),
    ),
  );
});

ordersRoutes.patch("/:id/remark", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { remark?: string | null };
  const actor = actorFrom(c);

  if (body.remark !== undefined && body.remark !== null && typeof body.remark !== "string") {
    return c.json({ error: "备注格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: before } = await supabase
    .from("orders")
    .select("id, remark, product_id")
    .eq("id", id)
    .maybeSingle();

  if (!before) return c.json({ error: "订单不存在" }, 404);

  try {
    const access = await assertOrderAccess(supabase, before, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ remark: body.remark ?? null, updated_by: actor.id })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "订单不存在" }, 404);

  await writeAuditLog(supabase, {
    entityType: "order",
    entityId: id,
    action: "remark_update",
    actor,
    fromValue: before?.remark ?? null,
    toValue: body.remark ?? null,
  });

  return c.json(
    await attachOrderCurrencyOne(
      supabase,
      await attachActorsOne(supabase, data),
    ),
  );
});
