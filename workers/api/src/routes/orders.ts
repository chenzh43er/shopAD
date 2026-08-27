import { Hono } from "hono";
import {
  canAdvanceCodOrder,
  canRevertCodOrder,
  canTransitionOrder,
  COD_REVERT_FALLBACK,
  isCodForceStatus,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  PAYMENT_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  type OrderStatus,
  type PaymentType,
  type ReviewStatus,
} from "@shopad/shared";
import {
  attachActors,
  attachActorsOne,
  listAuditLogs,
  writeAuditLog,
  writeAuditLogs,
  type WriteAuditInput,
} from "../lib/audit";
import {
  applyOrderOwnerScope,
  assertOrderAccess,
  assertProductAccess,
  createOrderAccessChecker,
  isSuperAdmin,
  listAccessibleProductIds,
  scopeProductsByOwner,
} from "../lib/access";
import {
  attachOrderCurrency,
  attachOrderCurrencyOne,
} from "../lib/orderCurrency";
import { requireSuperAdmin } from "../middleware/auth";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

const FINANCE_EXPORT_MAX_ROWS = 5000;
const FINANCE_EXPORT_SELECT =
  "id, order_no, product_id, product_name, created_at, updated_at, total_amount, owner_member, sku_code, quantity, package_count";
/** 物流导出仅需标红列对应字段；寄件等黑列由前端按模板固定填充 */
const LOGISTICS_EXPORT_SELECT =
  "id, order_no, product_id, customer_name, customer_phone, shipping_province, shipping_city, shipping_district, shipping_detail, shipping_address, sku_code, quantity, package_count, remark, cod_amount, total_amount";
/** 全部订单导出：业务可读字段（不含内部 UUID） */
const FULL_EXPORT_SELECT =
  "id, order_no, shipping_order_no, product_id, product_name, package_name, package_name_external, sku_code, unit_price, quantity, package_count, customer_name, customer_phone, shipping_province, shipping_city, shipping_district, shipping_detail, shipping_address, total_amount, cod_amount, shipping_fee, other_fee, status, review_status, payment_type, payment_method, remark, reject_reason, owner_member, weight, express_type, insurance_type, insurance_flag, item_value, item_category, item_type, consignor_flag, consignor_name, consignor_phone, shipper_name, shipper_phone, shipper_province, shipper_city, shipper_district, shipper_address, shipper_address_info, reviewed_at, created_at, updated_at";
/** 列表页所需列（避免 select * 拖大 payload / IO） */
const ORDER_LIST_SELECT =
  "id, order_no, shipping_order_no, product_id, product_name, package_name, customer_name, customer_phone, shipping_address, shipping_province, shipping_city, shipping_district, shipping_detail, total_amount, status, review_status, reject_reason, remark, reviewed_by, payment_type, created_at, updated_at";

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

function parsePage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parsePageSize(raw: string | undefined, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 500);
}

const MAX_BATCH_ORDER_NOS = 500;
const MAX_BATCH_PHONES = 500;

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

/** 去掉空格、分隔符与 +，便于匹配入库手机号 */
function normalizePhoneQuery(raw: string): string {
  return raw.replace(/[\s\-().+]/g, "").trim();
}

/**
 * 搜索用有效数字：去掉前导 0，兼容本地号 08… 与国际号 628… / 861…
 *（入库一般为国际号不含 +）
 */
function phoneSearchDigits(raw: string): string {
  const n = normalizePhoneQuery(raw);
  if (!n) return "";
  return n.replace(/^0+/, "");
}

/** 解析批量手机号：换行 / 逗号 / 分号分隔；行内空格保留给国际号（如 +62 812…） */
function parsePhones(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\n\r,，;；]+/)) {
    const digits = phoneSearchDigits(part);
    if (!digits || seen.has(digits)) continue;
    if (result.length >= MAX_BATCH_PHONES) break;
    seen.add(digits);
    result.push(digits);
  }
  return result;
}

/** 可选日期：未传则不按时间筛选；传了无效值才报错 */
function parseOptionalDateBound(
  raw: unknown,
  label: string,
): { ok: true; iso: string | null } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, iso: null };
  if (typeof raw !== "string" || !raw.trim()) return { ok: true, iso: null };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: `${label}无效` };
  }
  return { ok: true, iso: d.toISOString() };
}

function parsePhonesInput(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return parsePhones(
      raw.filter((x): x is string => typeof x === "string").join(","),
    );
  }
  if (typeof raw === "string") return parsePhones(raw);
  return [];
}

type ExportListFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  orderNo: string;
  orderNos: string[];
  customerPhone: string;
  customerPhones: string[];
  shippingOrderNo: string;
  shippingOrderNos: string[];
};

function parseExportListFilters(body: {
  date_from?: unknown;
  date_to?: unknown;
  order_no?: unknown;
  order_nos?: unknown;
  customer_phone?: unknown;
  customer_phones?: unknown;
  shipping_order_no?: unknown;
  shipping_order_nos?: unknown;
}): { ok: true; filters: ExportListFilters } | { ok: false; error: string } {
  const from = parseOptionalDateBound(body.date_from, "开始日期");
  if (!from.ok) return from;
  const to = parseOptionalDateBound(body.date_to, "结束日期");
  if (!to.ok) return to;
  if (from.iso && to.iso && from.iso > to.iso) {
    return { ok: false, error: "开始日期不能晚于结束日期" };
  }
  return {
    ok: true,
    filters: {
      dateFrom: from.iso,
      dateTo: to.iso,
      orderNo:
        typeof body.order_no === "string" ? body.order_no.trim() : "",
      orderNos: parseCsvIds(body.order_nos, MAX_BATCH_ORDER_NOS),
      customerPhone: phoneSearchDigits(
        typeof body.customer_phone === "string" ? body.customer_phone : "",
      ),
      customerPhones: parsePhonesInput(body.customer_phones),
      shippingOrderNo:
        typeof body.shipping_order_no === "string"
          ? body.shipping_order_no.trim()
          : "",
      shippingOrderNos: parseCsvIds(
        body.shipping_order_nos,
        MAX_BATCH_ORDER_NOS,
      ),
    },
  };
}

/** 与列表页一致：批量订单号/手机号/运单号、单号/电话/运单搜索、可选创建时间区间 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyExportListFilters(query: any, filters: ExportListFilters) {
  const batchByOrderNo = filters.orderNos.length > 0;
  const batchByPhone = !batchByOrderNo && filters.customerPhones.length > 0;
  const batchByShipping =
    !batchByOrderNo &&
    !batchByPhone &&
    filters.shippingOrderNos.length > 0;
  if (batchByOrderNo) {
    query = query.in("order_no", filters.orderNos);
  } else if (batchByPhone) {
    query = query.or(
      filters.customerPhones
        .map((p) => `customer_phone.ilike.%${p}%`)
        .join(","),
    );
  } else if (batchByShipping) {
    query = query.in("shipping_order_no", filters.shippingOrderNos);
  } else if (filters.orderNo) {
    query = query.ilike("order_no", `${filters.orderNo}%`);
  } else if (filters.customerPhone) {
    query = query.ilike("customer_phone", `%${filters.customerPhone}%`);
  } else if (filters.shippingOrderNo) {
    query = query.ilike(
      "shipping_order_no",
      `${filters.shippingOrderNo}%`,
    );
  }
  if (filters.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("created_at", filters.dateTo);
  }
  return query;
}

/** 筛选未关联地区库的商品 */
const REGION_UNSET = "__none__";

type ServiceClient = ReturnType<
  typeof import("../lib/supabase").createServiceClient
>;
type AppContext = import("hono").Context<{
  Bindings: import("../types").Env;
  Variables: import("../types").Variables;
}>;

/**
 * 按商品地区库 id 解析可筛选的商品 id 列表（含所属人权限）。
 * @returns `"empty"` 表示无匹配商品
 */
async function listProductIdsByRegion(
  supabase: ServiceClient,
  c: AppContext,
  regionId: string,
): Promise<string[] | "empty"> {
  let productQuery = supabase.from("products").select("id");
  if (regionId === REGION_UNSET) {
    productQuery = productQuery.is("region_id", null);
  } else {
    productQuery = productQuery.eq("region_id", regionId);
  }

  const scoped = await scopeProductsByOwner(productQuery, supabase, c);
  if (!scoped.ok) return "empty";
  productQuery = scoped.query;

  const { data, error } = await productQuery;
  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((row) => row.id as string);
  return ids.length === 0 ? "empty" : ids;
}

/** 将地区筛选与已有商品 id 范围取交集 */
function intersectProductIds(
  base: string[] | null,
  regionIds: string[],
): string[] {
  if (base === null) return regionIds;
  const allowed = new Set(regionIds);
  return base.filter((id) => allowed.has(id));
}

/**
 * 解析导出/列表用的商品 id 范围：所属人权限 × 弹窗所选商品 × 地区筛选。
 * @returns `"empty"` 表示无匹配商品；`null` 表示不限制商品
 */
async function resolveFilterProductIds(
  supabase: ServiceClient,
  c: AppContext,
  opts: { productIds: string[]; regionId?: string },
): Promise<string[] | null | "empty"> {
  let allowedProductIds: string[] | "all";
  try {
    allowedProductIds = await listAccessibleProductIds(supabase, c);
  } catch (e) {
    throw e instanceof Error ? e : new Error("权限校验失败");
  }
  if (allowedProductIds !== "all" && allowedProductIds.length === 0) {
    return "empty";
  }

  let filterProductIds: string[] | null = null;
  if (opts.productIds.length > 0) {
    if (allowedProductIds === "all") {
      filterProductIds = opts.productIds;
    } else {
      const owned = new Set(allowedProductIds);
      filterProductIds = opts.productIds.filter((id) => owned.has(id));
      if (filterProductIds.length === 0) return "empty";
    }
  } else if (allowedProductIds !== "all") {
    filterProductIds = allowedProductIds;
  }

  if (opts.regionId) {
    const regionProductIds = await listProductIdsByRegion(
      supabase,
      c,
      opts.regionId,
    );
    if (regionProductIds === "empty") return "empty";
    filterProductIds = intersectProductIds(filterProductIds, regionProductIds);
    if (filterProductIds.length === 0) return "empty";
  }

  return filterProductIds;
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

/** COD 待审核订单：通过 → 待确认；拒绝 → 已取消 */
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
    nextReview === "approved" ? "awaiting_confirm" : "cancelled";
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
          ? "COD 审核通过，自动进入待确认"
          : reason || "标记为无效订单",
    });
  }

  return { ok: true };
}

/** COD 订单标记为无效：仅待审核 / 待确认 / 待发货 */
async function applyCodInvalidate(
  supabase: ServiceClient,
  order: {
    id: string;
    status: string;
    payment_type: string;
    review_status: string;
  },
  actor: Actor,
  rejectReason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (order.payment_type !== "cod") {
    return { ok: false, error: "非货到付款订单不可标记无效" };
  }

  const reason = rejectReason.trim();
  if (!reason) {
    return { ok: false, error: "标记无效订单前请填写拒绝理由" };
  }

  const from = order.status as OrderStatus;
  if (
    from !== "awaiting_review" &&
    from !== "awaiting_confirm" &&
    from !== "awaiting_shipment"
  ) {
    return {
      ok: false,
      error: "仅待审核、待确认、待发货订单可标记为无效",
    };
  }

  if (from === "awaiting_review" || order.review_status === "pending") {
    return applyCodPendingReview(supabase, order, "rejected", actor, reason);
  }

  const to: OrderStatus = "cancelled";
  if (!canTransitionOrder(from, to)) {
    return { ok: false, error: `不允许从「${from}」变更为无效订单` };
  }
  if (
    !canAdvanceCodOrder(
      order.payment_type as PaymentType,
      order.review_status as ReviewStatus,
      to,
    )
  ) {
    return { ok: false, error: "当前审核状态不允许标记为无效订单" };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: to,
      review_status: "rejected",
      reject_reason: reason,
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
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
    remark: reason,
  });

  return { ok: true };
}

const REOPENABLE_STATUSES = new Set<OrderStatus>([
  "awaiting_review",
  "awaiting_confirm",
  "awaiting_shipment",
]);

/** 从审计日志推断无效前的履约状态；找不到则回退待审核 */
async function resolveStatusBeforeInvalid(
  supabase: ServiceClient,
  orderId: string,
): Promise<OrderStatus> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("from_value")
    .eq("entity_type", "order")
    .eq("entity_id", orderId)
    .eq("action", "status_change")
    .eq("to_value", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("resolveStatusBeforeInvalid failed:", error.message);
    return "awaiting_review";
  }

  const from = data?.from_value;
  if (
    typeof from === "string" &&
    REOPENABLE_STATUSES.has(from as OrderStatus)
  ) {
    return from as OrderStatus;
  }
  return "awaiting_review";
}

const REVERT_TARGET_STATUSES = new Set<OrderStatus>([
  "awaiting_review",
  "awaiting_confirm",
  "awaiting_shipment",
  "cod_shipped",
]);

function isValidRevertTarget(
  currentStatus: OrderStatus,
  previousStatus: OrderStatus,
): boolean {
  if (currentStatus === "cancelled") {
    return REOPENABLE_STATUSES.has(previousStatus);
  }
  return REVERT_TARGET_STATUSES.has(previousStatus);
}

/** 从审计日志推断上一步履约状态 */
async function resolvePreviousStatus(
  supabase: ServiceClient,
  orderId: string,
  currentStatus: OrderStatus,
): Promise<OrderStatus | null> {
  if (!canRevertCodOrder("cod", currentStatus)) return null;

  if (currentStatus === "cancelled") {
    return resolveStatusBeforeInvalid(supabase, orderId);
  }

  const { data, error } = await supabase
    .from("audit_logs")
    .select("from_value")
    .eq("entity_type", "order")
    .eq("entity_id", orderId)
    .eq("action", "status_change")
    .eq("to_value", currentStatus)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("resolvePreviousStatus failed:", error.message);
  } else if (typeof data?.from_value === "string") {
    const from = data.from_value as OrderStatus;
    if (isValidRevertTarget(currentStatus, from)) {
      return from;
    }
  }

  return COD_REVERT_FALLBACK[currentStatus] ?? null;
}

function buildCodRevertPatch(
  currentStatus: OrderStatus,
  previousStatus: OrderStatus,
  actor: Actor,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: previousStatus,
    updated_by: actor.id,
  };
  const backToReview = previousStatus === "awaiting_review";

  if (currentStatus === "cancelled") {
    patch.review_status = backToReview ? "pending" : "approved";
    patch.reject_reason = null;
    patch.reviewed_by = backToReview ? null : actor.id;
    patch.reviewed_at = backToReview ? null : now;
  } else if (backToReview) {
    patch.review_status = "pending";
    patch.reviewed_by = null;
    patch.reviewed_at = null;
  } else {
    patch.review_status = "approved";
  }

  if (currentStatus === "cod_shipped" && previousStatus === "awaiting_shipment") {
    patch.shipper_id = null;
    patch.shipper_name = null;
    patch.shipper_phone = null;
    patch.shipper_province = null;
    patch.shipper_city = null;
    patch.shipper_district = null;
    patch.shipper_address = null;
    patch.shipper_address_info = null;
    patch.shipping_order_no = null;
    patch.consignor_flag = null;
    patch.consignor_name = null;
    patch.consignor_phone = null;
  }

  return patch;
}

/** COD 订单恢复上一步状态 */
async function applyCodRevertStep(
  supabase: ServiceClient,
  order: {
    id: string;
    status: string;
    payment_type: string;
    review_status: string;
  },
  actor: Actor,
  remark?: string | null,
): Promise<
  { ok: true; previousStatus: OrderStatus } | { ok: false; error: string }
> {
  if (order.payment_type !== "cod") {
    return { ok: false, error: "非货到付款订单不支持恢复上一步" };
  }

  const currentStatus = order.status as OrderStatus;
  if (!canRevertCodOrder("cod", currentStatus)) {
    return { ok: false, error: "当前状态不可恢复上一步" };
  }

  const previousStatus = await resolvePreviousStatus(
    supabase,
    order.id,
    currentStatus,
  );
  if (!previousStatus) {
    return { ok: false, error: "无法确定上一步状态" };
  }

  const patch = buildCodRevertPatch(currentStatus, previousStatus, actor);
  const auditRemark = remark ?? "恢复上一步状态";

  const { error: updateError } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", order.id);

  if (updateError) return { ok: false, error: updateError.message };

  const prevReview = order.review_status as ReviewStatus;
  const nextReview = patch.review_status as ReviewStatus | undefined;
  if (nextReview && nextReview !== prevReview) {
    await writeAuditLog(supabase, {
      entityType: "order",
      entityId: order.id,
      action: "review",
      actor,
      fromValue: prevReview,
      toValue: nextReview,
      remark: auditRemark,
    });
  }

  if (currentStatus !== previousStatus) {
    await writeAuditLog(supabase, {
      entityType: "order",
      entityId: order.id,
      action: "status_change",
      actor,
      fromValue: currentStatus,
      toValue: previousStatus,
      remark: auditRemark,
    });
  }

  return { ok: true, previousStatus };
}

/** COD 无效订单 → 恢复作废前状态 */
async function applyCodReopen(
  supabase: ServiceClient,
  order: {
    id: string;
    status: string;
    payment_type: string;
    review_status: string;
  },
  actor: Actor,
  remark?: string | null,
): Promise<{ ok: true; restoredStatus: OrderStatus } | { ok: false; error: string }> {
  if (order.payment_type !== "cod") {
    return { ok: false, error: "非货到付款订单无需恢复" };
  }
  if (order.review_status !== "rejected" && order.status !== "cancelled") {
    return { ok: false, error: "仅无效订单可恢复" };
  }

  const result = await applyCodRevertStep(
    supabase,
    order,
    actor,
    remark ?? "无效订单恢复原先状态",
  );
  if (!result.ok) return result;
  return { ok: true, restoredStatus: result.previousStatus };
}

/** COD 待确认 → 待发货 */
async function applyCodConfirm(
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
    return { ok: false, error: "非货到付款订单不可确认" };
  }
  if (order.status !== "awaiting_confirm") {
    return { ok: false, error: "仅待确认订单可确认" };
  }
  if (order.review_status !== "approved") {
    return { ok: false, error: "订单审核未通过，无法确认" };
  }

  const from = order.status as OrderStatus;
  const to: OrderStatus = "awaiting_shipment";
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
    remark: "确认订单，进入待发货",
  });

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
  options?: { skipAudit?: boolean },
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

  if (!options?.skipAudit) {
    await writeAuditLog(supabase, {
      entityType: "order",
      entityId: order.id,
      action: "status_change",
      actor,
      fromValue: from,
      toValue: to,
      remark: `批量发货；运单号：${shippingOrderNo}；归属成员：${ownerMember}；寄件人：${shipper.name}`,
    });
  }

  return { ok: true };
}

const BATCH_CONCURRENCY = 15;
const MAX_BATCH_STATUS_IDS = 100;

type BatchOrderRow = {
  id: string;
  status: string;
  payment_type: string;
  review_status: string;
  product_id: string | null;
};

type BatchAccessOrder = Pick<BatchOrderRow, "id" | "product_id">;

type BatchOutcome = {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
};

async function runParallel<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

function auditStatusChange(
  actor: Actor,
  orderId: string,
  fromValue: string,
  toValue: string,
  remark?: string | null,
): WriteAuditInput {
  return {
    entityType: "order",
    entityId: orderId,
    action: "status_change",
    actor,
    fromValue,
    toValue,
    remark: remark ?? null,
  };
}

function auditReviewChange(
  actor: Actor,
  orderId: string,
  fromValue: string,
  toValue: string,
  remark?: string | null,
): WriteAuditInput {
  return {
    entityType: "order",
    entityId: orderId,
    action: "review",
    actor,
    fromValue,
    toValue,
    remark: remark ?? null,
  };
}

async function bulkUpdateOrders(
  supabase: ServiceClient,
  ids: string[],
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true };
  const { error } = await supabase.from("orders").update(patch).in("id", ids);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** 批量推断无效前的履约状态 */
async function resolveStatusBeforeInvalidBatch(
  supabase: ServiceClient,
  orderIds: string[],
): Promise<Map<string, OrderStatus>> {
  const result = new Map<string, OrderStatus>();
  for (const id of orderIds) {
    result.set(id, "awaiting_review");
  }
  if (orderIds.length === 0) return result;

  const { data, error } = await supabase
    .from("audit_logs")
    .select("entity_id, from_value, created_at")
    .eq("entity_type", "order")
    .in("entity_id", orderIds)
    .eq("action", "status_change")
    .eq("to_value", "cancelled")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("resolveStatusBeforeInvalidBatch failed:", error.message);
    return result;
  }

  for (const row of data ?? []) {
    const entityId = row.entity_id as string;
    if (result.get(entityId) !== "awaiting_review") continue;
    const from = row.from_value;
    if (
      typeof from === "string" &&
      REOPENABLE_STATUSES.has(from as OrderStatus)
    ) {
      result.set(entityId, from as OrderStatus);
    }
  }
  return result;
}

/** 批量推断上一步履约状态 */
async function resolvePreviousStatusBatch(
  supabase: ServiceClient,
  orders: Array<{ id: string; status: OrderStatus }>,
): Promise<Map<string, OrderStatus | null>> {
  const result = new Map<string, OrderStatus | null>();

  for (const order of orders) {
    if (!canRevertCodOrder("cod", order.status)) {
      result.set(order.id, null);
      continue;
    }
    result.set(order.id, COD_REVERT_FALLBACK[order.status] ?? null);
  }

  const cancelledIds = orders
    .filter((o) => o.status === "cancelled")
    .map((o) => o.id);
  if (cancelledIds.length > 0) {
    const cancelledMap = await resolveStatusBeforeInvalidBatch(
      supabase,
      cancelledIds,
    );
    for (const [id, status] of cancelledMap) {
      result.set(id, status);
    }
  }

  const revertibleIds = orders
    .filter((o) => canRevertCodOrder("cod", o.status) && o.status !== "cancelled")
    .map((o) => o.id);
  if (revertibleIds.length === 0) return result;

  const { data, error } = await supabase
    .from("audit_logs")
    .select("entity_id, from_value, to_value, created_at")
    .eq("entity_type", "order")
    .in("entity_id", revertibleIds)
    .eq("action", "status_change")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("resolvePreviousStatusBatch failed:", error.message);
    return result;
  }

  const currentById = new Map(orders.map((o) => [o.id, o.status]));
  const resolved = new Set<string>();

  for (const row of data ?? []) {
    const entityId = row.entity_id as string;
    if (resolved.has(entityId)) continue;
    const currentStatus = currentById.get(entityId);
    if (!currentStatus || row.to_value !== currentStatus) continue;

    const from = row.from_value;
    if (
      typeof from === "string" &&
      isValidRevertTarget(currentStatus, from as OrderStatus)
    ) {
      result.set(entityId, from as OrderStatus);
      resolved.add(entityId);
    }
  }

  return result;
}

function partitionBatchOrders<T extends BatchAccessOrder>(
  ids: string[],
  byId: Map<string, T>,
  accessChecker: Awaited<ReturnType<typeof createOrderAccessChecker>>,
): {
  eligible: T[];
  outcome: BatchOutcome;
} {
  const outcome: BatchOutcome = { succeeded: [], failed: [] };
  const eligible: T[] = [];

  for (const id of ids) {
    const order = byId.get(id);
    if (!order) {
      outcome.failed.push({ id, error: "订单不存在" });
      continue;
    }
    const access = accessChecker.check(order);
    if (!access.ok) {
      outcome.failed.push({ id, error: access.error });
      continue;
    }
    eligible.push(order);
  }

  return { eligible, outcome };
}

function markBulkUpdateFailure(
  orders: BatchAccessOrder[],
  outcome: BatchOutcome,
  error: string,
): void {
  for (const order of orders) {
    outcome.failed.push({ id: order.id, error });
  }
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
  const customerPhone = phoneSearchDigits(c.req.query("customer_phone") ?? "");
  const customerPhones = parsePhones(c.req.query("customer_phones"));
  const shippingOrderNo = c.req.query("shipping_order_no")?.trim();
  const shippingOrderNos = parseOrderNos(c.req.query("shipping_order_nos"));
  const reviewStatus = c.req.query("review_status")?.trim();
  const paymentType = c.req.query("payment_type")?.trim();
  const dateFrom = c.req.query("date_from")?.trim();
  const dateTo = c.req.query("date_to")?.trim();
  const regionId = c.req.query("region_id")?.trim();

  const supabase = createServiceClient(c.env);
  let query = supabase
    .from("orders")
    .select(ORDER_LIST_SELECT, { count: "estimated" })
    .order("created_at", { ascending: false })
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

  // 批量订单号 / 手机号 / 运单号匹配时，不按子状态收窄，便于跨 Tab 查出结果
  const batchByOrderNo = orderNos.length > 0;
  const batchByPhone = !batchByOrderNo && customerPhones.length > 0;
  const batchByShipping =
    !batchByOrderNo && !batchByPhone && shippingOrderNos.length > 0;
  const isBatchLookup = batchByOrderNo || batchByPhone || batchByShipping;
  if (!isBatchLookup && status) {
    if (!isOrderStatus(status)) {
      return c.json({ error: `无效的订单状态：${status}` }, 400);
    }
    query = query.eq("status", status);
  }
  if (batchByOrderNo) {
    query = query.in("order_no", orderNos);
  } else if (batchByPhone) {
    // 包含匹配：兼容本地号与国际区号前缀差异
    query = query.or(
      customerPhones
        .map((p) => `customer_phone.ilike.%${p}%`)
        .join(","),
    );
  } else if (batchByShipping) {
    query = query.in("shipping_order_no", shippingOrderNos);
  } else if (orderNo) {
    // 前缀匹配可走 order_no btree；中间模糊会全表扫描
    query = query.ilike("order_no", `${orderNo}%`);
  } else if (customerPhone) {
    query = query.ilike("customer_phone", `%${customerPhone}%`);
  } else if (shippingOrderNo) {
    query = query.ilike("shipping_order_no", `${shippingOrderNo}%`);
  }
  if (!isBatchLookup && reviewStatus) {
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
  // 按订单创建日期筛选日期区间
  if (dateFrom) {
    const from = new Date(dateFrom);
    if (Number.isNaN(from.getTime())) {
      return c.json({ error: "开始日期无效" }, 400);
    }
    query = query.gte("created_at", from.toISOString());
  }
  if (dateTo) {
    const to = new Date(dateTo);
    if (Number.isNaN(to.getTime())) {
      return c.json({ error: "结束日期无效" }, 400);
    }
    query = query.lte("created_at", to.toISOString());
  }
  if (regionId) {
    try {
      const regionProductIds = await listProductIdsByRegion(
        supabase,
        c,
        regionId,
      );
      if (regionProductIds === "empty") {
        return c.json({ data: [], total: 0, page, pageSize });
      }
      query = query.in("product_id", regionProductIds);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "地区筛选失败" },
        500,
      );
    }
  }

  const { data, error, count } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const rows = data ?? [];
  // 列表仅需审核人；与币种并行，缩短串行往返
  const [withActors, withCurrency] = await Promise.all([
    attachActors(supabase, rows, ["reviewed_by"]),
    attachOrderCurrency(supabase, rows),
  ]);

  const dataOut = withActors.map((row, i) => ({
    ...row,
    currency: withCurrency[i]?.currency ?? null,
  }));

  return c.json({
    data: dataOut,
    total: count ?? 0,
    page,
    pageSize,
  });
});

/** 财务导出筛选项：有权限的商品 +（管理员）已出现的归属成员 */
ordersRoutes.get("/finance-export/meta", async (c) => {
  const statusRaw = c.req.query("status")?.trim();
  const status =
    statusRaw === "cod_shipped" ||
    statusRaw === "cod_completed" ||
    statusRaw === "awaiting_confirm"
      ? statusRaw
      : "cod_shipped";
  const regionId = c.req.query("region_id")?.trim();

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
    if (regionId) {
      if (regionId === REGION_UNSET) {
        productQuery = productQuery.is("region_id", null);
      } else {
        productQuery = productQuery.eq("region_id", regionId);
      }
    }
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
      .eq("status", status)
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
 * 已发货订单财务导出数据（对齐财务系统导出模板列）。
 * 沿用列表页当前筛选（日期 / 订单号 / 手机号等），弹窗仅再选商品。
 */
ordersRoutes.post("/finance-export", async (c) => {
  const body = (await c.req.json()) as {
    date_from?: unknown;
    date_to?: unknown;
    product_ids?: unknown;
    owner_members?: unknown;
    region_id?: unknown;
    order_no?: unknown;
    order_nos?: unknown;
    customer_phone?: unknown;
    customer_phones?: unknown;
    shipping_order_no?: unknown;
    shipping_order_nos?: unknown;
  };

  const listFilters = parseExportListFilters(body);
  if (!listFilters.ok) return c.json({ error: listFilters.error }, 400);

  const productIds = parseCsvIds(body.product_ids);
  const ownerMembers = parseCsvIds(body.owner_members, 200);
  const regionId =
    typeof body.region_id === "string" ? body.region_id.trim() : "";

  if (ownerMembers.length > 0 && !isSuperAdmin(c)) {
    return c.json({ error: "仅管理员可按归属成员筛选导出" }, 403);
  }

  const supabase = createServiceClient(c.env);

  let filterProductIds: string[] | null | "empty";
  try {
    filterProductIds = await resolveFilterProductIds(supabase, c, {
      productIds,
      regionId: regionId || undefined,
    });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  if (filterProductIds === "empty") {
    return c.json({ data: [], total: 0 });
  }

  let query = supabase
    .from("orders")
    .select(FINANCE_EXPORT_SELECT)
    .eq("payment_type", "cod")
    .eq("status", "cod_shipped")
    .order("created_at", { ascending: false })
    .limit(FINANCE_EXPORT_MAX_ROWS);

  query = applyExportListFilters(query, listFilters.filters);

  if (filterProductIds) {
    query = query.in("product_id", filterProductIds);
  }
  if (ownerMembers.length > 0) {
    query = query.in("owner_member", ownerMembers);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const rows = (data ?? []).map((row) => {
    const qty = orderPurchaseQty(row);
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
      sku_quantity: formatSkuQuantity(row),
      quantity: qty,
    };
  });

  return c.json({
    data: rows,
    total: rows.length,
    truncated: rows.length >= FINANCE_EXPORT_MAX_ROWS,
  });
});

const LOGISTICS_EXPORT_MAX = FINANCE_EXPORT_MAX_ROWS;

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumberOrEmpty(value: unknown): number | "" {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : "";
}

/** 购买份数（套餐份数）；无效时按 1 */
function orderPurchaseQty(row: { quantity?: unknown }): number {
  const n =
    typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * 「中文属性*数量」用件数：套餐明细数量(package_count) × 购买份数(quantity)。
 * 下单时 package_count 存的是套餐内 SUM(item.quantity)，不是快递件数。
 */
function orderSkuUnits(row: {
  quantity?: unknown;
  package_count?: unknown;
}): number {
  const purchaseQty = orderPurchaseQty(row);
  const pkg =
    typeof row.package_count === "number"
      ? row.package_count
      : Number(row.package_count);
  const perPackage = Number.isFinite(pkg) && pkg > 0 ? Math.floor(pkg) : 1;
  return perPackage * purchaseQty;
}

function formatSkuQuantity(row: {
  sku_code?: unknown;
  quantity?: unknown;
  package_count?: unknown;
}): string {
  const sku = asText(row.sku_code);
  if (!sku) return "";
  return `${sku} * ${orderSkuUnits(row)}`;
}

/**
 * 待确认 / 已发货 / 已签收物流导出。
 * 仅返回极兔模板标红列所需订单数据（收件人/电话/地区/地址/中文属性*数量/备注/电商订单号/代收货款）；
 * 寄件人等非标红列由前端按模板固定文本填充。
 * 沿用列表页当前筛选（日期 / 订单号 / 手机号等），弹窗仅再选商品。
 */
ordersRoutes.post("/logistics-export", async (c) => {
  const body = (await c.req.json()) as {
    status?: unknown;
    date_from?: unknown;
    date_to?: unknown;
    product_ids?: unknown;
    owner_members?: unknown;
    region_id?: unknown;
    order_no?: unknown;
    order_nos?: unknown;
    customer_phone?: unknown;
    customer_phones?: unknown;
    shipping_order_no?: unknown;
    shipping_order_nos?: unknown;
  };

  const status =
    body.status === "cod_shipped" ||
    body.status === "cod_completed" ||
    body.status === "awaiting_confirm"
      ? body.status
      : null;
  if (!status) {
    return c.json({ error: "仅支持待确认、已发货或已签收导出" }, 400);
  }

  const listFilters = parseExportListFilters(body);
  if (!listFilters.ok) return c.json({ error: listFilters.error }, 400);

  const productIds = parseCsvIds(body.product_ids);
  const ownerMembers = parseCsvIds(body.owner_members, 200);
  const regionId =
    typeof body.region_id === "string" ? body.region_id.trim() : "";

  if (ownerMembers.length > 0 && !isSuperAdmin(c)) {
    return c.json({ error: "仅管理员可按归属成员筛选导出" }, 403);
  }

  const supabase = createServiceClient(c.env);

  let filterProductIds: string[] | null | "empty";
  try {
    filterProductIds = await resolveFilterProductIds(supabase, c, {
      productIds,
      regionId: regionId || undefined,
    });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  if (filterProductIds === "empty") {
    return c.json({ data: [], total: 0 });
  }

  let query = supabase
    .from("orders")
    .select(LOGISTICS_EXPORT_SELECT)
    .eq("payment_type", "cod")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(LOGISTICS_EXPORT_MAX);

  query = applyExportListFilters(query, listFilters.filters);

  if (filterProductIds) {
    query = query.in("product_id", filterProductIds);
  }
  if (ownerMembers.length > 0) {
    query = query.in("owner_member", ownerMembers);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const province = asText(row.shipping_province);
    const city = asText(row.shipping_city);
    const district = asText(row.shipping_district);
    const detail =
      asText(row.shipping_detail) || asText(row.shipping_address);
    // 模板样例：「省,市,区,明细」
    const shippingAddress = [province, city, district, detail]
      .filter(Boolean)
      .join(",");
    const codAmount = asNumberOrEmpty(row.cod_amount);
    const totalAmount = asNumberOrEmpty(row.total_amount);

    return {
      customer_name: asText(row.customer_name),
      customer_phone: asText(row.customer_phone),
      shipping_district: district,
      shipping_address: shippingAddress,
      sku_quantity: formatSkuQuantity(row),
      remark: asText(row.remark),
      order_no: asText(row.order_no),
      cod_amount: codAmount === "" ? totalAmount : codAmount,
    };
  });

  return c.json({
    data: rows,
    total: rows.length,
    truncated: rows.length >= LOGISTICS_EXPORT_MAX,
  });
});

/**
 * 全部订单导出：按当前列表筛选导出 COD 订单完整业务字段。
 * 沿用列表页筛选（日期 / 订单号 / 手机号等），弹窗可再按商品收窄。
 */
ordersRoutes.post("/full-export", async (c) => {
  const body = (await c.req.json()) as {
    date_from?: unknown;
    date_to?: unknown;
    product_ids?: unknown;
    region_id?: unknown;
    order_no?: unknown;
    order_nos?: unknown;
    customer_phone?: unknown;
    customer_phones?: unknown;
    shipping_order_no?: unknown;
    shipping_order_nos?: unknown;
  };

  const listFilters = parseExportListFilters(body);
  if (!listFilters.ok) return c.json({ error: listFilters.error }, 400);

  const productIds = parseCsvIds(body.product_ids);
  const regionId =
    typeof body.region_id === "string" ? body.region_id.trim() : "";

  const supabase = createServiceClient(c.env);

  let filterProductIds: string[] | null | "empty";
  try {
    filterProductIds = await resolveFilterProductIds(supabase, c, {
      productIds,
      regionId: regionId || undefined,
    });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  if (filterProductIds === "empty") {
    return c.json({ data: [], total: 0 });
  }

  let query = supabase
    .from("orders")
    .select(FULL_EXPORT_SELECT)
    .eq("payment_type", "cod")
    .order("created_at", { ascending: false })
    .limit(FINANCE_EXPORT_MAX_ROWS);

  query = applyExportListFilters(query, listFilters.filters);

  if (filterProductIds) {
    query = query.in("product_id", filterProductIds);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const rawRows = (data ?? []) as Array<
    Record<string, unknown> & {
      product_id?: string | null;
      sku_code?: unknown;
      quantity?: unknown;
      package_count?: unknown;
    }
  >;
  const withCurrency = await attachOrderCurrency(supabase, rawRows);

  const rows = withCurrency.map((row) => {
    const status = asText(row.status) as OrderStatus;
    const reviewStatus = asText(row.review_status) as ReviewStatus;
    const paymentType = asText(row.payment_type) as PaymentType;
    const province = asText(row.shipping_province);
    const city = asText(row.shipping_city);
    const district = asText(row.shipping_district);
    const detail =
      asText(row.shipping_detail) || asText(row.shipping_address);
    const shippingFull = [province, city, district, detail]
      .filter(Boolean)
      .join(" ");
    const currency = row.currency;

    return {
      order_no: asText(row.order_no),
      shipping_order_no: asText(row.shipping_order_no),
      status_label: ORDER_STATUS_LABELS[status] ?? asText(row.status),
      review_status_label:
        REVIEW_STATUS_LABELS[reviewStatus] ?? asText(row.review_status),
      payment_type_label:
        PAYMENT_TYPE_LABELS[paymentType] ?? asText(row.payment_type),
      payment_method: asText(row.payment_method),
      customer_name: asText(row.customer_name),
      customer_phone: asText(row.customer_phone),
      shipping_province: province,
      shipping_city: city,
      shipping_district: district,
      shipping_detail: asText(row.shipping_detail),
      shipping_address: asText(row.shipping_address),
      shipping_full: shippingFull,
      product_name: asText(row.product_name),
      package_name: asText(row.package_name),
      package_name_external: asText(row.package_name_external),
      sku_code: asText(row.sku_code),
      sku_quantity: formatSkuQuantity(row),
      unit_price: asNumberOrEmpty(row.unit_price),
      quantity: orderPurchaseQty(row),
      package_count: asNumberOrEmpty(row.package_count),
      total_amount: asNumberOrEmpty(row.total_amount),
      cod_amount: asNumberOrEmpty(row.cod_amount),
      shipping_fee: asNumberOrEmpty(row.shipping_fee),
      other_fee: asNumberOrEmpty(row.other_fee),
      currency_code: asText(currency?.code),
      currency_symbol: asText(currency?.symbol),
      owner_member: asText(row.owner_member),
      remark: asText(row.remark),
      reject_reason: asText(row.reject_reason),
      weight: asNumberOrEmpty(row.weight),
      express_type: asText(row.express_type),
      insurance_type: asText(row.insurance_type),
      insurance_flag: asText(row.insurance_flag),
      item_value: asNumberOrEmpty(row.item_value),
      item_category: asText(row.item_category),
      item_type: asText(row.item_type),
      consignor_flag: asText(row.consignor_flag),
      consignor_name: asText(row.consignor_name),
      consignor_phone: asText(row.consignor_phone),
      shipper_name: asText(row.shipper_name),
      shipper_phone: asText(row.shipper_phone),
      shipper_province: asText(row.shipper_province),
      shipper_city: asText(row.shipper_city),
      shipper_district: asText(row.shipper_district),
      shipper_address: asText(row.shipper_address),
      shipper_address_info: asText(row.shipper_address_info),
      reviewed_at: asText(row.reviewed_at),
      created_at: asText(row.created_at),
      updated_at: asText(row.updated_at),
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

function optionalTrimmedString(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || null;
}

function requiredTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

/** 套餐内商品件数：SUM(item.quantity)，至少为 1 */
async function resolvePackageItemCount(
  supabase: ServiceClient,
  packageId: string,
): Promise<number> {
  const { data: items, error } = await supabase
    .from("product_package_items")
    .select("quantity")
    .eq("package_id", packageId);
  if (error) throw new Error(error.message);
  const sum = (items ?? []).reduce((acc, row) => {
    const n =
      typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    return acc + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
  return Math.max(1, sum || 1);
}

/**
 * 编辑订单基础信息。
 * 更换商品/套餐时，product_name、sku_code、套餐名、单价、package_count 等一律按商品实际数据同步，不信任前端快照。
 */
ordersRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as Record<string, unknown>;
  const actor = actorFrom(c);

  const supabase = createServiceClient(c.env);
  const { data: before, error: beforeError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (beforeError) return c.json({ error: beforeError.message }, 500);
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

  const patch: Record<string, unknown> = { updated_by: actor.id };
  let touched = false;

  if (body.customer_name !== undefined) {
    const name = requiredTrimmedString(body.customer_name);
    if (!name) return c.json({ error: "收件人不能为空" }, 400);
    patch.customer_name = name;
    touched = true;
  }

  for (const key of [
    "customer_phone",
    "shipping_province",
    "shipping_city",
    "shipping_district",
    "shipping_detail",
    "shipping_address",
    "owner_member",
    "shipping_order_no",
    "remark",
  ] as const) {
    if (body[key] === undefined) continue;
    const v = optionalTrimmedString(body[key]);
    if (v === undefined) return c.json({ error: `${key} 格式无效` }, 400);
    patch[key] = v;
    touched = true;
  }

  let quantity =
    typeof before.quantity === "number"
      ? before.quantity
      : Number(before.quantity) || 1;
  if (body.quantity !== undefined) {
    const q =
      typeof body.quantity === "number"
        ? body.quantity
        : Number(body.quantity);
    if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
      return c.json({ error: "购买数量须为正整数" }, 400);
    }
    quantity = q;
    patch.quantity = quantity;
    touched = true;
  }

  const productIdChanging = body.product_id !== undefined;
  const packageIdChanging = body.package_id !== undefined;
  let productId =
    typeof before.product_id === "string" ? before.product_id : null;
  let unitPrice =
    typeof before.unit_price === "number"
      ? before.unit_price
      : Number(before.unit_price) || 0;
  let packageCount =
    typeof before.package_count === "number"
      ? before.package_count
      : Number(before.package_count) || 1;
  let productWeight = 1;

  if (productIdChanging || packageIdChanging) {
    if (productIdChanging) {
      const nextProductId = requiredTrimmedString(body.product_id);
      if (!nextProductId) return c.json({ error: "请选择商品" }, 400);
      productId = nextProductId;
    }
    if (!productId) {
      return c.json({ error: "订单未关联商品，无法更换套餐" }, 400);
    }

    try {
      const access = await assertProductAccess(supabase, productId, c);
      if (!access.ok) return c.json({ error: access.error }, access.status);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "权限校验失败" },
        500,
      );
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, sku_code, price, packages_enabled, weight, status")
      .eq("id", productId)
      .maybeSingle();
    if (productError) return c.json({ error: productError.message }, 500);
    if (!product) return c.json({ error: "商品不存在" }, 404);
    if (
      product.status === "off_sale" &&
      product.id !== before.product_id
    ) {
      return c.json({ error: "商品已删除，无法选用" }, 400);
    }

    productWeight =
      typeof product.weight === "number" && product.weight >= 0
        ? product.weight
        : Number(product.weight) || 1;

    patch.product_id = product.id;
    patch.product_name = product.name;
    patch.sku_code =
      typeof product.sku_code === "string" && product.sku_code.trim()
        ? product.sku_code.trim()
        : null;
    touched = true;

    const { data: packages, error: packagesError } = await supabase
      .from("product_packages")
      .select("id, name, name_external, original_price, discount_price")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });
    if (packagesError) return c.json({ error: packagesError.message }, 500);

    const usePackages =
      Boolean(product.packages_enabled) && (packages ?? []).length > 0;

    let nextPackageId: string | null = null;
    if (packageIdChanging) {
      if (body.package_id === null || body.package_id === "") {
        nextPackageId = null;
      } else {
        nextPackageId = requiredTrimmedString(body.package_id);
        if (!nextPackageId) return c.json({ error: "套餐无效" }, 400);
      }
    } else if (productIdChanging) {
      // 换商品且未指定套餐：有套餐则要求显式选择
      nextPackageId = null;
    } else {
      nextPackageId =
        typeof before.package_id === "string" ? before.package_id : null;
    }

    if (usePackages) {
      if (!nextPackageId) {
        return c.json({ error: "该商品已开启套餐，请选择套餐" }, 400);
      }
      const pkg = (packages ?? []).find((p) => p.id === nextPackageId);
      if (!pkg) {
        return c.json({ error: "套餐不存在或不属于该商品" }, 400);
      }
      try {
        packageCount = await resolvePackageItemCount(supabase, pkg.id);
      } catch (e) {
        return c.json(
          { error: e instanceof Error ? e.message : "读取套餐明细失败" },
          500,
        );
      }
      const priceRaw =
        pkg.discount_price != null ? pkg.discount_price : pkg.original_price;
      unitPrice =
        typeof priceRaw === "number" ? priceRaw : Number(priceRaw) || 0;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return c.json({ error: "套餐价格无效" }, 400);
      }
      patch.package_id = pkg.id;
      patch.package_name = pkg.name;
      patch.package_name_external = pkg.name_external;
      patch.unit_price = unitPrice;
      patch.package_count = packageCount;
    } else {
      if (nextPackageId) {
        return c.json({ error: "该商品未开启套餐，无需选择套餐" }, 400);
      }
      unitPrice =
        typeof product.price === "number"
          ? product.price
          : Number(product.price) || 0;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return c.json({ error: "商品价格无效" }, 400);
      }
      packageCount = 1;
      patch.package_id = null;
      patch.package_name = null;
      patch.package_name_external = null;
      patch.unit_price = unitPrice;
      patch.package_count = packageCount;
    }

    patch.weight = Number((productWeight * packageCount).toFixed(2));
  }

  // 数量或商品/套餐变更时重算金额
  if (
    body.quantity !== undefined ||
    productIdChanging ||
    packageIdChanging
  ) {
    const totalAmount = Number((unitPrice * quantity).toFixed(2));
    patch.total_amount = totalAmount;
    patch.item_value = totalAmount;
    if (before.payment_type === "cod") {
      patch.cod_amount = totalAmount;
    }
    touched = true;
  }

  // 结构化地址变更且未显式传 shipping_address 时自动拼接
  if (
    body.shipping_address === undefined &&
    (body.shipping_province !== undefined ||
      body.shipping_city !== undefined ||
      body.shipping_district !== undefined ||
      body.shipping_detail !== undefined)
  ) {
    const province =
      (patch.shipping_province as string | null | undefined) !== undefined
        ? (patch.shipping_province as string | null)
        : (before.shipping_province as string | null);
    const city =
      (patch.shipping_city as string | null | undefined) !== undefined
        ? (patch.shipping_city as string | null)
        : (before.shipping_city as string | null);
    const district =
      (patch.shipping_district as string | null | undefined) !== undefined
        ? (patch.shipping_district as string | null)
        : (before.shipping_district as string | null);
    const detail =
      (patch.shipping_detail as string | null | undefined) !== undefined
        ? (patch.shipping_detail as string | null)
        : (before.shipping_detail as string | null);
    const composed = [province, city, district, detail]
      .filter((x): x is string => Boolean(x && String(x).trim()))
      .join(" ");
    patch.shipping_address = composed || null;
  }

  if (!touched) {
    return c.json({ error: "没有需要更新的字段" }, 400);
  }

  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "订单不存在" }, 404);

  await writeAuditLog(supabase, {
    entityType: "order",
    entityId: id,
    action: "order_update",
    actor,
    changes: {
      before: {
        customer_name: before.customer_name,
        customer_phone: before.customer_phone,
        product_id: before.product_id,
        product_name: before.product_name,
        package_id: before.package_id,
        package_name: before.package_name,
        sku_code: before.sku_code,
        quantity: before.quantity,
        unit_price: before.unit_price,
        total_amount: before.total_amount,
      },
      after: {
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        product_id: data.product_id,
        product_name: data.product_name,
        package_id: data.package_id,
        package_name: data.package_name,
        sku_code: data.sku_code,
        quantity: data.quantity,
        unit_price: data.unit_price,
        total_amount: data.total_amount,
      },
    },
  });

  return c.json(
    await attachOrderCurrencyOne(
      supabase,
      await attachActorsOne(supabase, data),
    ),
  );
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
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json({ error: `单次最多审核 ${MAX_BATCH_STATUS_IDS} 笔订单` }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const reason =
    typeof body.remark === "string" ? body.remark.trim() : body.remark == null ? "" : "";
  if (body.decision === "rejected" && !reason) {
    return c.json({ error: "标记无效订单前请填写拒绝理由" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const [accessChecker, ordersResult] = await Promise.all([
    createOrderAccessChecker(supabase, c),
    supabase
      .from("orders")
      .select("id, status, payment_type, review_status, product_id")
      .in("id", ids),
  ]);
  const { data: orders, error } = ordersResult;
  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const toUpdate: BatchOrderRow[] = [];
  const auditEntries: WriteAuditInput[] = [];
  const nextReview = body.decision as ReviewStatus;
  const nextFulfillment =
    nextReview === "approved" ? "awaiting_confirm" : "cancelled";
  const now = new Date().toISOString();

  for (const order of eligible) {
    if (order.payment_type !== "cod") {
      outcome.failed.push({ id: order.id, error: "非货到付款订单无需审核" });
      continue;
    }
    if (order.review_status !== "pending") {
      outcome.failed.push({ id: order.id, error: "当前订单不在待审核状态" });
      continue;
    }
    toUpdate.push(order);
  }

  if (toUpdate.length > 0) {
    const updateIds = toUpdate.map((o) => o.id);
    const patch: Record<string, unknown> = {
      review_status: nextReview,
      status: nextFulfillment,
      reviewed_by: actor.id,
      reviewed_at: now,
      updated_by: actor.id,
    };
    if (body.decision === "rejected") {
      patch.reject_reason = reason;
    }

    const bulk = await bulkUpdateOrders(supabase, updateIds, patch);
    if (!bulk.ok) {
      markBulkUpdateFailure(toUpdate, outcome, bulk.error);
    } else {
      for (const order of toUpdate) {
        outcome.succeeded.push(order.id);
        auditEntries.push(
          auditReviewChange(actor, order.id, "pending", nextReview, reason || null),
        );
        if (order.status !== nextFulfillment) {
          auditEntries.push(
            auditStatusChange(
              actor,
              order.id,
              order.status,
              nextFulfillment,
              nextReview === "approved"
                ? "COD 审核通过，自动进入待确认"
                : reason || "标记为无效订单",
            ),
          );
        }
      }
      await writeAuditLogs(supabase, auditEntries);
    }
  }

  return c.json({ succeeded: outcome.succeeded, failed: outcome.failed });
});

/** 批量填写订单备注 */
ordersRoutes.post("/batch-remark", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown; remark?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要填写备注的订单" }, 400);
  }
  if (body.ids.length > 100) {
    return c.json({ error: "单次最多填写 100 笔订单备注" }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  if (body.remark !== undefined && body.remark !== null && typeof body.remark !== "string") {
    return c.json({ error: "备注格式无效" }, 400);
  }
  const remark =
    typeof body.remark === "string" ? body.remark.trim() || null : null;
  if (remark && remark.length > 500) {
    return c.json({ error: "备注过长" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const [accessChecker, ordersResult] = await Promise.all([
    createOrderAccessChecker(supabase, c),
    supabase.from("orders").select("id, remark, product_id").in("id", ids),
  ]);
  const { data: orders, error } = ordersResult;
  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const auditEntries: WriteAuditInput[] = [];

  if (eligible.length > 0) {
    const updateIds = eligible.map((o) => o.id);
    const bulk = await bulkUpdateOrders(supabase, updateIds, {
      remark,
      updated_by: actor.id,
    });
    if (!bulk.ok) {
      markBulkUpdateFailure(eligible, outcome, bulk.error);
    } else {
      for (const order of eligible) {
        outcome.succeeded.push(order.id);
        auditEntries.push({
          entityType: "order",
          entityId: order.id,
          action: "remark_update",
          actor,
          fromValue: (order as { remark?: string | null }).remark ?? null,
          toValue: remark,
        });
      }
      await writeAuditLogs(supabase, auditEntries);
    }
  }

  return c.json({ succeeded: outcome.succeeded, failed: outcome.failed });
});

/** COD 待确认批量确认 → 待发货 */
ordersRoutes.post("/batch-confirm", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要确认的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json({ error: `单次最多确认 ${MAX_BATCH_STATUS_IDS} 笔订单` }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const [accessChecker, ordersResult] = await Promise.all([
    createOrderAccessChecker(supabase, c),
    supabase
      .from("orders")
      .select("id, status, payment_type, review_status, product_id")
      .in("id", ids),
  ]);
  const { data: orders, error } = ordersResult;
  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const toUpdate: BatchOrderRow[] = [];
  const auditEntries: WriteAuditInput[] = [];
  const to: OrderStatus = "awaiting_shipment";

  for (const order of eligible) {
    if (order.payment_type !== "cod") {
      outcome.failed.push({ id: order.id, error: "非货到付款订单不可确认" });
      continue;
    }
    if (order.status !== "awaiting_confirm") {
      outcome.failed.push({ id: order.id, error: "仅待确认订单可确认" });
      continue;
    }
    if (order.review_status !== "approved") {
      outcome.failed.push({ id: order.id, error: "订单审核未通过，无法确认" });
      continue;
    }
    toUpdate.push(order);
  }

  if (toUpdate.length > 0) {
    const bulk = await bulkUpdateOrders(
      supabase,
      toUpdate.map((o) => o.id),
      { status: to, updated_by: actor.id },
    );
    if (!bulk.ok) {
      markBulkUpdateFailure(toUpdate, outcome, bulk.error);
    } else {
      for (const order of toUpdate) {
        outcome.succeeded.push(order.id);
        auditEntries.push(
          auditStatusChange(
            actor,
            order.id,
            order.status,
            to,
            "确认订单，进入待发货",
          ),
        );
      }
      await writeAuditLogs(supabase, auditEntries);
    }
  }

  return c.json({ succeeded: outcome.succeeded, failed: outcome.failed });
});

/** COD 批量转无效订单（待审核 / 待确认 / 待发货） */
ordersRoutes.post("/batch-invalidate", async (c) => {
  const body = (await c.req.json()) as {
    ids?: unknown;
    reject_reason?: unknown;
  };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要标记无效的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json({ error: `单次最多标记 ${MAX_BATCH_STATUS_IDS} 笔订单` }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const rejectReason =
    typeof body.reject_reason === "string" ? body.reject_reason.trim() : "";
  if (!rejectReason) {
    return c.json({ error: "标记无效订单前请填写拒绝理由" }, 400);
  }
  if (rejectReason.length > 500) {
    return c.json({ error: "拒绝理由过长" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const [accessChecker, ordersResult] = await Promise.all([
    createOrderAccessChecker(supabase, c),
    supabase
      .from("orders")
      .select("id, status, payment_type, review_status, product_id")
      .in("id", ids),
  ]);
  const { data: orders, error } = ordersResult;
  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const pendingReview: BatchOrderRow[] = [];
  const cancelDirect: BatchOrderRow[] = [];
  const auditEntries: WriteAuditInput[] = [];
  const now = new Date().toISOString();

  for (const order of eligible) {
    if (order.payment_type !== "cod") {
      outcome.failed.push({ id: order.id, error: "非货到付款订单不可标记无效" });
      continue;
    }
    const from = order.status as OrderStatus;
    if (
      from !== "awaiting_review" &&
      from !== "awaiting_confirm" &&
      from !== "awaiting_shipment"
    ) {
      outcome.failed.push({
        id: order.id,
        error: "仅待审核、待确认、待发货订单可标记为无效",
      });
      continue;
    }
    if (from === "awaiting_review" || order.review_status === "pending") {
      pendingReview.push(order);
      continue;
    }
    const to: OrderStatus = "cancelled";
    if (!canTransitionOrder(from, to)) {
      outcome.failed.push({
        id: order.id,
        error: `不允许从「${from}」变更为无效订单`,
      });
      continue;
    }
    if (
      !canAdvanceCodOrder(
        order.payment_type as PaymentType,
        order.review_status as ReviewStatus,
        to,
      )
    ) {
      outcome.failed.push({
        id: order.id,
        error: "当前审核状态不允许标记为无效订单",
      });
      continue;
    }
    cancelDirect.push(order);
  }

  if (pendingReview.length > 0) {
    const updateIds = pendingReview.map((o) => o.id);
    const bulk = await bulkUpdateOrders(supabase, updateIds, {
      review_status: "rejected",
      status: "cancelled",
      reject_reason: rejectReason,
      reviewed_by: actor.id,
      reviewed_at: now,
      updated_by: actor.id,
    });
    if (!bulk.ok) {
      markBulkUpdateFailure(pendingReview, outcome, bulk.error);
    } else {
      for (const order of pendingReview) {
        outcome.succeeded.push(order.id);
        auditEntries.push(
          auditReviewChange(
            actor,
            order.id,
            "pending",
            "rejected",
            rejectReason,
          ),
        );
        if (order.status !== "cancelled") {
          auditEntries.push(
            auditStatusChange(
              actor,
              order.id,
              order.status,
              "cancelled",
              rejectReason,
            ),
          );
        }
      }
    }
  }

  if (cancelDirect.length > 0) {
    const updateIds = cancelDirect.map((o) => o.id);
    const bulk = await bulkUpdateOrders(supabase, updateIds, {
      status: "cancelled",
      review_status: "rejected",
      reject_reason: rejectReason,
      reviewed_by: actor.id,
      reviewed_at: now,
      updated_by: actor.id,
    });
    if (!bulk.ok) {
      markBulkUpdateFailure(cancelDirect, outcome, bulk.error);
    } else {
      for (const order of cancelDirect) {
        outcome.succeeded.push(order.id);
        auditEntries.push(
          auditStatusChange(
            actor,
            order.id,
            order.status,
            "cancelled",
            rejectReason,
          ),
        );
      }
    }
  }

  if (auditEntries.length > 0) {
    await writeAuditLogs(supabase, auditEntries);
  }

  return c.json({ succeeded: outcome.succeeded, failed: outcome.failed });
});

/** COD 已发货批量签收 → 已签收 */
ordersRoutes.post("/batch-complete", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要签收的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json({ error: `单次最多签收 ${MAX_BATCH_STATUS_IDS} 笔订单` }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const [accessChecker, ordersResult] = await Promise.all([
    createOrderAccessChecker(supabase, c),
    supabase
      .from("orders")
      .select("id, status, payment_type, review_status, product_id")
      .in("id", ids),
  ]);
  const { data: orders, error } = ordersResult;
  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const toUpdate: BatchOrderRow[] = [];
  const auditEntries: WriteAuditInput[] = [];
  const to: OrderStatus = "cod_completed";

  for (const order of eligible) {
    if (order.payment_type !== "cod") {
      outcome.failed.push({ id: order.id, error: "非货到付款订单不可 COD 签收" });
      continue;
    }
    if (order.status !== "cod_shipped") {
      outcome.failed.push({ id: order.id, error: "仅已发货订单可签收" });
      continue;
    }
    if (order.review_status !== "approved") {
      outcome.failed.push({ id: order.id, error: "订单审核未通过，无法签收" });
      continue;
    }
    toUpdate.push(order);
  }

  if (toUpdate.length > 0) {
    const bulk = await bulkUpdateOrders(
      supabase,
      toUpdate.map((o) => o.id),
      { status: to, updated_by: actor.id },
    );
    if (!bulk.ok) {
      markBulkUpdateFailure(toUpdate, outcome, bulk.error);
    } else {
      for (const order of toUpdate) {
        outcome.succeeded.push(order.id);
        auditEntries.push(
          auditStatusChange(actor, order.id, order.status, to, "批量签收"),
        );
      }
      await writeAuditLogs(supabase, auditEntries);
    }
  }

  return c.json({ succeeded: outcome.succeeded, failed: outcome.failed });
});

/** COD 已发货批量拒绝签收 → 拒绝签收 */
ordersRoutes.post("/batch-refuse", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要拒绝签收的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json(
      { error: `单次最多拒绝签收 ${MAX_BATCH_STATUS_IDS} 笔订单` },
      400,
    );
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const [accessChecker, ordersResult] = await Promise.all([
    createOrderAccessChecker(supabase, c),
    supabase
      .from("orders")
      .select("id, status, payment_type, review_status, product_id")
      .in("id", ids),
  ]);
  const { data: orders, error } = ordersResult;
  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const toUpdate: BatchOrderRow[] = [];
  const auditEntries: WriteAuditInput[] = [];
  const to: OrderStatus = "cod_refused";

  for (const order of eligible) {
    if (order.payment_type !== "cod") {
      outcome.failed.push({
        id: order.id,
        error: "非货到付款订单不可 COD 拒绝签收",
      });
      continue;
    }
    if (order.status !== "cod_shipped") {
      outcome.failed.push({ id: order.id, error: "仅已发货订单可拒绝签收" });
      continue;
    }
    if (order.review_status !== "approved") {
      outcome.failed.push({
        id: order.id,
        error: "订单审核未通过，无法拒绝签收",
      });
      continue;
    }
    toUpdate.push(order);
  }

  if (toUpdate.length > 0) {
    const bulk = await bulkUpdateOrders(
      supabase,
      toUpdate.map((o) => o.id),
      { status: to, updated_by: actor.id },
    );
    if (!bulk.ok) {
      markBulkUpdateFailure(toUpdate, outcome, bulk.error);
    } else {
      for (const order of toUpdate) {
        outcome.succeeded.push(order.id);
        auditEntries.push(
          auditStatusChange(
            actor,
            order.id,
            order.status,
            to,
            "批量拒绝签收",
          ),
        );
      }
      await writeAuditLogs(supabase, auditEntries);
    }
  }

  return c.json({ succeeded: outcome.succeeded, failed: outcome.failed });
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

  const [{ data: shipper, error: shipperError }, accessChecker] =
    await Promise.all([
      supabase.from("logistics_shipper").select("*").eq("id", shipperId).maybeSingle(),
      createOrderAccessChecker(supabase, c),
    ]);

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
  const auditEntries: WriteAuditInput[] = [];

  type ShipTask = {
    order: BatchOrderRow & { order_no: string };
    item: { order_no: string; shipping_order_no: string };
  };
  const tasks: ShipTask[] = [];

  for (const item of items) {
    const order = byOrderNo.get(item.order_no);
    if (!order) {
      failed.push({ order_no: item.order_no, error: "订单不存在" });
      continue;
    }
    const access = accessChecker.check(order);
    if (!access.ok) {
      failed.push({ order_no: item.order_no, error: access.error });
      continue;
    }
    tasks.push({ order, item });
  }

  await runParallel(tasks, BATCH_CONCURRENCY, async ({ order, item }) => {
    const result = await applyCodShip(
      supabase,
      order,
      actor,
      {
        shipping_order_no: item.shipping_order_no,
        owner_member: ownerMember,
        shipper: shipperSnap,
      },
      { skipAudit: true },
    );
    if (result.ok) {
      succeeded.push({ id: order.id, order_no: item.order_no });
      auditEntries.push(
        auditStatusChange(
          actor,
          order.id,
          order.status,
          "cod_shipped",
          `批量发货；运单号：${item.shipping_order_no}；归属成员：${ownerMember}；寄件人：${shipperSnap.name}`,
        ),
      );
    } else {
      failed.push({ order_no: item.order_no, error: result.error });
    }
  });

  if (auditEntries.length > 0) {
    await writeAuditLogs(supabase, auditEntries);
  }

  return c.json({ succeeded, failed });
});

/** COD 无效订单批量恢复原先状态 */
ordersRoutes.post("/batch-reopen", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要恢复的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json({ error: `单次最多恢复 ${MAX_BATCH_STATUS_IDS} 笔订单` }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const [accessChecker, ordersResult] = await Promise.all([
    createOrderAccessChecker(supabase, c),
    supabase
      .from("orders")
      .select("id, status, payment_type, review_status, product_id")
      .in("id", ids),
  ]);
  const { data: orders, error } = ordersResult;
  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const toReopen: BatchOrderRow[] = [];

  for (const order of eligible) {
    if (order.payment_type !== "cod") {
      outcome.failed.push({ id: order.id, error: "非货到付款订单无需恢复" });
      continue;
    }
    if (order.review_status !== "rejected" && order.status !== "cancelled") {
      outcome.failed.push({ id: order.id, error: "仅无效订单可恢复" });
      continue;
    }
    toReopen.push(order);
  }

  const restoredById =
    toReopen.length > 0
      ? await resolveStatusBeforeInvalidBatch(
          supabase,
          toReopen.map((o) => o.id),
        )
      : new Map<string, OrderStatus>();

  type ReopenGroup = {
    restoredStatus: OrderStatus;
    nextReview: ReviewStatus;
    orders: BatchOrderRow[];
  };
  const groups = new Map<string, ReopenGroup>();
  const auditEntries: WriteAuditInput[] = [];
  const now = new Date().toISOString();

  for (const order of toReopen) {
    const restoredStatus = restoredById.get(order.id) ?? "awaiting_review";
    const nextReview: ReviewStatus =
      restoredStatus === "awaiting_review" ? "pending" : "approved";
    const key = `${restoredStatus}:${nextReview}`;
    if (!groups.has(key)) {
      groups.set(key, { restoredStatus, nextReview, orders: [] });
    }
    groups.get(key)!.orders.push(order);
  }

  for (const group of groups.values()) {
    const updateIds = group.orders.map((o) => o.id);
    const bulk = await bulkUpdateOrders(supabase, updateIds, {
      status: group.restoredStatus,
      review_status: group.nextReview,
      reject_reason: null,
      reviewed_by: group.nextReview === "approved" ? actor.id : null,
      reviewed_at: group.nextReview === "approved" ? now : null,
      updated_by: actor.id,
    });
    if (!bulk.ok) {
      markBulkUpdateFailure(group.orders, outcome, bulk.error);
      continue;
    }
    for (const order of group.orders) {
      outcome.succeeded.push(order.id);
      auditEntries.push(
        auditReviewChange(
          actor,
          order.id,
          order.review_status,
          group.nextReview,
          "无效订单恢复原先状态",
        ),
      );
      if (order.status !== group.restoredStatus) {
        auditEntries.push(
          auditStatusChange(
            actor,
            order.id,
            order.status,
            group.restoredStatus,
            "COD 无效订单恢复原先状态",
          ),
        );
      }
    }
  }

  if (auditEntries.length > 0) {
    await writeAuditLogs(supabase, auditEntries);
  }

  const succeeded = outcome.succeeded.map((id) => ({
    id,
    restored_status: restoredById.get(id) ?? ("awaiting_review" as OrderStatus),
  }));

  return c.json({ succeeded, failed: outcome.failed });
});

/** COD 订单批量恢复上一步状态 */
ordersRoutes.post("/batch-revert", async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };
  const actor = actorFrom(c);

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要恢复的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json({ error: `单次最多恢复 ${MAX_BATCH_STATUS_IDS} 笔订单` }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const accessChecker = await createOrderAccessChecker(supabase, c);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status, product_id")
    .in("id", ids);

  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const { eligible, outcome } = partitionBatchOrders(ids, byId, accessChecker);
  const previousById = await resolvePreviousStatusBatch(
    supabase,
    eligible.map((o) => ({
      id: o.id,
      status: o.status as OrderStatus,
    })),
  );

  type RevertGroup = {
    currentStatus: OrderStatus;
    previousStatus: OrderStatus;
    nextReview: ReviewStatus;
    patch: Record<string, unknown>;
    orders: BatchOrderRow[];
  };

  const groups = new Map<string, RevertGroup>();
  const auditEntries: WriteAuditInput[] = [];

  for (const order of eligible) {
    const currentStatus = order.status as OrderStatus;
    if (!canRevertCodOrder("cod", currentStatus)) {
      outcome.failed.push({ id: order.id, error: "当前状态不可恢复上一步" });
      continue;
    }

    const previousStatus = previousById.get(order.id);
    if (!previousStatus) {
      outcome.failed.push({ id: order.id, error: "无法确定上一步状态" });
      continue;
    }

    const patch = buildCodRevertPatch(currentStatus, previousStatus, actor);
    const nextReview = patch.review_status as ReviewStatus;
    const key = `${currentStatus}:${previousStatus}:${nextReview}`;
    if (!groups.has(key)) {
      groups.set(key, {
        currentStatus,
        previousStatus,
        nextReview,
        patch,
        orders: [],
      });
    }
    groups.get(key)!.orders.push(order);
  }

  for (const group of groups.values()) {
    const updateIds = group.orders.map((o) => o.id);
    const bulk = await bulkUpdateOrders(supabase, updateIds, group.patch);
    if (!bulk.ok) {
      markBulkUpdateFailure(group.orders, outcome, bulk.error);
      continue;
    }

    for (const order of group.orders) {
      outcome.succeeded.push(order.id);
      const prevReview = order.review_status as ReviewStatus;
      if (prevReview !== group.nextReview) {
        auditEntries.push(
          auditReviewChange(
            actor,
            order.id,
            prevReview,
            group.nextReview,
            "恢复上一步状态",
          ),
        );
      }
      if (group.currentStatus !== group.previousStatus) {
        auditEntries.push(
          auditStatusChange(
            actor,
            order.id,
            group.currentStatus,
            group.previousStatus,
            "恢复上一步状态",
          ),
        );
      }
    }
  }

  if (auditEntries.length > 0) {
    await writeAuditLogs(supabase, auditEntries);
  }

  const succeeded = outcome.succeeded.map((id) => ({
    id,
    previous_status: previousById.get(id) ?? null,
  }));

  return c.json({ succeeded, failed: outcome.failed });
});

function buildCodForceStatusPatch(
  to: OrderStatus,
  actor: Actor,
  opts: { rejectReason?: string },
):
  | { ok: true; patch: Record<string, unknown>; auditRemark: string }
  | { ok: false; error: string } {
  if (!isCodForceStatus(to)) {
    return { ok: false, error: "不支持强制流转到该状态" };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: to,
    updated_by: actor.id,
  };
  const auditRemark = "管理员强制流转";

  if (to === "awaiting_review") {
    patch.review_status = "pending";
    patch.reviewed_by = null;
    patch.reviewed_at = null;
    patch.reject_reason = null;
  } else if (to === "cancelled") {
    const reason = opts.rejectReason?.trim() ?? "";
    if (!reason) {
      return { ok: false, error: "流转到无效订单时请填写理由" };
    }
    patch.review_status = "rejected";
    patch.reject_reason = reason;
    patch.reviewed_by = actor.id;
    patch.reviewed_at = now;
  } else {
    patch.review_status = "approved";
    patch.reviewed_by = actor.id;
    patch.reviewed_at = now;
    patch.reject_reason = null;
  }

  return { ok: true, patch, auditRemark };
}

function nextReviewStatusForForceTarget(to: OrderStatus): ReviewStatus {
  if (to === "awaiting_review") return "pending";
  if (to === "cancelled") return "rejected";
  return "approved";
}

/** COD 全部订单：超级管理员批量强制流转到任意 COD 状态（跳过常规流转规则） */
ordersRoutes.post("/batch-force-status", requireSuperAdmin, async (c) => {
  const body = (await c.req.json()) as {
    ids?: unknown;
    status?: unknown;
    reject_reason?: unknown;
    remark?: unknown;
  };
  const actor = actorFrom(c);

  if (!isCodForceStatus(body.status)) {
    return c.json({ error: "目标状态无效" }, 400);
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要流转的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json(
      { error: `单次最多流转 ${MAX_BATCH_STATUS_IDS} 笔订单` },
      400,
    );
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const to = body.status;
  const rejectReason =
    typeof body.reject_reason === "string" ? body.reject_reason.trim() : "";
  const remark =
    typeof body.remark === "string" ? body.remark.trim() : "";
  const built = buildCodForceStatusPatch(to, actor, { rejectReason });
  if (!built.ok) return c.json({ error: built.error }, 400);

  const auditRemark = remark || built.auditRemark;
  const nextReview = nextReviewStatusForForceTarget(to);

  const supabase = createServiceClient(c.env);
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status, product_id")
    .in("id", ids);

  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const outcome: BatchOutcome = { succeeded: [], failed: [] };
  const toUpdate: BatchOrderRow[] = [];
  const auditEntries: WriteAuditInput[] = [];

  for (const id of ids) {
    const order = byId.get(id);
    if (!order) {
      outcome.failed.push({ id, error: "订单不存在" });
      continue;
    }
    if (order.payment_type !== "cod") {
      outcome.failed.push({ id, error: "仅支持货到付款订单" });
      continue;
    }
    if (order.status === to) {
      outcome.failed.push({ id, error: "订单已是该状态" });
      continue;
    }
    toUpdate.push(order);
  }

  if (toUpdate.length > 0) {
    const bulk = await bulkUpdateOrders(
      supabase,
      toUpdate.map((o) => o.id),
      built.patch,
    );
    if (!bulk.ok) {
      markBulkUpdateFailure(toUpdate, outcome, bulk.error);
    } else {
      for (const order of toUpdate) {
        outcome.succeeded.push(order.id);
        const prevReview = order.review_status;
        if (prevReview !== nextReview) {
          auditEntries.push(
            auditReviewChange(
              actor,
              order.id,
              prevReview,
              nextReview,
              auditRemark,
            ),
          );
        }
        auditEntries.push(
          auditStatusChange(
            actor,
            order.id,
            order.status,
            to,
            auditRemark,
          ),
        );
      }
      await writeAuditLogs(supabase, auditEntries);
    }
  }

  return c.json({ succeeded: outcome.succeeded, failed: outcome.failed });
});

/** COD 无效订单批量永久删除（仅超级管理员） */
ordersRoutes.post("/batch-delete", requireSuperAdmin, async (c) => {
  const body = (await c.req.json()) as { ids?: unknown };

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "请选择要删除的订单" }, 400);
  }
  if (body.ids.length > MAX_BATCH_STATUS_IDS) {
    return c.json({ error: `单次最多删除 ${MAX_BATCH_STATUS_IDS} 笔订单` }, 400);
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  if (ids.length !== body.ids.length) {
    return c.json({ error: "订单 ID 格式无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, payment_type, review_status")
    .in("id", ids);

  if (error) return c.json({ error: error.message }, 500);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const toDelete: string[] = [];

  for (const id of ids) {
    const order = byId.get(id);
    if (!order) {
      failed.push({ id, error: "订单不存在" });
      continue;
    }
    if (order.payment_type !== "cod") {
      failed.push({ id, error: "仅支持删除货到付款订单" });
      continue;
    }
    if (order.review_status !== "rejected" && order.status !== "cancelled") {
      failed.push({ id, error: "仅无效订单可删除" });
      continue;
    }
    toDelete.push(id);
  }

  if (toDelete.length > 0) {
    const { error: auditError } = await supabase
      .from("audit_logs")
      .delete()
      .eq("entity_type", "order")
      .in("entity_id", toDelete);

    if (auditError) return c.json({ error: auditError.message }, 500);

    const { error: deleteError } = await supabase
      .from("orders")
      .delete()
      .in("id", toDelete);

    if (deleteError) return c.json({ error: deleteError.message }, 500);

    succeeded.push(...toDelete);
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

  // 无效订单 → 恢复作废前状态
  if (body.decision === "reopen") {
    const result = await applyCodReopen(supabase, order, actor, body.remark);
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

ordersRoutes.patch("/:id/revert", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    remark?: string | null;
  };
  const actor = actorFrom(c);

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

  const result = await applyCodRevertStep(
    supabase,
    order,
    actor,
    body.remark ?? null,
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
