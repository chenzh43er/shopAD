import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
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
  REVIEW_STATUS_LABELS,
  type LogisticsShipper,
  type Order,
  type OrderStatus,
  type Paginated,
  type PaymentType,
  type Product,
  type ProductPackageWithItems,
  type ReviewStatus,
  type UpdateOrderInput,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { formatMoney } from "../lib/formatMoney";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { AuditLogPanel, formatActor } from "../components/AuditLogPanel";
import {
  getOrdersListFrom,
  setOrdersListFrom,
} from "../lib/listNav";
import { useAuth } from "../auth/AuthContext";
import dayjs from "dayjs";

const statusColor: Record<OrderStatus, string> = {
  pending: "default",
  paid: "processing",
  awaiting_review: "orange",
  awaiting_confirm: "geekblue",
  awaiting_shipment: "gold",
  shipped: "blue",
  cod_shipped: "cyan",
  completed: "success",
  cod_completed: "green",
  cod_refused: "magenta",
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

type EditOrderFormValues = {
  customer_name: string;
  customer_phone?: string;
  shipping_province?: string;
  shipping_city?: string;
  shipping_district?: string;
  shipping_detail?: string;
  shipping_address?: string;
  product_id: string;
  package_id?: string;
  quantity: number;
  owner_member?: string;
  shipping_order_no?: string;
};

function packageItemCount(pkg: ProductPackageWithItems): number {
  const sum = (pkg.items ?? []).reduce((acc, item) => {
    const n = Number(item.quantity);
    return acc + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
  return Math.max(1, sum || 1);
}

function packageUnitPrice(pkg: ProductPackageWithItems): number {
  const raw = pkg.discount_price ?? pkg.original_price;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function isShipTransition(status: OrderStatus): boolean {
  return status === "shipped" || status === "cod_shipped";
}

/** 按 COD 订单状态推断应回到的列表路径 */
function resolveCodListPath(order: Order): string {
  if (order.status === "cancelled" || order.review_status === "rejected") {
    return "/cod/invalid";
  }
  if (order.review_status === "pending" || order.status === "awaiting_review") {
    return "/cod/pending_review";
  }
  if (order.status === "awaiting_confirm") return "/cod/awaiting_confirm";
  if (order.status === "awaiting_shipment") return "/cod/awaiting_shipment";
  if (order.status === "cod_shipped") return "/cod/shipped";
  if (order.status === "cod_completed") return "/cod/completed";
  if (order.status === "cod_refused") return "/cod/refused";
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
  const { profile, user } = useAuth();
  const defaultOwnerMember =
    profile?.display_name?.trim() ||
    profile?.email?.trim() ||
    user?.email?.trim() ||
    "";
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
  const [invalidModalOpen, setInvalidModalOpen] = useState(false);
  const [invalidReason, setInvalidReason] = useState("");
  const [invalidMode, setInvalidMode] = useState<"status" | "review">("status");

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editProducts, setEditProducts] = useState<
    Array<Pick<Product, "id" | "name" | "sku_code" | "price" | "packages_enabled" | "weight">>
  >([]);
  const [editPackages, setEditPackages] = useState<ProductPackageWithItems[]>(
    [],
  );
  const [editSkuCode, setEditSkuCode] = useState<string | null>(null);
  const [editUnitPrice, setEditUnitPrice] = useState(0);
  const [editPackageCount, setEditPackageCount] = useState(1);
  const [editPackagesEnabled, setEditPackagesEnabled] = useState(false);
  const [editForm] = Form.useForm<EditOrderFormValues>();
  const editQuantity = Form.useWatch("quantity", editForm) ?? 1;
  const editPreviewTotal = useMemo(
    () => Number((editUnitPrice * Math.max(1, Number(editQuantity) || 1)).toFixed(2)),
    [editUnitPrice, editQuantity],
  );

  // 详情页侧栏/返回路径跟随订单当前 COD 状态（审核后不再锁在进入时的列表）
  useEffect(() => {
    if (!order) return;
    const path = resolveCodListPath(order);
    setOrdersListFrom(path);
    if (fromPath !== path) {
      navigate(location.pathname, { replace: true, state: { from: path } });
    }
  }, [order, fromPath, navigate, location.pathname]);

  const goToCodList = (path: string) => {
    setOrdersListFrom(path);
    navigate(path);
  };

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiFetch<Order>(`/api/orders/${id}`);
      setOrder(data);
      setRemark(data.remark ?? "");
      setLogKey((k) => k + 1);
      return data;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      navigate(fromPath || "/cod/pending_review");
      return null;
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

  const loadEditProducts = async () => {
    const res = await apiFetch<
      Paginated<
        Pick<
          Product,
          | "id"
          | "name"
          | "sku_code"
          | "price"
          | "packages_enabled"
          | "weight"
        >
      >
    >("/api/products?page=1&pageSize=500");
    return res.data ?? [];
  };

  const loadEditPackages = async (productId: string) => {
    const res = await apiFetch<{ data: ProductPackageWithItems[] }>(
      `/api/products/${productId}/packages`,
    );
    return res.data ?? [];
  };

  const applyProductSync = async (
    productId: string,
    preferredPackageId?: string | null,
  ) => {
    const product =
      editProducts.find((p) => p.id === productId) ??
      (await apiFetch<Product>(`/api/products/${productId}`));

    const packages = await loadEditPackages(productId);
    setEditPackages(packages);
    setEditSkuCode(product.sku_code ?? null);

    const usePackages = Boolean(product.packages_enabled) && packages.length > 0;
    setEditPackagesEnabled(usePackages);

    if (usePackages) {
      const selected =
        packages.find((p) => p.id === preferredPackageId) ?? packages[0];
      const count = packageItemCount(selected);
      const price = packageUnitPrice(selected);
      setEditPackageCount(count);
      setEditUnitPrice(price);
      editForm.setFieldsValue({
        product_id: productId,
        package_id: selected.id,
      });
    } else {
      setEditPackageCount(1);
      setEditUnitPrice(Number(product.price) || 0);
      editForm.setFieldsValue({
        product_id: productId,
        package_id: undefined,
      });
    }
  };

  const applyPackageSync = (packageId: string) => {
    const pkg = editPackages.find((p) => p.id === packageId);
    if (!pkg) return;
    setEditPackageCount(packageItemCount(pkg));
    setEditUnitPrice(packageUnitPrice(pkg));
    editForm.setFieldsValue({ package_id: packageId });
  };

  const openEditModal = async () => {
    if (!order) return;
    setEditOpen(true);
    setEditLoading(true);
    try {
      const products = await loadEditProducts();
      // 当前商品若不在列表（已下架等），补进选项避免无法回显
      let list = products;
      if (
        order.product_id &&
        !list.some((p) => p.id === order.product_id)
      ) {
        try {
          const current = await apiFetch<Product>(
            `/api/products/${order.product_id}`,
          );
          list = [
            {
              id: current.id,
              name: current.name,
              sku_code: current.sku_code,
              price: current.price,
              packages_enabled: current.packages_enabled,
              weight: current.weight,
            },
            ...list,
          ];
        } catch {
          list = [
            {
              id: order.product_id,
              name: order.product_name || order.product_id,
              sku_code: order.sku_code,
              price: order.unit_price,
              packages_enabled: Boolean(order.package_id),
              weight: order.weight ?? 1,
            },
            ...list,
          ];
        }
      }
      setEditProducts(list);

      editForm.setFieldsValue({
        customer_name: order.customer_name,
        customer_phone: order.customer_phone ?? "",
        shipping_province: order.shipping_province ?? "",
        shipping_city: order.shipping_city ?? "",
        shipping_district: order.shipping_district ?? "",
        shipping_detail: order.shipping_detail ?? "",
        shipping_address: order.shipping_address ?? "",
        product_id: order.product_id ?? undefined,
        package_id: order.package_id ?? undefined,
        quantity: Math.max(1, Number(order.quantity) || 1),
        owner_member: order.owner_member ?? "",
        shipping_order_no: order.shipping_order_no ?? "",
      });

      if (order.product_id) {
        // 先写入 products，再同步套餐（applyProductSync 依赖 editProducts 时可能尚未更新）
        const packages = await loadEditPackages(order.product_id);
        setEditPackages(packages);
        const product =
          list.find((p) => p.id === order.product_id) ??
          (await apiFetch<Product>(`/api/products/${order.product_id}`));
        setEditSkuCode(product.sku_code ?? order.sku_code ?? null);
        const usePackages =
          Boolean(product.packages_enabled) && packages.length > 0;
        setEditPackagesEnabled(usePackages);
        if (usePackages) {
          const selected =
            packages.find((p) => p.id === order.package_id) ?? packages[0];
          setEditPackageCount(packageItemCount(selected));
          setEditUnitPrice(packageUnitPrice(selected));
          editForm.setFieldsValue({ package_id: selected.id });
        } else {
          setEditPackageCount(1);
          setEditUnitPrice(Number(product.price) || Number(order.unit_price) || 0);
          editForm.setFieldsValue({ package_id: undefined });
        }
      } else {
        setEditPackages([]);
        setEditSkuCode(order.sku_code);
        setEditUnitPrice(Number(order.unit_price) || 0);
        setEditPackageCount(Math.max(1, Number(order.package_count) || 1));
        setEditPackagesEnabled(false);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载编辑数据失败");
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  };

  const submitEdit = async () => {
    if (!order) return;
    try {
      const values = await editForm.validateFields();
      setEditSaving(true);
      const payload: UpdateOrderInput = {
        customer_name: values.customer_name.trim(),
        customer_phone: values.customer_phone?.trim() || null,
        shipping_province: values.shipping_province?.trim() || null,
        shipping_city: values.shipping_city?.trim() || null,
        shipping_district: values.shipping_district?.trim() || null,
        shipping_detail: values.shipping_detail?.trim() || null,
        shipping_address: values.shipping_address?.trim() || null,
        quantity: values.quantity,
        owner_member: values.owner_member?.trim() || null,
        shipping_order_no: values.shipping_order_no?.trim() || null,
      };

      if (values.product_id) {
        payload.product_id = values.product_id;
        payload.package_id = editPackagesEnabled
          ? values.package_id || null
          : null;
      }

      await apiFetch<Order>(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      message.success("订单信息已更新");
      setEditOpen(false);
      await load();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setEditSaving(false);
    }
  };

  const changeStatus = async (
    next: OrderStatus,
    payload?: {
      shipper_id?: string;
      shipper?: ShipperFormValues;
      shipping_order_no?: string;
      owner_member?: string;
      reject_reason?: string;
    },
  ) => {
    if (!order) return;
    setSaving(true);
    try {
      await apiFetch(`/api/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: next,
          ...(payload?.reject_reason
            ? { reject_reason: payload.reject_reason }
            : {}),
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
      setInvalidModalOpen(false);
      setInvalidReason("");
      const updated = await load();
      if (updated) goToCodList(resolveCodListPath(updated));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const openInvalidModal = (mode: "status" | "review") => {
    setInvalidMode(mode);
    setInvalidReason("");
    setInvalidModalOpen(true);
  };

  const submitInvalid = async () => {
    const reason = invalidReason.trim();
    if (!reason) {
      message.error("请填写拒绝理由");
      return;
    }
    if (invalidMode === "review") {
      if (!order) return;
      setSaving(true);
      try {
        await apiFetch(`/api/orders/${order.id}/review`, {
          method: "PATCH",
          body: JSON.stringify({ decision: "rejected", reject_reason: reason }),
        });
        message.success("已标记为无效订单");
        setInvalidModalOpen(false);
        setInvalidReason("");
        goToCodList("/cod/invalid");
      } catch (e) {
        message.error(e instanceof Error ? e.message : "操作失败");
      } finally {
        setSaving(false);
      }
      return;
    }
    await changeStatus("cancelled", { reject_reason: reason });
  };

  const onStatusClick = async (next: OrderStatus) => {
    if (next === "cancelled") {
      openInvalidModal("status");
      return;
    }
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
      owner_member: order?.owner_member?.trim() || defaultOwnerMember,
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

  const paymentType = (order.payment_type ?? "cod") as PaymentType;
  const reviewStatus = (order.review_status ?? "pending") as ReviewStatus;
  const needsReview = paymentType === "cod" && reviewStatus === "pending";
  const canConfirm =
    order.status === "awaiting_confirm" && reviewStatus === "approved";
  const canShip =
    order.status === "awaiting_shipment" &&
    reviewStatus === "approved";
  const canConfirmReceive = order.status === "cod_shipped";
  // 无效订单仅待审核 / 待确认 / 待发货可标记；已发货只能签收或拒绝签收
  const canMarkInvalid =
    order.status === "awaiting_review" ||
    order.status === "awaiting_confirm" ||
    order.status === "awaiting_shipment";
  const lineTotal = Number(order.unit_price) * Number(order.quantity || 0);
  const backPath = fromPath || resolveCodListPath(order);

  return (
    <div>
      <div className="page-header">
        <h1>订单详情</h1>
        <Space>
          <Button type="primary" onClick={() => void openEditModal()}>
            编辑订单
          </Button>
          <Button>
            <Link to={backPath}>返回列表</Link>
          </Button>
        </Space>
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
            ? `${order.sku_code} * ${Math.max(1, Number(order.package_count) || 1) * Math.max(1, Number(order.quantity) || 1)}`
            : "—"}
        </Descriptions.Item>
        <Descriptions.Item label="购买数量">{order.quantity}</Descriptions.Item>
        <Descriptions.Item label="单价">
          {formatMoney(order.unit_price, order.currency)}
        </Descriptions.Item>
        <Descriptions.Item label="小计">
          {formatMoney(lineTotal, order.currency)}
        </Descriptions.Item>
        <Descriptions.Item label="审核状态">
          <Tag color={reviewColor[reviewStatus]}>
            {REVIEW_STATUS_LABELS[reviewStatus]}
          </Tag>
        </Descriptions.Item>
        {(order.status === "cancelled" ||
          reviewStatus === "rejected" ||
          order.reject_reason) && (
          <Descriptions.Item label="拒绝理由" span={2}>
            {order.reject_reason || "—"}
          </Descriptions.Item>
        )}
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
          {formatMoney(order.total_amount, order.currency)}
        </Descriptions.Item>
        <Descriptions.Item label="代收货款">
          {order.cod_amount != null
            ? formatMoney(order.cod_amount, order.currency)
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
                    message.success("审核已通过，订单已进入待确认");
                    goToCodList("/cod/awaiting_confirm");
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
                onClick={() => openInvalidModal("review")}
              >
                标记无效订单
              </Button>
            </Space>
          ) : reviewStatus === "rejected" || order.status === "cancelled" ? (
            <Space direction="vertical" size="middle">
              <p style={{ color: "var(--muted)", margin: 0 }}>
                已标记为无效订单
                {order.reject_reason ? `：${order.reject_reason}` : "。"}
                可恢复为作废前的状态后重新处理。
              </p>
              <Button
                type="primary"
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const restored = await apiFetch<Order>(
                      `/api/orders/${order.id}/review`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({ decision: "reopen" }),
                      },
                    );
                    message.success(
                      `已恢复为「${ORDER_STATUS_LABELS[restored.status]}」`,
                    );
                    goToCodList(resolveCodListPath(restored));
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "操作失败");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                恢复原先状态
              </Button>
            </Space>
          ) : (
            <p style={{ color: "var(--muted)" }}>
              {REVIEW_STATUS_LABELS[reviewStatus]}
              {reviewStatus === "approved"
                ? "，订单已通过审核，可继续后续流转"
                : ""}
            </p>
          )}
        </>
      ) : null}

      {canConfirm ? (
        <>
          <h2 style={{ marginTop: 28, fontSize: 16 }}>确认</h2>
          <div
            style={{
              marginBottom: 16,
              padding: 16,
              background: "#f0f5ff",
              border: "1px solid #adc6ff",
              borderRadius: 8,
            }}
          >
            <p style={{ marginBottom: 12 }}>
              当前为待确认。确认后订单将进入待发货。
            </p>
            <Space wrap>
              <Button
                type="primary"
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await apiFetch(`/api/orders/${order.id}/status`, {
                      method: "PATCH",
                      body: JSON.stringify({ status: "awaiting_shipment" }),
                    });
                    message.success("已确认，订单进入待发货");
                    goToCodList("/cod/awaiting_shipment");
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "确认失败");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                确认订单
              </Button>
              {canMarkInvalid ? (
                <Button
                  danger
                  loading={saving}
                  onClick={() => openInvalidModal("status")}
                >
                  标记无效订单
                </Button>
              ) : null}
            </Space>
          </div>
        </>
      ) : null}

      {canShip ? (
        <>
          <h2 style={{ marginTop: 28, fontSize: 16 }}>发货</h2>
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
            <Space wrap>
              <Button
                type="primary"
                loading={saving}
                onClick={() => void onStatusClick("cod_shipped")}
              >
                选择寄件人发货
              </Button>
              {canMarkInvalid ? (
                <Button
                  danger
                  loading={saving}
                  onClick={() => openInvalidModal("status")}
                >
                  标记无效订单
                </Button>
              ) : null}
            </Space>
          </div>
        </>
      ) : null}

      {canConfirmReceive ? (
        <>
          <h2 style={{ marginTop: 28, fontSize: 16 }}>签收结果</h2>
          <Space wrap style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void onStatusClick("cod_completed")}
            >
              确认签收
            </Button>
            <Button
              loading={saving}
              onClick={() => {
                Modal.confirm({
                  title: "拒绝签收",
                  content: "确认客户拒绝签收该订单？",
                  okText: "确认拒绝签收",
                  cancelText: "取消",
                  onOk: () => onStatusClick("cod_refused"),
                });
              }}
            >
              拒绝签收
            </Button>
          </Space>
        </>
      ) : null}

      <h2 style={{ marginTop: 28, fontSize: 16 }}>备注</h2>
      <Space align="start" style={{ width: "100%" }} direction="vertical">
        <Input.TextArea
          rows={3}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          maxLength={INPUT_LIMITS.remark}
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
        title="标记为无效订单"
        open={invalidModalOpen}
        onCancel={() => {
          if (saving) return;
          setInvalidModalOpen(false);
          setInvalidReason("");
        }}
        confirmLoading={saving}
        okText="确认无效"
        okButtonProps={{ danger: true, disabled: !invalidReason.trim() }}
        onOk={() => void submitInvalid()}
        destroyOnClose
      >
        <p style={{ color: "#666", marginBottom: 12 }}>
          请填写拒绝理由（必填）。
        </p>
        <div style={{ paddingBottom: 24 }}>
          <Input.TextArea
            rows={4}
            value={invalidReason}
            onChange={(e) => setInvalidReason(e.target.value)}
            maxLength={INPUT_LIMITS.remark}
            showCount
            placeholder="例如：地址无法联系 / 客户拒收 / 信息虚假…"
          />
        </div>
      </Modal>

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
            <Input
              maxLength={INPUT_LIMITS.shippingMeta}
              placeholder="如 26071522000109"
            />
          </Form.Item>
          <Form.Item
            name="owner_member"
            label="归属成员"
            rules={[{ required: true, message: "请填写归属成员" }]}
            extra="默认当前登录用户，可修改；对应财务导出「归属成员」"
          >
            <Input
              maxLength={INPUT_LIMITS.shippingMeta}
              placeholder="归属成员"
            />
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
            <Input
              maxLength={INPUT_LIMITS.name}
              placeholder="选择寄件人后自动填入"
            />
          </Form.Item>
          <Form.Item name="phone" label="寄件人电话">
            <Input maxLength={INPUT_LIMITS.phone} />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item name="province" label="寄件省" style={{ width: 180 }}>
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
            <Form.Item name="city" label="寄件城市" style={{ width: 180 }}>
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
            <Form.Item name="district" label="寄件区域" style={{ width: 180 }}>
              <Input maxLength={INPUT_LIMITS.region} />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="寄件地址">
            <Input.TextArea
              rows={2}
              maxLength={INPUT_LIMITS.address}
              showCount
            />
          </Form.Item>
          <Form.Item name="address_info" label="寄件地址信息">
            <Input maxLength={INPUT_LIMITS.addressInfo} />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle" wrap>
            <Form.Item
              name="consignor_flag"
              label="委托人标识"
              style={{ width: 140 }}
            >
              <Input maxLength={INPUT_LIMITS.flag} placeholder="默认 0" />
            </Form.Item>
            <Form.Item
              name="consignor_name"
              label="委托人姓名"
              style={{ width: 180 }}
            >
              <Input maxLength={INPUT_LIMITS.name} />
            </Form.Item>
            <Form.Item
              name="consignor_phone"
              label="委托人电话"
              style={{ width: 180 }}
            >
              <Input maxLength={INPUT_LIMITS.phone} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title="编辑订单"
        open={editOpen}
        onCancel={() => {
          if (editSaving) return;
          setEditOpen(false);
        }}
        confirmLoading={editSaving}
        okText="保存"
        onOk={() => void submitEdit()}
        destroyOnClose
        width={720}
      >
        <Spin spinning={editLoading}>
          <p style={{ color: "#666", marginBottom: 12 }}>
            更换商品或套餐时，中文属性、单价、套餐件数会按商品实际数据自动同步。
          </p>
          <Form form={editForm} layout="vertical" disabled={editLoading}>
            <Space wrap style={{ width: "100%" }} size="middle">
              <Form.Item
                name="customer_name"
                label="收件人"
                rules={[{ required: true, message: "请填写收件人" }]}
                style={{ width: 220 }}
              >
                <Input maxLength={INPUT_LIMITS.name} />
              </Form.Item>
              <Form.Item
                name="customer_phone"
                label="收件人电话"
                style={{ width: 220 }}
              >
                <Input maxLength={INPUT_LIMITS.phone} />
              </Form.Item>
            </Space>
            <Space wrap style={{ width: "100%" }} size="middle">
              <Form.Item
                name="shipping_province"
                label="收件省"
                style={{ width: 140 }}
              >
                <Input maxLength={INPUT_LIMITS.region} />
              </Form.Item>
              <Form.Item
                name="shipping_city"
                label="收件城市"
                style={{ width: 140 }}
              >
                <Input maxLength={INPUT_LIMITS.region} />
              </Form.Item>
              <Form.Item
                name="shipping_district"
                label="收件地区"
                style={{ width: 140 }}
              >
                <Input maxLength={INPUT_LIMITS.region} />
              </Form.Item>
            </Space>
            <Form.Item name="shipping_detail" label="收件地址">
              <Input maxLength={INPUT_LIMITS.address} />
            </Form.Item>
            <Form.Item name="shipping_address" label="收件地址信息">
              <Input maxLength={INPUT_LIMITS.addressInfo} />
            </Form.Item>
            <Form.Item
              name="product_id"
              label="商品"
              rules={[{ required: true, message: "请选择商品" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择商品"
                options={editProducts.map((p) => ({
                  value: p.id,
                  label: p.name || p.id,
                }))}
                onChange={(productId: string) => {
                  void applyProductSync(productId);
                }}
              />
            </Form.Item>
            {editPackagesEnabled ? (
              <Form.Item
                name="package_id"
                label="套餐"
                rules={[{ required: true, message: "请选择套餐" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择套餐"
                  options={editPackages.map((p) => ({
                    value: p.id,
                    label: p.name_external
                      ? `${p.name}（${p.name_external}）`
                      : p.name,
                  }))}
                  onChange={(packageId: string) => {
                    applyPackageSync(packageId);
                  }}
                />
              </Form.Item>
            ) : (
              <Form.Item label="套餐">
                <Input value="该商品未开启套餐" disabled />
              </Form.Item>
            )}
            <Space wrap style={{ width: "100%" }} size="middle">
              <Form.Item label="中文属性" style={{ width: 220 }}>
                <Input
                  value={editSkuCode || "—"}
                  disabled
                />
              </Form.Item>
              <Form.Item label="单价" style={{ width: 160 }}>
                <Input
                  value={formatMoney(editUnitPrice, order.currency)}
                  disabled
                />
              </Form.Item>
              <Form.Item label="套餐内件数" style={{ width: 140 }}>
                <Input value={String(editPackageCount)} disabled />
              </Form.Item>
              <Form.Item
                name="quantity"
                label="购买数量"
                rules={[{ required: true, message: "请填写购买数量" }]}
                style={{ width: 140 }}
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="预估总金额" style={{ width: 180 }}>
                <Input
                  value={formatMoney(editPreviewTotal, order.currency)}
                  disabled
                />
              </Form.Item>
            </Space>
            <Space wrap style={{ width: "100%" }} size="middle">
              <Form.Item
                name="owner_member"
                label="归属成员"
                style={{ width: 220 }}
              >
                <Input maxLength={INPUT_LIMITS.shippingMeta} />
              </Form.Item>
              <Form.Item
                name="shipping_order_no"
                label="发货订单号"
                style={{ width: 220 }}
              >
                <Input maxLength={INPUT_LIMITS.shippingMeta} />
              </Form.Item>
            </Space>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
}
