import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from "antd";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  PAYMENT_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  getAllowedOrderTransitions,
  type LogisticsShipper,
  type Order,
  type OrderStatus,
  type PaymentType,
  type ReviewStatus,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { AuditLogPanel, formatActor } from "../components/AuditLogPanel";
import {
  getOrdersListFrom,
  isCodListPath,
  setOrdersListFrom,
} from "../lib/listNav";
import dayjs from "dayjs";

const statusColor: Record<OrderStatus, string> = {
  pending: "default",
  paid: "processing",
  awaiting_review: "orange",
  awaiting_shipment: "gold",
  shipped: "blue",
  cod_shipped: "cyan",
  completed: "success",
  cod_completed: "green",
  cancelled: "error",
};

const reviewColor: Record<ReviewStatus, string> = {
  not_required: "default",
  pending: "orange",
  approved: "success",
  rejected: "error",
};

type ShipperFormValues = {
  name: string;
  phone?: string;
  province?: string;
  city?: string;
  district?: string;
  address?: string;
  address_info?: string;
  consignor_flag?: string;
  consignor_name?: string;
  consignor_phone?: string;
};

type ShipMetaFormValues = {
  shipping_order_no: string;
  owner_member: string;
};

function isShipTransition(status: OrderStatus): boolean {
  return status === "shipped" || status === "cod_shipped";
}

/** 按 COD 订单状态推断应回到的列表路径 */
function resolveCodListPath(order: Order): string {
  if (order.review_status === "rejected") return "/cod/rejected";
  if (order.review_status === "pending" || order.status === "awaiting_review") {
    return "/cod/pending_review";
  }
  if (order.status === "awaiting_shipment") return "/cod/awaiting_shipment";
  if (order.status === "cod_shipped") return "/cod/shipped";
  if (order.status === "cod_completed") return "/cod/completed";
  return "/cod/pending_review";
}

function shipperToForm(s: LogisticsShipper): ShipperFormValues {
  return {
    name: s.name,
    phone: s.phone ?? "",
    province: s.province ?? "",
    city: s.city ?? "",
    district: s.district ?? "",
    address: s.address ?? "",
    address_info: s.address_info ?? "",
    consignor_flag: s.consignor_flag ?? "0",
    consignor_name: s.consignor_name ?? "",
    consignor_phone: s.consignor_phone ?? "",
  };
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath =
    (location.state as { from?: string } | null)?.from ||
    getOrdersListFrom() ||
    undefined;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [remark, setRemark] = useState("");
  const [logKey, setLogKey] = useState(0);
  const [shippers, setShippers] = useState<LogisticsShipper[]>([]);
  const [shipModalOpen, setShipModalOpen] = useState(false);
  const [shipTarget, setShipTarget] = useState<OrderStatus | null>(null);
  const [selectedShipperId, setSelectedShipperId] = useState<string>();
  const [shipForm] = Form.useForm<ShipperFormValues>();
  const [shipMetaForm] = Form.useForm<ShipMetaFormValues>();

  // 详情页按订单状态校正 COD 来源，保证侧栏与返回一致
  useEffect(() => {
    if (!order || order.payment_type !== "cod") return;
    const path =
      fromPath && isCodListPath(fromPath)
        ? fromPath
        : resolveCodListPath(order);
    setOrdersListFrom(path);
    if (fromPath !== path) {
      navigate(location.pathname, { replace: true, state: { from: path } });
    }
  }, [order, fromPath, navigate, location.pathname]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiFetch<Order>(`/api/orders/${id}`);
      setOrder(data);
      setRemark(data.remark ?? "");
      setLogKey((k) => k + 1);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      navigate(fromPath || "/orders");
    } finally {
      setLoading(false);
    }
  }, [id, navigate, fromPath]);

  const loadShippers = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: LogisticsShipper[] }>("/api/shippers");
      setShippers(res.data);
      return res.data;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载寄件人失败");
      return [] as LogisticsShipper[];
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (
    next: OrderStatus,
    payload?: {
      shipper_id?: string;
      shipper?: ShipperFormValues;
      shipping_order_no?: string;
      owner_member?: string;
    },
  ) => {
    if (!order) return;
    setSaving(true);
    try {
      await apiFetch(`/api/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: next,
          ...(payload?.shipper_id ? { shipper_id: payload.shipper_id } : {}),
          ...(payload?.shipping_order_no
            ? { shipping_order_no: payload.shipping_order_no }
            : {}),
          ...(payload?.owner_member
            ? { owner_member: payload.owner_member }
            : {}),
          ...(payload?.shipper
            ? {
                shipper: {
                  name: payload.shipper.name,
                  phone: payload.shipper.phone || null,
                  province: payload.shipper.province || null,
                  city: payload.shipper.city || null,
                  district: payload.shipper.district || null,
                  address: payload.shipper.address || null,
                  address_info: payload.shipper.address_info || null,
                  consignor_flag: payload.shipper.consignor_flag || "0",
                  consignor_name: payload.shipper.consignor_name || null,
                  consignor_phone: payload.shipper.consignor_phone || null,
                },
              }
            : {}),
        }),
      });
      message.success(`已更新为「${ORDER_STATUS_LABELS[next]}」`);
      setShipModalOpen(false);
      setShipTarget(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const onStatusClick = async (next: OrderStatus) => {
    if (!isShipTransition(next)) {
      await changeStatus(next);
      return;
    }
    const list = shippers.length ? shippers : await loadShippers();
    if (!list.length) {
      message.warning("请先在「寄件人管理」中添加寄件人，发货必须选择寄件人");
      return;
    }
    setSelectedShipperId(undefined);
    shipForm.resetFields();
    shipForm.setFieldsValue({ consignor_flag: "0" });
    shipMetaForm.setFieldsValue({
      shipping_order_no: order?.shipping_order_no ?? "",
      owner_member: order?.owner_member ?? "",
    });
    setShipTarget(next);
    setShipModalOpen(true);
  };

  if (loading || !order) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }

  const paymentType = (order.payment_type ?? "non_cod") as PaymentType;
  const reviewStatus = (order.review_status ?? "not_required") as ReviewStatus;
  const nextStatuses = ORDER_TRANSITIONS[order.status] ?? [];
  const allowedStatuses = getAllowedOrderTransitions(
    order.status,
    paymentType,
    reviewStatus,
  );
  const needsReview = paymentType === "cod" && reviewStatus === "pending";
  const shipBlocked =
    paymentType === "cod" &&
    reviewStatus !== "approved" &&
    nextStatuses.includes("cod_shipped");
  const lineTotal = Number(order.unit_price) * Number(order.quantity || 0);
  const backPath =
    fromPath ||
    (paymentType === "cod" ? resolveCodListPath(order) : "/orders");

  return (
    <div>
      <div className="page-header">
        <h1>订单详情</h1>
        <Button>
          <Link to={backPath}>返回列表</Link>
        </Button>
      </div>

      <Descriptions bordered column={{ xs: 1, sm: 2 }} size="middle">
        <Descriptions.Item label="订单号">{order.order_no}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={statusColor[order.status]}>
            {ORDER_STATUS_LABELS[order.status]}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="商品">
          {order.product_name || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="套餐">
          {order.package_name
            ? order.package_name_external
              ? `${order.package_name}（${order.package_name_external}）`
              : order.package_name
            : "—"}
        </Descriptions.Item>
        <Descriptions.Item label="中文属性">
          {order.sku_code
            ? `${order.sku_code} * ${order.quantity}`
            : "—"}
        </Descriptions.Item>
        <Descriptions.Item label="购买数量">{order.quantity}</Descriptions.Item>
        <Descriptions.Item label="单价">
          ¥{Number(order.unit_price).toFixed(2)}
        </Descriptions.Item>
        <Descriptions.Item label="小计">
          ¥{lineTotal.toFixed(2)}
        </Descriptions.Item>
        <Descriptions.Item label="支付类别">
          <Tag color={paymentType === "cod" ? "orange" : "default"}>
            {PAYMENT_TYPE_LABELS[paymentType]}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="审核状态">
          <Tag color={reviewColor[reviewStatus]}>
            {REVIEW_STATUS_LABELS[reviewStatus]}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="收件人">{order.customer_name}</Descriptions.Item>
        <Descriptions.Item label="收件人电话">
          {order.customer_phone || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="收件省">{order.shipping_province || "—"}</Descriptions.Item>
        <Descriptions.Item label="收件城市">{order.shipping_city || "—"}</Descriptions.Item>
        <Descriptions.Item label="收件地区">{order.shipping_district || "—"}</Descriptions.Item>
        <Descriptions.Item label="收件地址">{order.shipping_detail || "—"}</Descriptions.Item>
        <Descriptions.Item label="收件地址信息" span={2}>
          {order.shipping_address || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="归属成员">
          {order.owner_member || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="发货订单号">
          {order.shipping_order_no || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="支付方式">
          {order.payment_method || "—"}
        </Descriptions.Item>
        <Descriptions.Item label="订单总金额">
          ¥{Number(order.total_amount).toFixed(2)}
        </Descriptions.Item>
        <Descriptions.Item label="代收货款">
          {order.cod_amount != null
            ? `¥${Number(order.cod_amount).toFixed(2)}`
            : "—"}
        </Descriptions.Item>
        <Descriptions.Item label="创建人">
          {formatActor(order.creator)}
        </Descriptions.Item>
        <Descriptions.Item label="最后修改人">
          {formatActor(order.updater)}
        </Descriptions.Item>
        <Descriptions.Item label="审核人">
          {formatActor(order.reviewer)}
        </Descriptions.Item>
        <Descriptions.Item label="审核时间">
          {order.reviewed_at
            ? dayjs(order.reviewed_at).format("YYYY-MM-DD HH:mm:ss")
            : "—"}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {dayjs(order.created_at).format("YYYY-MM-DD HH:mm:ss")}
        </Descriptions.Item>
        <Descriptions.Item label="最近更新时间">
          {dayjs(order.updated_at).format("YYYY-MM-DD HH:mm:ss")}
        </Descriptions.Item>
      </Descriptions>

      {(order.shipper_name || order.shipper_id) && (
        <>
          <h2 style={{ marginTop: 28, fontSize: 16 }}>寄件人信息</h2>
          <Descriptions bordered column={{ xs: 1, sm: 2 }} size="middle">
            <Descriptions.Item label="寄件人">
              {order.shipper_name || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="寄件人电话">
              {order.shipper_phone || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="寄件省">
              {order.shipper_province || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="寄件城市">
              {order.shipper_city || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="寄件区域">
              {order.shipper_district || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="委托人标识">
              {order.consignor_flag || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="寄件地址" span={2}>
              {order.shipper_address || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="寄件地址信息" span={2}>
              {order.shipper_address_info || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="委托人姓名">
              {order.consignor_name || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="委托人电话">
              {order.consignor_phone || "—"}
            </Descriptions.Item>
          </Descriptions>
        </>
      )}

      {paymentType === "cod" ? (
        <>
          <h2 style={{ marginTop: 28, fontSize: 16 }}>货到付款审核</h2>
          {needsReview ? (
            <Space>
              <Button
                type="primary"
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await apiFetch(`/api/orders/${order.id}/review`, {
                      method: "PATCH",
                      body: JSON.stringify({ decision: "approved" }),
                    });
                    message.success("审核已通过，订单已进入待发货");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "审核失败");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                审核通过
              </Button>
              <Button
                danger
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await apiFetch(`/api/orders/${order.id}/review`, {
                      method: "PATCH",
                      body: JSON.stringify({ decision: "rejected" }),
                    });
                    message.success("已拒绝该订单");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "操作失败");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                审核拒绝
              </Button>
            </Space>
          ) : reviewStatus === "rejected" ? (
            <Space direction="vertical" size="middle">
              <p style={{ color: "var(--muted)", margin: 0 }}>
                已拒绝，订单审核未通过。可改回待审核后重新审核。
              </p>
              <Button
                type="primary"
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await apiFetch(`/api/orders/${order.id}/review`, {
                      method: "PATCH",
                      body: JSON.stringify({ decision: "reopen" }),
                    });
                    message.success("已改回待审核");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "操作失败");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                改回待审核
              </Button>
            </Space>
          ) : (
            <p style={{ color: "var(--muted)" }}>
              {REVIEW_STATUS_LABELS[reviewStatus]}
              {reviewStatus === "approved"
                ? "，订单已进入待发货，可继续发货流转"
                : ""}
            </p>
          )}
        </>
      ) : null}

      <h2 style={{ marginTop: 28, fontSize: 16 }}>状态流转</h2>
      {order.status === "awaiting_shipment" &&
      reviewStatus === "approved" &&
      !shipBlocked ? (
        <div
          style={{
            marginBottom: 16,
            padding: 16,
            background: "#fffbe6",
            border: "1px solid #ffe58f",
            borderRadius: 8,
          }}
        >
          <p style={{ marginBottom: 12 }}>
            当前为待发货。请先选择寄件人信息后再确认发货。
          </p>
          <Button
            type="primary"
            loading={saving}
            onClick={() => void onStatusClick("cod_shipped")}
          >
            选择寄件人发货
          </Button>
        </div>
      ) : null}
      {shipBlocked ? (
        <p style={{ color: "#d46b08", marginBottom: 12 }}>
          货到付款订单须网站管理审核通过后才能发货。请先在上方完成审核。
        </p>
      ) : null}
      {allowedStatuses.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          {nextStatuses.length === 0
            ? "当前为终态，不可再变更。"
            : "当前无可执行的状态变更（货到付款请先审核）。"}
        </p>
      ) : (
        <Space wrap>
          {allowedStatuses
            .filter((next) => !isShipTransition(next))
            .map((next) => (
              <Button
                key={next}
                type={next === "cancelled" ? "default" : "primary"}
                danger={next === "cancelled"}
                loading={saving}
                onClick={() => void onStatusClick(next)}
              >
                改为{ORDER_STATUS_LABELS[next]}
              </Button>
            ))}
        </Space>
      )}

      <h2 style={{ marginTop: 28, fontSize: 16 }}>备注</h2>
      <Space align="start" style={{ width: "100%" }} direction="vertical">
        <Input.TextArea
          rows={3}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          maxLength={500}
          showCount
          style={{ maxWidth: 560 }}
        />
        <Button
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await apiFetch(`/api/orders/${order.id}/remark`, {
                method: "PATCH",
                body: JSON.stringify({ remark: remark.trim() || null }),
              });
              message.success("备注已保存");
              await load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : "保存失败");
            } finally {
              setSaving(false);
            }
          }}
        >
          保存备注
        </Button>
      </Space>

      <h2 style={{ marginTop: 28, fontSize: 16 }}>操作日志</h2>
      <AuditLogPanel entityType="order" entityId={order.id} refreshKey={logKey} />

      <Modal
        title="选择寄件人并发货"
        open={shipModalOpen}
        onCancel={() => {
          setShipModalOpen(false);
          setShipTarget(null);
        }}
        confirmLoading={saving}
        okText="确认发货"
        okButtonProps={{ disabled: !selectedShipperId }}
        onOk={async () => {
          if (!shipTarget) return;
          if (!selectedShipperId) {
            message.warning("请先选择寄件人");
            return;
          }
          try {
            const [meta, values] = await Promise.all([
              shipMetaForm.validateFields(),
              shipForm.validateFields(),
            ]);
            await changeStatus(shipTarget, {
              shipper_id: selectedShipperId,
              shipper: values,
              shipping_order_no: meta.shipping_order_no.trim(),
              owner_member: meta.owner_member.trim(),
            });
          } catch (e) {
            if (e && typeof e === "object" && "errorFields" in e) return;
          }
        }}
        destroyOnClose
        width={640}
      >
        <p style={{ color: "#666", marginBottom: 12 }}>
          发货须填写发货订单号、归属成员，并选择寄件人（对齐财务/物流导出模板）。
        </p>

        <Form form={shipMetaForm} layout="vertical">
          <Form.Item
            name="shipping_order_no"
            label="发货订单号"
            rules={[{ required: true, message: "请填写发货订单号" }]}
            extra="对应财务导出「订单号」/ 物流导出「电商订单号」"
          >
            <Input placeholder="如 26071522000109" />
          </Form.Item>
          <Form.Item
            name="owner_member"
            label="归属成员"
            rules={[{ required: true, message: "请填写归属成员" }]}
            extra="对应财务导出「归属成员」"
          >
            <Input placeholder="如 ZJL" />
          </Form.Item>
        </Form>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>
            寄件人 <span style={{ color: "#ff4d4f" }}>*</span>
          </div>
          <Select
            style={{ width: "100%" }}
            placeholder="请选择寄件人"
            value={selectedShipperId}
            status={selectedShipperId ? undefined : "error"}
            onChange={(value) => {
              setSelectedShipperId(value);
              const found = shippers.find((s) => s.id === value);
              if (found) shipForm.setFieldsValue(shipperToForm(found));
            }}
            options={shippers.map((s) => ({
              value: s.id,
              label: `${s.name}${s.is_default ? "（默认）" : ""}${
                s.phone ? ` · ${s.phone}` : ""
              }${s.city ? ` · ${s.city}` : ""}`,
            }))}
          />
          {!shippers.length ? (
            <p style={{ color: "#d46b08", marginTop: 8 }}>
              暂无寄件人，请先去
              <Link to="/shippers"> 寄件人管理 </Link>
              添加后再发货。
            </p>
          ) : null}
        </div>

        <Form form={shipForm} layout="vertical" disabled={!selectedShipperId}>
          <Form.Item
            name="name"
            label="寄件人"
            rules={[{ required: true, message: "请填写寄件人" }]}
          >
            <Input placeholder="选择寄件人后自动填入" />
          </Form.Item>
          <Form.Item name="phone" label="寄件人电话">
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item name="province" label="寄件省" style={{ width: 180 }}>
              <Input />
            </Form.Item>
            <Form.Item name="city" label="寄件城市" style={{ width: 180 }}>
              <Input />
            </Form.Item>
            <Form.Item name="district" label="寄件区域" style={{ width: 180 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="寄件地址">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="address_info" label="寄件地址信息">
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item
              name="consignor_flag"
              label="委托人标识"
              style={{ width: 140 }}
            >
              <Input placeholder="默认 0" />
            </Form.Item>
            <Form.Item
              name="consignor_name"
              label="委托人姓名"
              style={{ width: 180 }}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="consignor_phone"
              label="委托人电话"
              style={{ width: 180 }}
            >
              <Input />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
