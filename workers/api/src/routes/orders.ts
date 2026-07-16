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
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

function parsePage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parsePageSize(raw: string | undefined, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
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

export const ordersRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

ordersRoutes.get("/", async (c) => {
  const page = parsePage(c.req.query("page"));
  const pageSize = parsePageSize(c.req.query("pageSize"));
  const status = c.req.query("status");
  const orderNo = c.req.query("order_no")?.trim();
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

  if (status) {
    if (!isOrderStatus(status)) {
      return c.json({ error: `无效的订单状态：${status}` }, 400);
    }
    query = query.eq("status", status);
  }
  if (orderNo) {
    query = query.ilike("order_no", `%${orderNo}%`);
  }
  if (reviewStatus) {
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

  return c.json({
    data: withActors,
    total: count ?? 0,
    page,
    pageSize,
  });
});

ordersRoutes.get("/:id/logs", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
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

  return c.json(await attachActorsOne(supabase, order));
});

ordersRoutes.patch("/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as {
    status?: OrderStatus;
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
    .select("id, status, payment_type, review_status, shipper_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!order) return c.json({ error: "订单不存在" }, 404);

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

  const needsShipper = to === "shipped" || to === "cod_shipped";
  const patch: Record<string, unknown> = {
    status: to,
    updated_by: actor.id,
  };

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
      : null,
  });

  return c.json(await attachActorsOne(supabase, data));
});

ordersRoutes.patch("/:id/review", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as {
    decision?: "approved" | "rejected" | "reopen";
    remark?: string | null;
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
    .select("id, status, payment_type, review_status")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!order) return c.json({ error: "订单不存在" }, 404);

  if (order.payment_type !== "cod") {
    return c.json({ error: "非货到付款订单无需审核" }, 400);
  }

  // 已拒绝 → 改回待审核
  if (body.decision === "reopen") {
    if (order.review_status !== "rejected") {
      return c.json({ error: "仅已拒绝的订单可改回待审核" }, 400);
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
      fromValue: "rejected",
      toValue: "pending",
      remark: body.remark ?? "已拒绝改回待审核",
    });

    if (order.status !== "awaiting_review") {
      await writeAuditLog(supabase, {
        entityType: "order",
        entityId: id,
        action: "status_change",
        actor,
        fromValue: order.status,
        toValue: "awaiting_review",
        remark: "COD 已拒绝改回待审核",
      });
    }

    return c.json(await attachActorsOne(supabase, data));
  }

  if (order.review_status !== "pending") {
    return c.json({ error: "当前订单不在待审核状态" }, 400);
  }

  const nextReview = body.decision as ReviewStatus;
  // 审核通过 → 待发货；拒绝 → 已取消
  const patch: Record<string, unknown> = {
    review_status: nextReview,
    reviewed_by: actor.id,
    reviewed_at: new Date().toISOString(),
    updated_by: actor.id,
  };
  if (nextReview === "approved") {
    patch.status = "awaiting_shipment";
  } else {
    patch.status = "cancelled";
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
    action: "review",
    actor,
    fromValue: "pending",
    toValue: nextReview,
    remark: body.remark ?? null,
  });

  const nextFulfillment =
    nextReview === "approved" ? "awaiting_shipment" : "cancelled";
  if (order.status !== nextFulfillment) {
    await writeAuditLog(supabase, {
      entityType: "order",
      entityId: id,
      action: "status_change",
      actor,
      fromValue: order.status,
      toValue: nextFulfillment,
      remark:
        nextReview === "approved"
          ? "COD 审核通过，自动进入待发货"
          : "COD 审核拒绝，订单取消",
    });
  }

  return c.json(await attachActorsOne(supabase, data));
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
    .select("remark")
    .eq("id", id)
    .maybeSingle();

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

  return c.json(await attachActorsOne(supabase, data));
});
