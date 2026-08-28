import { useCallback, useEffect, useMemo, useRef, useState, type Key } from "react";
import {
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { DownloadOutlined, RollbackOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  COD_FORCE_STATUSES,
  ORDER_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  type AddressLibrary,
  type LogisticsShipper,
  type Order,
  type OrderStatus,
  type Paginated,
  type PaymentType,
  type ReviewStatus,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import type { FinanceExportRow } from "../lib/buildFinanceExcel";
import type { LogisticsExportRow } from "../lib/buildLogisticsExcel";
import {
  ALL_ORDER_EXPORT_COLUMN_KEYS,
  ORDER_EXPORT_COLUMNS,
  type OrderExportColumnKey,
  type OrdersExportRow,
} from "../lib/buildOrdersExcel";
import type { ShipExcelRow } from "../lib/parseShipText";
import { parseShipText } from "../lib/parseShipText";
import { formatMoney } from "../lib/formatMoney";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { formatActor } from "../components/AuditLogPanel";
import { OrderEditModal } from "../components/OrderEditModal";
import { setOrdersListFrom } from "../lib/listNav";
import { useAuth } from "../auth/AuthContext";
import dayjs from "dayjs";

/** 解析粘贴的订单号：换行 / 逗号 / 空白 / 分号均可 */
function parseBatchOrderNos(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\s,，;；]+/)) {
    const no = part.trim();
    if (!no || seen.has(no)) continue;
    seen.add(no);
    result.push(no);
  }
  return result;
}

/** 去掉空格、分隔符与 +，并去除前导 0，便于匹配入库手机号 */
function phoneSearchDigits(raw: string): string {
  const n = raw.replace(/[\s\-().+]/g, "").trim();
  if (!n) return "";
  return n.replace(/^0+/, "");
}

/**
 * 解析粘贴的手机号：换行 / 逗号 / 分号分隔。
 * 行内空格保留（如 +62 81218331371 → 6281218331371），不按空格拆成多个号。
 */
function parseBatchPhones(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\n\r,，;；]+/)) {
    const digits = phoneSearchDigits(part);
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    result.push(digits);
  }
  return result;
}

function formatShippingAddress(order: Order): string {
  const region = [
    order.shipping_province,
    order.shipping_city,
    order.shipping_district,
  ]
    .filter(Boolean)
    .join(" ");
  const detail = order.shipping_detail || order.shipping_address || "";
  if (region && detail) return `${region} ${detail}`;
  return region || detail || "—";
}

/** 表格长文本：定宽省略，悬停看全文（配合全局 nowrap / auto 布局） */
function CellEllipsis({
  text,
  maxWidth,
  empty = "—",
}: {
  text: string | null | undefined;
  maxWidth: number;
  empty?: string;
}) {
  const value = (text ?? "").trim() || empty;
  return (
    <Typography.Text
      ellipsis={{ tooltip: value === empty ? undefined : value }}
      style={{
        display: "block",
        maxWidth,
        width: maxWidth,
        margin: 0,
        overflow: "hidden",
      }}
    >
      {value}
    </Typography.Text>
  );
}

function ellipsisCell(maxWidth: number) {
  return {
    style: {
      maxWidth,
      width: maxWidth,
      overflow: "hidden" as const,
    },
  };
}

const { RangePicker } = DatePicker;

const DATE_PRESETS: {
  label: string;
  value: () => [Dayjs, Dayjs];
}[] = [
  {
    label: "今日",
    value: () => [dayjs().startOf("day"), dayjs().endOf("day")],
  },
  {
    label: "昨日",
    value: () => [
      dayjs().subtract(1, "day").startOf("day"),
      dayjs().subtract(1, "day").endOf("day"),
    ],
  },
  {
    label: "近七天",
    value: () => [
      dayjs().subtract(6, "day").startOf("day"),
      dayjs().endOf("day"),
    ],
  },
  {
    label: "本月",
    value: () => [dayjs().startOf("month"), dayjs().endOf("day")],
  },
  {
    label: "近三个月",
    value: () => [
      dayjs().subtract(3, "month").startOf("day"),
      dayjs().endOf("day"),
    ],
  },
];

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

/** COD 订单子类 */
export const COD_TABS = [
  {
    key: "all",
    label: "全部订单",
    paymentType: "cod" as const,
  },
  {
    key: "pending_review",
    label: "待审核",
    paymentType: "cod" as const,
    reviewStatus: "pending" as const,
    status: "awaiting_review" as OrderStatus,
  },
  {
    key: "awaiting_confirm",
    label: "待确认",
    paymentType: "cod" as const,
    reviewStatus: "approved" as const,
    status: "awaiting_confirm" as OrderStatus,
  },
  {
    key: "awaiting_shipment",
    label: "待发货",
    paymentType: "cod" as const,
    // 仅已通过审核且处于待发货，不含待审核/无效订单
    reviewStatus: "approved" as const,
    status: "awaiting_shipment" as OrderStatus,
  },
  {
    key: "shipped",
    label: "已发货",
    paymentType: "cod" as const,
    reviewStatus: "approved" as const,
    status: "cod_shipped" as OrderStatus,
  },
  {
    key: "completed",
    label: "已签收",
    paymentType: "cod" as const,
    reviewStatus: "approved" as const,
    status: "cod_completed" as OrderStatus,
  },
  {
    key: "refused",
    label: "拒绝签收",
    paymentType: "cod" as const,
    reviewStatus: "approved" as const,
    status: "cod_refused" as OrderStatus,
  },
  {
    key: "invalid",
    label: "无效订单",
    paymentType: "cod" as const,
    status: "cancelled" as OrderStatus,
  },
] as const;

export type CodTabKey = (typeof COD_TABS)[number]["key"];

const DEFAULT_COD_TAB: CodTabKey = "pending_review";

export function OrdersPage() {
  const navigate = useNavigate();
  const { profile, user, isSuperAdmin } = useAuth();
  const { tab: routeTab } = useParams<{ tab?: string }>();
  const defaultOwnerMember =
    profile?.display_name?.trim() ||
    profile?.email?.trim() ||
    user?.email?.trim() ||
    "";

  const activeCodTab: CodTabKey = COD_TABS.some((t) => t.key === routeTab)
    ? (routeTab as CodTabKey)
    : DEFAULT_COD_TAB;

  const [loading, setLoading] = useState(false);
  const [batching, setBatching] = useState(false);
  const [orderNo, setOrderNo] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shippingOrderNo, setShippingOrderNo] = useState("");
  const [batchOrderNos, setBatchOrderNos] = useState<string[]>([]);
  const [batchPhones, setBatchPhones] = useState<string[]>([]);
  const [batchShippingOrderNos, setBatchShippingOrderNos] = useState<string[]>(
    [],
  );
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchPhoneModalOpen, setBatchPhoneModalOpen] = useState(false);
  const [batchShippingModalOpen, setBatchShippingModalOpen] = useState(false);
  const [batchDraft, setBatchDraft] = useState("");
  const [batchPhoneDraft, setBatchPhoneDraft] = useState("");
  const [batchShippingDraft, setBatchShippingDraft] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [regionId, setRegionId] = useState<string | undefined>();
  const [regions, setRegions] = useState<AddressLibrary[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<Order[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const pendingBatchNotify = useRef<
    "order_no" | "phone" | "shipping_order_no" | null
  >(null);

  const [remarkModalOpen, setRemarkModalOpen] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState("");
  const [invalidModalOpen, setInvalidModalOpen] = useState(false);
  const [invalidReason, setInvalidReason] = useState("");
  const [forceStatusModalOpen, setForceStatusModalOpen] = useState(false);
  const [forceStatusTarget, setForceStatusTarget] = useState<OrderStatus>(
    "awaiting_confirm",
  );
  const [forceStatusRemark, setForceStatusRemark] = useState("");
  const [forceStatusRejectReason, setForceStatusRejectReason] = useState("");
  const [editOrderId, setEditOrderId] = useState<string | null>(null);

  const [shipModalOpen, setShipModalOpen] = useState(false);
  const [shipRows, setShipRows] = useState<ShipExcelRow[]>([]);
  const [shipFileName, setShipFileName] = useState("");
  const [shipTextDraft, setShipTextDraft] = useState("");
  const [shipTextError, setShipTextError] = useState<string | null>(null);
  const [shippers, setShippers] = useState<LogisticsShipper[]>([]);
  const [selectedShipperId, setSelectedShipperId] = useState<string>();
  const [shipForm] = Form.useForm<{ owner_member: string }>();

  const [exportOpen, setExportOpen] = useState(false);
  const [exportKind, setExportKind] = useState<
    "finance" | "logistics" | "orders"
  >("finance");
  const [exporting, setExporting] = useState(false);
  const [exportMetaLoading, setExportMetaLoading] = useState(false);
  const [exportProducts, setExportProducts] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [exportProductIds, setExportProductIds] = useState<string[]>([]);
  const [exportColumnKeys, setExportColumnKeys] = useState<OrderExportColumnKey[]>(
    ALL_ORDER_EXPORT_COLUMN_KEYS,
  );

  const isAllTab = activeCodTab === "all";
  const isPendingReview = activeCodTab === "pending_review";
  const isAwaitingConfirmTab = activeCodTab === "awaiting_confirm";
  const isAwaitingShipmentTab = activeCodTab === "awaiting_shipment";
  const isShippedTab = activeCodTab === "shipped";
  const isCompletedTab = activeCodTab === "completed";
  const isRefusedTab = activeCodTab === "refused";
  const isInvalidTab = activeCodTab === "invalid";
  const showRevertButton = activeCodTab !== "pending_review";
  /** 全部订单、待发货及之后状态支持运单号查询 */
  const showWaybillSearch =
    isAllTab ||
    isAwaitingShipmentTab ||
    isShippedTab ||
    isCompletedTab ||
    isRefusedTab ||
    isInvalidTab;
  const isBatchOrderQuery = batchOrderNos.length > 0;
  const isBatchPhoneQuery = batchPhones.length > 0;
  const isBatchShippingQuery = batchShippingOrderNos.length > 0;
  const isBatchQuery =
    isBatchOrderQuery || isBatchPhoneQuery || isBatchShippingQuery;
  const enableRowSelection =
    isPendingReview ||
    isAwaitingConfirmTab ||
    isAwaitingShipmentTab ||
    isShippedTab ||
    isInvalidTab ||
    isSuperAdmin;
  const exportOrderStatus:
    | "awaiting_confirm"
    | "cod_shipped"
    | "cod_completed"
    | null = isAwaitingConfirmTab
    ? "awaiting_confirm"
    : isShippedTab
      ? "cod_shipped"
      : isCompletedTab
        ? "cod_completed"
        : null;

  const filters = useMemo(() => {
    const current = COD_TABS.find((t) => t.key === activeCodTab)!;
    return {
      paymentType: current.paymentType as PaymentType,
      reviewStatus: ("reviewStatus" in current
        ? current.reviewStatus
        : undefined) as ReviewStatus | undefined,
      status: ("status" in current ? current.status : undefined) as
        | OrderStatus
        | undefined,
    };
  }, [activeCodTab]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        payment_type: filters.paymentType,
      });

      // 批量查询仍沿用当前 Tab 的 status / review_status，不跳转到全部订单
      if (filters.reviewStatus) {
        params.set("review_status", filters.reviewStatus);
      }
      if (filters.status) {
        params.set("status", filters.status);
      }
      if (isBatchOrderQuery) {
        params.set("order_nos", batchOrderNos.join(","));
      } else if (isBatchPhoneQuery) {
        params.set("customer_phones", batchPhones.join(","));
      } else if (isBatchShippingQuery) {
        params.set("shipping_order_nos", batchShippingOrderNos.join(","));
      } else {
        if (orderNo.trim()) params.set("order_no", orderNo.trim());
        const phone = phoneSearchDigits(customerPhone);
        if (phone) params.set("customer_phone", phone);
        if (showWaybillSearch && shippingOrderNo.trim()) {
          params.set("shipping_order_no", shippingOrderNo.trim());
        }
      }
      if (dateRange?.[0] && dateRange?.[1]) {
        params.set("date_from", dateRange[0].startOf("day").toISOString());
        params.set("date_to", dateRange[1].endOf("day").toISOString());
      }
      if (regionId) {
        params.set("region_id", regionId);
      }

      const res = await apiFetch<Paginated<Order>>(
        `/api/orders?${params.toString()}`,
      );
      setData(res.data);
      setTotal(res.total);

      const notifyKind = pendingBatchNotify.current;
      if (notifyKind) {
        pendingBatchNotify.current = null;
        const queryItems =
          notifyKind === "order_no"
            ? batchOrderNos
            : notifyKind === "phone"
              ? batchPhones
              : batchShippingOrderNos;
        if (res.total === 0) {
          message.warning("未找到匹配的订单");
        } else if (
          notifyKind === "order_no" &&
          res.total < batchOrderNos.length &&
          res.data.length === res.total
        ) {
          const found = new Set(res.data.map((o) => o.order_no));
          const missing = batchOrderNos.filter((no) => !found.has(no));
          const preview = missing.slice(0, 5).join("、");
          const more =
            missing.length > 5 ? ` 等 ${missing.length} 个` : "";
          message.info(
            `已找到 ${res.total} 笔；未匹配：${preview}${more}`,
          );
        } else if (
          notifyKind === "shipping_order_no" &&
          res.total < batchShippingOrderNos.length &&
          res.data.length === res.total
        ) {
          const found = new Set(
            res.data
              .map((o) => o.shipping_order_no?.trim() || "")
              .filter(Boolean),
          );
          const missing = batchShippingOrderNos.filter(
            (no) => !found.has(no),
          );
          const preview = missing.slice(0, 5).join("、");
          const more =
            missing.length > 5 ? ` 等 ${missing.length} 个` : "";
          message.info(
            `已找到 ${res.total} 笔；未匹配运单号：${preview}${more}`,
          );
        } else if (
          notifyKind === "phone" &&
          res.data.length === res.total
        ) {
          const missing = batchPhones.filter(
            (p) =>
              !res.data.some((o) =>
                phoneSearchDigits(o.customer_phone ?? "").includes(p) ||
                (o.customer_phone ?? "").includes(p),
              ),
          );
          if (missing.length > 0) {
            const preview = missing.slice(0, 5).join("、");
            const more =
              missing.length > 5 ? ` 等 ${missing.length} 个` : "";
            message.info(
              `已找到 ${res.total} 笔；未匹配电话：${preview}${more}`,
            );
          } else {
            message.success(
              `已找到 ${res.total} 笔订单（查询 ${queryItems.length} 个电话）`,
            );
          }
        } else {
          message.success(
            `已找到 ${res.total} 笔订单（查询 ${queryItems.length} 个）`,
          );
        }
      }
    } catch (e) {
      pendingBatchNotify.current = null;
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    filters,
    orderNo,
    customerPhone,
    shippingOrderNo,
    batchOrderNos,
    batchPhones,
    batchShippingOrderNos,
    isBatchOrderQuery,
    isBatchPhoneQuery,
    isBatchShippingQuery,
    showWaybillSearch,
    dateRange,
    regionId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 离开支持运单查询的 Tab 时清空运单筛选，避免状态残留 */
  useEffect(() => {
    if (!showWaybillSearch) {
      setShippingOrderNo("");
      setBatchShippingOrderNos([]);
      setBatchShippingDraft("");
    }
  }, [showWaybillSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRegionsLoading(true);
      try {
        const res = await apiFetch<{ data: AddressLibrary[] }>(
          "/api/address-libraries",
        );
        if (!cancelled) setRegions(res.data);
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载地区失败");
        }
      } finally {
        if (!cancelled) setRegionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 进入无效 COD 子路径时纠正到默认项
  useEffect(() => {
    if (!routeTab || !COD_TABS.some((t) => t.key === routeTab)) {
      navigate(`/cod/${DEFAULT_COD_TAB}`, { replace: true });
    }
  }, [routeTab, navigate]);

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [
    activeCodTab,
    page,
    pageSize,
    orderNo,
    customerPhone,
    shippingOrderNo,
    batchOrderNos,
    batchPhones,
    batchShippingOrderNos,
    dateRange,
  ]);

  const applyBatchQuery = () => {
    const nos = parseBatchOrderNos(batchDraft);
    if (nos.length === 0) {
      message.warning("请粘贴至少一个订单号");
      return;
    }
    pendingBatchNotify.current = "order_no";
    setOrderNo("");
    setCustomerPhone("");
    setShippingOrderNo("");
    setBatchPhones([]);
    setBatchPhoneDraft("");
    setBatchShippingOrderNos([]);
    setBatchShippingDraft("");
    setBatchOrderNos(nos);
    setPage(1);
    setPageSize(Math.max(nos.length, 20));
    setBatchModalOpen(false);
  };

  const clearBatchQuery = () => {
    setBatchOrderNos([]);
    setBatchDraft("");
    setPage(1);
    setPageSize(20);
  };

  const applyBatchPhoneQuery = () => {
    const phones = parseBatchPhones(batchPhoneDraft);
    if (phones.length === 0) {
      message.warning("请粘贴至少一个手机号");
      return;
    }
    pendingBatchNotify.current = "phone";
    setOrderNo("");
    setCustomerPhone("");
    setShippingOrderNo("");
    setBatchOrderNos([]);
    setBatchDraft("");
    setBatchShippingOrderNos([]);
    setBatchShippingDraft("");
    setBatchPhones(phones);
    setPage(1);
    setPageSize(Math.max(phones.length, 20));
    setBatchPhoneModalOpen(false);
  };

  const clearBatchPhoneQuery = () => {
    setBatchPhones([]);
    setBatchPhoneDraft("");
    setPage(1);
    setPageSize(20);
  };

  const applyBatchShippingQuery = () => {
    const nos = parseBatchOrderNos(batchShippingDraft);
    if (nos.length === 0) {
      message.warning("请粘贴至少一个运单号");
      return;
    }
    pendingBatchNotify.current = "shipping_order_no";
    setOrderNo("");
    setCustomerPhone("");
    setShippingOrderNo("");
    setBatchOrderNos([]);
    setBatchDraft("");
    setBatchPhones([]);
    setBatchPhoneDraft("");
    setBatchShippingOrderNos(nos);
    setPage(1);
    setPageSize(Math.max(nos.length, 20));
    setBatchShippingModalOpen(false);
  };

  const clearBatchShippingQuery = () => {
    setBatchShippingOrderNos([]);
    setBatchShippingDraft("");
    setPage(1);
    setPageSize(20);
  };

  const batchApprove = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要审核的订单");
      return;
    }
    Modal.confirm({
      title: "批量通过审核",
      content: `确认通过选中的 ${selectedRowKeys.length} 笔订单？通过后将进入待确认。`,
      okText: "确认通过",
      cancelText: "取消",
      onOk: async () => {
        setBatching(true);
        try {
          const res = await apiFetch<{
            succeeded: string[];
            failed: Array<{ id: string; error: string }>;
          }>("/api/orders/batch-review", {
            method: "POST",
            body: JSON.stringify({
              ids: selectedRowKeys,
              decision: "approved",
            }),
          });
          const ok = res.succeeded.length;
          const fail = res.failed.length;
          if (fail === 0) {
            message.success(`已通过 ${ok} 笔订单`);
          } else {
            const reason = res.failed[0]?.error
              ? `：${res.failed[0].error}`
              : "";
            message.warning(`通过 ${ok} 笔，失败 ${fail} 笔${reason}`);
          }
          setSelectedRowKeys([]);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "批量审核失败");
        } finally {
          setBatching(false);
        }
      },
    });
  };

  const batchConfirm = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要确认的订单");
      return;
    }
    Modal.confirm({
      title: "批量确认",
      content: `确认选中的 ${selectedRowKeys.length} 笔订单？确认后将进入待发货。`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        setBatching(true);
        try {
          const res = await apiFetch<{
            succeeded: string[];
            failed: Array<{ id: string; error: string }>;
          }>("/api/orders/batch-confirm", {
            method: "POST",
            body: JSON.stringify({ ids: selectedRowKeys }),
          });
          const ok = res.succeeded.length;
          const fail = res.failed.length;
          if (fail === 0) {
            message.success(`已确认 ${ok} 笔订单`);
          } else {
            message.warning(`确认 ${ok} 笔，失败 ${fail} 笔`);
          }
          setSelectedRowKeys([]);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "批量确认失败");
        } finally {
          setBatching(false);
        }
      },
    });
  };

  const openRemarkModal = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要填写备注的订单");
      return;
    }
    setRemarkDraft("");
    setRemarkModalOpen(true);
  };

  const openInvalidModal = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要转无效的订单");
      return;
    }
    setInvalidReason("");
    setInvalidModalOpen(true);
  };

  const submitBatchInvalidate = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要转无效的订单");
      return;
    }
    const reason = invalidReason.trim();
    if (!reason) {
      message.warning("请填写拒绝理由");
      return;
    }
    setBatching(true);
    try {
      const res = await apiFetch<{
        succeeded: string[];
        failed: Array<{ id: string; error: string }>;
      }>("/api/orders/batch-invalidate", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedRowKeys,
          reject_reason: reason,
        }),
      });
      const ok = res.succeeded.length;
      const fail = res.failed.length;
      if (fail === 0) {
        message.success(`已转无效 ${ok} 笔订单`);
      } else {
        const detail = res.failed[0]?.error
          ? `：${res.failed[0].error}`
          : "";
        message.warning(`转无效 ${ok} 笔，失败 ${fail} 笔${detail}`);
      }
      setInvalidModalOpen(false);
      setInvalidReason("");
      setSelectedRowKeys([]);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量转无效失败");
    } finally {
      setBatching(false);
    }
  };

  const submitBatchRemark = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要填写备注的订单");
      return;
    }
    setBatching(true);
    try {
      const res = await apiFetch<{
        succeeded: string[];
        failed: Array<{ id: string; error: string }>;
      }>("/api/orders/batch-remark", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedRowKeys,
          remark: remarkDraft.trim() || null,
        }),
      });
      const ok = res.succeeded.length;
      const fail = res.failed.length;
      if (fail === 0) {
        message.success(`已填写 ${ok} 笔订单备注`);
      } else {
        message.warning(`填写 ${ok} 笔，失败 ${fail} 笔`);
      }
      setRemarkModalOpen(false);
      setRemarkDraft("");
      setSelectedRowKeys([]);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量填写备注失败");
    } finally {
      setBatching(false);
    }
  };

  const batchComplete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要签收的订单");
      return;
    }
    Modal.confirm({
      title: "批量签收",
      content: `确认签收选中的 ${selectedRowKeys.length} 笔已发货订单？签收后将进入已签收。`,
      okText: "确认签收",
      cancelText: "取消",
      onOk: async () => {
        setBatching(true);
        try {
          const res = await apiFetch<{
            succeeded: string[];
            failed: Array<{ id: string; error: string }>;
          }>("/api/orders/batch-complete", {
            method: "POST",
            body: JSON.stringify({ ids: selectedRowKeys }),
          });
          const ok = res.succeeded.length;
          const fail = res.failed.length;
          if (fail === 0) {
            message.success(`已签收 ${ok} 笔订单`);
          } else {
            message.warning(`签收 ${ok} 笔，失败 ${fail} 笔`);
          }
          setSelectedRowKeys([]);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "批量签收失败");
        } finally {
          setBatching(false);
        }
      },
    });
  };

  const batchRefuse = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要拒绝签收的订单");
      return;
    }
    Modal.confirm({
      title: "批量拒绝签收",
      content: `确认将选中的 ${selectedRowKeys.length} 笔已发货订单标记为拒绝签收？`,
      okText: "确认拒绝签收",
      cancelText: "取消",
      onOk: async () => {
        setBatching(true);
        try {
          const res = await apiFetch<{
            succeeded: string[];
            failed: Array<{ id: string; error: string }>;
          }>("/api/orders/batch-refuse", {
            method: "POST",
            body: JSON.stringify({ ids: selectedRowKeys }),
          });
          const ok = res.succeeded.length;
          const fail = res.failed.length;
          if (fail === 0) {
            message.success(`已拒绝签收 ${ok} 笔订单`);
          } else {
            message.warning(`拒绝签收 ${ok} 笔，失败 ${fail} 笔`);
          }
          setSelectedRowKeys([]);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "批量拒绝签收失败");
        } finally {
          setBatching(false);
        }
      },
    });
  };

  const batchRevert = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要恢复的订单");
      return;
    }
    Modal.confirm({
      title: "恢复上一步",
      content: `确认将选中的 ${selectedRowKeys.length} 笔订单恢复到上一步状态？`,
      okText: "确认恢复",
      cancelText: "取消",
      onOk: async () => {
        setBatching(true);
        try {
          const res = await apiFetch<{
            succeeded: Array<{ id: string; previous_status: OrderStatus | null }>;
            failed: Array<{ id: string; error: string }>;
          }>("/api/orders/batch-revert", {
            method: "POST",
            body: JSON.stringify({ ids: selectedRowKeys }),
          });
          const ok = res.succeeded.length;
          const fail = res.failed.length;
          if (fail === 0) {
            message.success(`已恢复 ${ok} 笔订单`);
          } else {
            const detail = res.failed[0]?.error
              ? `：${res.failed[0].error}`
              : "";
            message.warning(`恢复 ${ok} 笔，失败 ${fail} 笔${detail}`);
          }
          setSelectedRowKeys([]);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "恢复上一步失败");
        } finally {
          setBatching(false);
        }
      },
    });
  };

  const openForceStatusModal = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要流转的订单");
      return;
    }
    setForceStatusTarget("awaiting_confirm");
    setForceStatusRemark("");
    setForceStatusRejectReason("");
    setForceStatusModalOpen(true);
  };

  const submitBatchForceStatus = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要流转的订单");
      return;
    }
    if (forceStatusTarget === "cancelled" && !forceStatusRejectReason.trim()) {
      message.warning("流转到无效订单时请填写理由");
      return;
    }

    setBatching(true);
    try {
      const res = await apiFetch<{
        succeeded: string[];
        failed: Array<{ id: string; error: string }>;
      }>("/api/orders/batch-force-status", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedRowKeys,
          status: forceStatusTarget,
          remark: forceStatusRemark.trim() || undefined,
          reject_reason:
            forceStatusTarget === "cancelled"
              ? forceStatusRejectReason.trim()
              : undefined,
        }),
      });
      const ok = res.succeeded.length;
      const fail = res.failed.length;
      if (fail === 0) {
        message.success(
          `已强制流转 ${ok} 笔订单至「${ORDER_STATUS_LABELS[forceStatusTarget]}」`,
        );
      } else {
        const detail = res.failed[0]?.error ? `：${res.failed[0].error}` : "";
        message.warning(`流转 ${ok} 笔，失败 ${fail} 笔${detail}`);
      }
      setForceStatusModalOpen(false);
      setForceStatusRemark("");
      setForceStatusRejectReason("");
      setSelectedRowKeys([]);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "强制流转失败");
    } finally {
      setBatching(false);
    }
  };

  const batchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要删除的订单");
      return;
    }
    Modal.confirm({
      title: "批量删除订单",
      content: `确认永久删除选中的 ${selectedRowKeys.length} 笔无效订单？此操作不可恢复。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBatching(true);
        try {
          const res = await apiFetch<{
            succeeded: string[];
            failed: Array<{ id: string; error: string }>;
          }>("/api/orders/batch-delete", {
            method: "POST",
            body: JSON.stringify({ ids: selectedRowKeys }),
          });
          const ok = res.succeeded.length;
          const fail = res.failed.length;
          if (fail === 0) {
            message.success(`已删除 ${ok} 笔订单`);
          } else {
            const detail = res.failed[0]?.error
              ? `：${res.failed[0].error}`
              : "";
            message.warning(`删除 ${ok} 笔，失败 ${fail} 笔${detail}`);
          }
          setSelectedRowKeys([]);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "批量删除失败");
        } finally {
          setBatching(false);
        }
      },
    });
  };

  const resetShipModal = () => {
    setShipModalOpen(false);
    setShipRows([]);
    setShipFileName("");
    setShipTextDraft("");
    setShipTextError(null);
    setSelectedShipperId(undefined);
    shipForm.resetFields();
  };

  const resetExportModal = () => {
    setExportOpen(false);
    setExportProductIds([]);
    setExportColumnKeys(ALL_ORDER_EXPORT_COLUMN_KEYS);
  };

  const openExportModal = async (
    kind: "finance" | "logistics" | "orders",
  ) => {
    if (kind === "finance" && !isShippedTab) return;
    if (kind === "logistics" && !exportOrderStatus) return;
    if (kind === "orders" && !isAllTab) return;

    setExportKind(kind);
    setExportOpen(true);
    setExportProductIds([]);
    setExportColumnKeys(ALL_ORDER_EXPORT_COLUMN_KEYS);
    setExportMetaLoading(true);
    try {
      const status =
        kind === "finance"
          ? "cod_shipped"
          : kind === "logistics"
            ? (exportOrderStatus ?? "cod_shipped")
            : "cod_shipped";
      const metaParams = new URLSearchParams({ status });
      if (regionId) metaParams.set("region_id", regionId);
      const res = await apiFetch<{
        products: Array<{ id: string; name: string }>;
        owner_members: string[];
      }>(`/api/orders/finance-export/meta?${metaParams.toString()}`);
      setExportProducts(res.products ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载导出选项失败");
    } finally {
      setExportMetaLoading(false);
    }
  };

  const submitExport = async () => {
    if (exportKind === "logistics" && !exportOrderStatus) {
      message.warning("当前列表不支持物流导出");
      return;
    }
    if (exportKind === "orders" && !isAllTab) {
      message.warning("当前列表不支持全部订单导出");
      return;
    }
    if (exportKind === "orders" && exportColumnKeys.length === 0) {
      message.warning("请至少选择一列导出");
      return;
    }

    setExporting(true);
    try {
      const payload: Record<string, unknown> = {
        product_ids: exportProductIds,
      };
      if (regionId) {
        payload.region_id = regionId;
      }

      // 沿用列表页当前筛选条件（日期 / 单号 / 电话 / 批量查询）
      if (dateRange?.[0] && dateRange?.[1]) {
        payload.date_from = dateRange[0].startOf("day").toISOString();
        payload.date_to = dateRange[1].endOf("day").toISOString();
      }
      if (isBatchOrderQuery) {
        payload.order_nos = batchOrderNos;
      } else if (isBatchPhoneQuery) {
        payload.customer_phones = batchPhones;
      } else if (isBatchShippingQuery) {
        payload.shipping_order_nos = batchShippingOrderNos;
      } else {
        if (orderNo.trim()) payload.order_no = orderNo.trim();
        const phone = phoneSearchDigits(customerPhone);
        if (phone) payload.customer_phone = phone;
        if (showWaybillSearch && shippingOrderNo.trim()) {
          payload.shipping_order_no = shippingOrderNo.trim();
        }
      }

      if (exportKind === "finance") {
        const res = await apiFetch<{
          data: FinanceExportRow[];
          total: number;
          truncated?: boolean;
        }>("/api/orders/finance-export", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!res.data.length) {
          message.warning("没有符合条件的已发货订单");
          return;
        }
        const { buildFinanceExcel, financeExportFilename } = await import(
          "../lib/buildFinanceExcel"
        );
        const { downloadBlob } = await import("../lib/downloadBlob");
        downloadBlob(buildFinanceExcel(res.data), financeExportFilename());
        if (res.truncated) {
          message.warning(
            `已导出前 ${res.total} 笔（达到上限），请缩小筛选条件后重试`,
          );
        } else {
          message.success(`已导出 ${res.total} 笔订单`);
        }
      } else if (exportKind === "orders") {
        const res = await apiFetch<{
          data: OrdersExportRow[];
          total: number;
          truncated?: boolean;
        }>("/api/orders/full-export", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!res.data.length) {
          message.warning("没有符合条件的订单");
          return;
        }
        const [{ buildOrdersExcel, ordersExportFilename }, { downloadBlob }] =
          await Promise.all([
            import("../lib/buildOrdersExcel"),
            import("../lib/downloadBlob"),
          ]);
        downloadBlob(
          buildOrdersExcel(res.data, exportColumnKeys),
          ordersExportFilename(),
        );
        if (res.truncated) {
          message.warning(
            `已导出前 ${res.total} 笔（达到上限），请缩小筛选条件后重试`,
          );
        } else {
          message.success(`已导出 ${res.total} 笔订单`);
        }
      } else {
        const res = await apiFetch<{
          data: LogisticsExportRow[];
          total: number;
          truncated?: boolean;
        }>("/api/orders/logistics-export", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            status: exportOrderStatus,
          }),
        });
        if (!res.data.length) {
          message.warning("没有符合条件的订单");
          return;
        }
        const statusLabel =
          exportOrderStatus === "awaiting_confirm"
            ? "待确认"
            : exportOrderStatus === "cod_shipped"
              ? "已发货"
              : "已签收";
        const [{ buildLogisticsExcel, logisticsExportFilename }, { downloadBlob }] =
          await Promise.all([
            import("../lib/buildLogisticsExcel"),
            import("../lib/downloadBlob"),
          ]);
        downloadBlob(
          await buildLogisticsExcel(res.data),
          logisticsExportFilename(statusLabel),
        );
        if (res.truncated) {
          message.warning(
            `已导出前 ${res.total} 笔（达到上限），请缩小筛选条件后重试`,
          );
        } else {
          message.success(`已导出 ${res.total} 笔订单`);
        }
      }
      resetExportModal();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  /** 粘贴发货文本后自动解析预览 */
  useEffect(() => {
    if (!shipModalOpen) return;
    const raw = shipTextDraft;
    if (!raw.trim()) {
      setShipTextError(null);
      // 空文本时保留 Excel 解析结果
      if (!shipFileName) setShipRows([]);
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        const parsed = parseShipText(raw);
        setShipRows(parsed.rows);
        setShipFileName("");
        setShipTextError(null);
      } catch (e) {
        setShipRows([]);
        setShipTextError(e instanceof Error ? e.message : "解析文本失败");
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [shipTextDraft, shipModalOpen, shipFileName]);

  const openShipModal = async () => {
    setShipModalOpen(true);
    shipForm.setFieldsValue({ owner_member: defaultOwnerMember });
    try {
      const res = await apiFetch<{ data: LogisticsShipper[] }>("/api/shippers");
      const list = res.data ?? [];
      setShippers(list);
      const def = list.find((s) => s.is_default) ?? list[0];
      if (def) setSelectedShipperId(def.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载寄件人失败");
    }
  };

  const onShipExcelSelected = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const { parseShipExcel } = await import("../lib/parseShipExcel");
      const parsed = parseShipExcel(buffer);
      setShipFileName(file.name);
      setShipTextDraft("");
      setShipTextError(null);
      setShipRows(parsed.rows);
      message.success(`已解析 ${parsed.rows.length} 行（${file.name}）`);
    } catch (e) {
      setShipRows([]);
      setShipFileName("");
      message.error(e instanceof Error ? e.message : "解析 Excel 失败");
    }
    return false;
  };

  const submitBatchShip = async () => {
    if (shipTextDraft.trim() && shipTextError) {
      message.error(shipTextError);
      return;
    }
    if (shipRows.length === 0) {
      message.warning("请先粘贴发货文本或上传 Excel");
      return;
    }
    if (!selectedShipperId) {
      message.warning("请选择寄件人");
      return;
    }
    let ownerMember = "";
    try {
      const values = await shipForm.validateFields();
      ownerMember = values.owner_member.trim();
    } catch {
      return;
    }

    setBatching(true);
    try {
      const res = await apiFetch<{
        succeeded: Array<{ id: string; order_no: string }>;
        failed: Array<{ order_no: string; error: string }>;
      }>("/api/orders/batch-ship", {
        method: "POST",
        body: JSON.stringify({
          items: shipRows.map((r) => ({
            order_no: r.order_no,
            shipping_order_no: r.shipping_order_no,
          })),
          shipper_id: selectedShipperId,
          owner_member: ownerMember,
        }),
      });
      const ok = res.succeeded.length;
      const fail = res.failed.length;
      if (fail === 0) {
        message.success(`已发货 ${ok} 笔订单`);
        resetShipModal();
      } else {
        const preview = res.failed
          .slice(0, 3)
          .map((f) => `${f.order_no}：${f.error}`)
          .join("；");
        const more = fail > 3 ? ` 等 ${fail} 笔` : "";
        message.warning(`发货成功 ${ok} 笔，失败 ${fail} 笔。${preview}${more}`);
        if (ok > 0) {
          const failedNos = new Set(res.failed.map((f) => f.order_no));
          // 同步文本，避免自动解析又把成功单加回来
          const remain = shipRows.filter((r) => failedNos.has(r.order_no));
          setShipRows(remain);
          setShipTextDraft(
            remain
              .map((r) => `${r.order_no}\t${r.shipping_order_no}`)
              .join("\n"),
          );
          await load();
        }
      }
      if (fail === 0) await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量发货失败");
    } finally {
      setBatching(false);
    }
  };

  const columns: ColumnsType<Order> = [
    {
      title: "操作",
      key: "actions",
      width: 148,
      fixed: "left",
      render: (_, record) => {
        const actionLabel =
          record.review_status === "pending"
            ? "去审核"
            : record.status === "awaiting_confirm"
              ? "去确认"
              : record.status === "awaiting_shipment"
                ? "去发货"
                : record.status === "cod_shipped"
                  ? "去签收"
                  : "详情";
        return (
          <Space size={4}>
            <Button
              size="small"
              onClick={() => setEditOrderId(record.id)}
            >
              编辑
            </Button>
            <Button
              size="small"
              onClick={() => {
                const from = `/cod/${activeCodTab}`;
                setOrdersListFrom(from);
                navigate(`/orders/${record.id}`, { state: { from } });
              }}
            >
              {actionLabel}
            </Button>
          </Space>
        );
      },
    },
    {
      title: "订单号",
      dataIndex: "order_no",
      width: 160,
      ellipsis: true,
      onCell: () => ellipsisCell(160),
      onHeaderCell: () => ellipsisCell(160),
      render: (v: string) => <CellEllipsis text={v} maxWidth={144} />,
    },
    {
      title: "商品",
      dataIndex: "product_name",
      width: 120,
      ellipsis: true,
      onCell: () => ellipsisCell(120),
      onHeaderCell: () => ellipsisCell(120),
      render: (v: string) => <CellEllipsis text={v} maxWidth={104} />,
    },
    {
      title: "套餐",
      dataIndex: "package_name",
      width: 120,
      ellipsis: true,
      onCell: () => ellipsisCell(120),
      onHeaderCell: () => ellipsisCell(120),
      render: (v: string | null) => <CellEllipsis text={v} maxWidth={104} />,
    },
    {
      title: "客户",
      dataIndex: "customer_name",
      width: 96,
      ellipsis: true,
      onCell: () => ellipsisCell(96),
      onHeaderCell: () => ellipsisCell(96),
      render: (v: string) => <CellEllipsis text={v} maxWidth={80} />,
    },
    {
      title: "电话",
      dataIndex: "customer_phone",
      width: 120,
      ellipsis: true,
      onCell: () => ellipsisCell(120),
      onHeaderCell: () => ellipsisCell(120),
      render: (v: string | null) => <CellEllipsis text={v} maxWidth={104} />,
    },
    {
      title: "订单创建日期",
      dataIndex: "created_at",
      width: 150,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "订单备注",
      dataIndex: "remark",
      width: 140,
      ellipsis: true,
      onCell: () => ellipsisCell(140),
      onHeaderCell: () => ellipsisCell(140),
      render: (v: string | null) => (
        <CellEllipsis text={v} maxWidth={124} />
      ),
    },
    ...(isPendingReview
      ? [
          {
            title: "收件地址",
            key: "shipping_address",
            width: 320,
            ellipsis: true,
            onCell: () => ellipsisCell(320),
            onHeaderCell: () => ellipsisCell(320),
            render: (_: unknown, row: Order) => (
              <CellEllipsis
                text={formatShippingAddress(row)}
                maxWidth={304}
              />
            ),
          } satisfies ColumnsType<Order>[number],
        ]
      : []),
    {
      title: "金额",
      dataIndex: "total_amount",
      width: 120,
      render: (v: number, row) => formatMoney(v, row.currency),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 88,
      render: (s: OrderStatus) => (
        <Tag color={statusColor[s]}>{ORDER_STATUS_LABELS[s]}</Tag>
      ),
    },
    ...(isInvalidTab
      ? [
          {
            title: "拒绝理由",
            dataIndex: "reject_reason",
            width: 160,
            ellipsis: true,
            onCell: () => ellipsisCell(160),
            onHeaderCell: () => ellipsisCell(160),
            render: (v: string | null) => (
              <CellEllipsis text={v} maxWidth={144} />
            ),
          } satisfies ColumnsType<Order>[number],
        ]
      : [
          {
            title: "审核",
            dataIndex: "review_status",
            width: 88,
            render: (v: ReviewStatus | null | undefined) => {
              const s = (v ?? "pending") as ReviewStatus;
              const color =
                s === "pending"
                  ? "orange"
                  : s === "approved"
                    ? "green"
                    : s === "rejected"
                      ? "red"
                      : "default";
              return <Tag color={color}>{REVIEW_STATUS_LABELS[s]}</Tag>;
            },
          } satisfies ColumnsType<Order>[number],
        ]),
    {
      title: "审核人",
      width: 88,
      ellipsis: true,
      onCell: () => ellipsisCell(88),
      onHeaderCell: () => ellipsisCell(88),
      render: (_, row) => (
        <CellEllipsis text={formatActor(row.reviewer)} maxWidth={72} />
      ),
    },
    {
      title: "最近更新时间",
      dataIndex: "updated_at",
      width: 150,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-title">
          <h1>COD订单</h1>
          <span className="list-count">共 {total} 条</span>
        </div>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="全部地区"
          loading={regionsLoading}
          style={{ width: 200 }}
          value={regionId}
          onChange={(v) => {
            setPage(1);
            setRegionId(v);
          }}
          options={regions.map((r) => ({ value: r.id, label: r.name }))}
        />
      </div>
      <p style={{ color: "#666", marginTop: -8, marginBottom: 12 }}>
        {isAllTab
          ? "展示全部 COD 订单。支持按订单号、手机号搜索，或批量粘贴查询。"
          : "货到付款订单须网站管理审核通过后，方可发货。可在左侧切换 COD 子状态。"}
      </p>
      <Tabs
        activeKey={activeCodTab}
        onChange={(key) => {
          setPage(1);
          navigate(`/cod/${key}`);
        }}
        items={COD_TABS.map((t) => ({
          key: t.key,
          label: t.label,
        }))}
      />
      <Space style={{ marginBottom: 16 }} wrap>
        <RangePicker
          value={dateRange}
          allowClear
          presets={DATE_PRESETS}
          onChange={(values) => {
            setPage(1);
            if (values?.[0] && values?.[1]) {
              setDateRange([values[0], values[1]]);
            } else {
              setDateRange(null);
            }
          }}
          style={{ width: 280 }}
          placeholder={["开始日期", "结束日期"]}
        />
        <Input.Search
          placeholder="搜索订单号"
          allowClear
          disabled={isBatchQuery}
          maxLength={INPUT_LIMITS.search}
          style={{ width: 240 }}
          onSearch={(value) => {
            setPage(1);
            setCustomerPhone("");
            setShippingOrderNo("");
            setBatchPhones([]);
            setBatchPhoneDraft("");
            setBatchShippingOrderNos([]);
            setBatchShippingDraft("");
            setOrderNo(value);
          }}
        />
        <Button
          onClick={() => {
            setBatchDraft(batchOrderNos.join("\n"));
            setBatchModalOpen(true);
          }}
        >
          批量查询订单号
        </Button>
        <Input.Search
          placeholder="搜索手机号"
          allowClear
          disabled={isBatchQuery}
          maxLength={INPUT_LIMITS.phone}
          style={{ width: 200 }}
          onSearch={(value) => {
            setPage(1);
            setOrderNo("");
            setShippingOrderNo("");
            setBatchOrderNos([]);
            setBatchDraft("");
            setBatchShippingOrderNos([]);
            setBatchShippingDraft("");
            setCustomerPhone(value);
          }}
        />
        <Button
          onClick={() => {
            setBatchPhoneDraft(batchPhones.join("\n"));
            setBatchPhoneModalOpen(true);
          }}
        >
          批量查询手机号
        </Button>
        {showWaybillSearch ? (
          <>
            <Input.Search
              placeholder="搜索运单号"
              allowClear
              disabled={isBatchQuery}
              maxLength={INPUT_LIMITS.shippingMeta}
              style={{ width: 220 }}
              onSearch={(value) => {
                setPage(1);
                setOrderNo("");
                setCustomerPhone("");
                setBatchOrderNos([]);
                setBatchDraft("");
                setBatchPhones([]);
                setBatchPhoneDraft("");
                setShippingOrderNo(value);
              }}
            />
            <Button
              onClick={() => {
                setBatchShippingDraft(batchShippingOrderNos.join("\n"));
                setBatchShippingModalOpen(true);
              }}
            >
              批量查询运单号
            </Button>
          </>
        ) : null}
        {isBatchOrderQuery ? (
          <Tag
            color="blue"
            closable
            onClose={(e) => {
              e.preventDefault();
              clearBatchQuery();
            }}
          >
            批量订单号（{batchOrderNos.length}）
          </Tag>
        ) : null}
        {isBatchPhoneQuery ? (
          <Tag
            color="blue"
            closable
            onClose={(e) => {
              e.preventDefault();
              clearBatchPhoneQuery();
            }}
          >
            批量手机号（{batchPhones.length}）
          </Tag>
        ) : null}
        {isBatchShippingQuery ? (
          <Tag
            color="blue"
            closable
            onClose={(e) => {
              e.preventDefault();
              clearBatchShippingQuery();
            }}
          >
            批量运单号（{batchShippingOrderNos.length}）
          </Tag>
        ) : null}
        <Button onClick={() => void load()}>刷新</Button>
        {isSuperAdmin ? (
          <Button
            danger
            disabled={selectedRowKeys.length === 0}
            loading={batching}
            onClick={openForceStatusModal}
          >
            强制流转状态
            {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
          </Button>
        ) : null}
        {isAllTab ? (
          <Button
            icon={<DownloadOutlined />}
            onClick={() => void openExportModal("orders")}
          >
            导出订单
          </Button>
        ) : null}
        {isPendingReview ? (
          <>
            <Button
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={openRemarkModal}
            >
              批量填写备注
              {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
            <Button
              type="primary"
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={batchApprove}
            >
              批量通过
              {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
            <Button
              danger
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={openInvalidModal}
            >
              批量转无效订单
              {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
          </>
        ) : null}
        {isAwaitingConfirmTab ? (
          <>
            <Button
              type="primary"
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={batchConfirm}
            >
              批量确认
              {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
            <Button
              danger
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={openInvalidModal}
            >
              批量转无效订单
              {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void openExportModal("logistics")}
            >
              导出物流 Excel
            </Button>
          </>
        ) : null}
        {isAwaitingShipmentTab ? (
          <>
            <Button type="primary" onClick={() => void openShipModal()}>
              批量发货
            </Button>
            <Button
              danger
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={openInvalidModal}
            >
              批量转无效订单
              {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
          </>
        ) : null}
        {isShippedTab ? (
          <>
            <Button
              type="primary"
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={batchComplete}
            >
              批量签收{selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
            <Button
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={batchRefuse}
            >
              批量拒绝签收
              {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void openExportModal("finance")}
            >
              导出财务 Excel
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void openExportModal("logistics")}
            >
              导出物流 Excel
            </Button>
          </>
        ) : null}
        {isCompletedTab ? (
          <Button
            icon={<DownloadOutlined />}
            onClick={() => void openExportModal("logistics")}
          >
            导出物流 Excel
          </Button>
        ) : null}
        {isInvalidTab ? (
          isSuperAdmin ? (
            <Button
              danger
              disabled={selectedRowKeys.length === 0}
              loading={batching}
              onClick={batchDelete}
            >
              批量删除订单
              {selectedRowKeys.length > 0
                ? `（${selectedRowKeys.length}）`
                : ""}
            </Button>
          ) : null
        ) : null}
        {showRevertButton ? (
          <Button
            icon={<RollbackOutlined />}
            disabled={selectedRowKeys.length === 0}
            loading={batching}
            onClick={batchRevert}
          >
            恢复上一步
            {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ""}
          </Button>
        ) : null}
      </Space>
      <Modal
        title="批量填写备注"
        open={remarkModalOpen}
        onCancel={() => {
          setRemarkModalOpen(false);
          setRemarkDraft("");
        }}
        onOk={() => void submitBatchRemark()}
        okText={
          selectedRowKeys.length > 0
            ? `确认填写（${selectedRowKeys.length}）`
            : "确认填写"
        }
        cancelText="取消"
        confirmLoading={batching}
        destroyOnClose
      >
        <p style={{ color: "#666", marginBottom: 8 }}>
          将为选中的 {selectedRowKeys.length}{" "}
          笔订单写入相同备注；留空则清空原有备注。
        </p>
        {/* showCount 绝对定位在输入框下方，需预留高度避免与 Modal 页脚重叠 */}
        <div style={{ marginBottom: 24 }}>
          <Input.TextArea
            value={remarkDraft}
            onChange={(e) => setRemarkDraft(e.target.value)}
            placeholder="请输入备注内容"
            rows={4}
            maxLength={INPUT_LIMITS.remark}
            showCount
            allowClear
          />
        </div>
      </Modal>
      <Modal
        title="强制流转订单状态"
        open={forceStatusModalOpen}
        onCancel={() => {
          if (batching) return;
          setForceStatusModalOpen(false);
          setForceStatusRemark("");
          setForceStatusRejectReason("");
        }}
        onOk={() => void submitBatchForceStatus()}
        okText={
          selectedRowKeys.length > 0
            ? `确认流转（${selectedRowKeys.length}）`
            : "确认流转"
        }
        okButtonProps={{
          danger: true,
          disabled:
            forceStatusTarget === "cancelled" &&
            !forceStatusRejectReason.trim(),
        }}
        cancelText="取消"
        confirmLoading={batching}
        destroyOnClose
      >
        <p style={{ color: "#666", marginBottom: 12 }}>
          超级管理员专用：跳过常规流转规则，将选中的 {selectedRowKeys.length}{" "}
          笔 COD 订单批量变更为目标状态。操作会写入审计日志。
        </p>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>目标状态</div>
          <Select
            style={{ width: "100%" }}
            value={forceStatusTarget}
            onChange={setForceStatusTarget}
            options={COD_FORCE_STATUSES.map((status) => ({
              value: status,
              label: ORDER_STATUS_LABELS[status],
            }))}
          />
        </div>
        {forceStatusTarget === "cancelled" ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>无效理由（必填）</div>
            {/* showCount 绝对定位在输入框下方，需预留高度 */}
            <div style={{ marginBottom: 8 }}>
              <Input.TextArea
                value={forceStatusRejectReason}
                onChange={(e) => setForceStatusRejectReason(e.target.value)}
                placeholder="请填写流转为无效订单的理由"
                rows={3}
                maxLength={INPUT_LIMITS.remark}
                showCount
                allowClear
              />
            </div>
          </div>
        ) : null}
        <div>
          <div style={{ marginBottom: 6 }}>备注（选填）</div>
          {/* showCount 绝对定位在输入框下方，需预留高度避免与 Modal 页脚重叠 */}
          <div style={{ marginBottom: 24 }}>
            <Input.TextArea
              value={forceStatusRemark}
              onChange={(e) => setForceStatusRemark(e.target.value)}
              placeholder="可填写流转原因，会记录在审计日志中"
              rows={2}
              maxLength={INPUT_LIMITS.remark}
              showCount
              allowClear
            />
          </div>
        </div>
      </Modal>
      <Modal
        title="批量转无效订单"
        open={invalidModalOpen}
        onCancel={() => {
          if (batching) return;
          setInvalidModalOpen(false);
          setInvalidReason("");
        }}
        onOk={() => void submitBatchInvalidate()}
        okText={
          selectedRowKeys.length > 0
            ? `确认无效（${selectedRowKeys.length}）`
            : "确认无效"
        }
        okButtonProps={{ danger: true, disabled: !invalidReason.trim() }}
        cancelText="取消"
        confirmLoading={batching}
        destroyOnClose
      >
        <p style={{ color: "#666", marginBottom: 8 }}>
          将选中的 {selectedRowKeys.length}{" "}
          笔订单标记为无效，请填写拒绝理由（必填）。
        </p>
        <div style={{ marginBottom: 24 }}>
          <Input.TextArea
            value={invalidReason}
            onChange={(e) => setInvalidReason(e.target.value)}
            placeholder="例如：地址无法联系 / 客户拒收 / 信息虚假…"
            rows={4}
            maxLength={INPUT_LIMITS.remark}
            showCount
          />
        </div>
      </Modal>
      <Modal
        title="批量查询订单号"
        open={batchModalOpen}
        onCancel={() => setBatchModalOpen(false)}
        onOk={applyBatchQuery}
        okText="查询"
        cancelText="取消"
        destroyOnClose
      >
        <p style={{ color: "#666", marginBottom: 8 }}>
          粘贴订单号，支持换行、逗号或空格分隔。结果仍按当前列表状态筛选。
        </p>
        <Input.TextArea
          value={batchDraft}
          onChange={(e) => setBatchDraft(e.target.value)}
          placeholder={"例如：\nCOD-001\nCOD-002\nCOD-003"}
          rows={10}
          allowClear
        />
      </Modal>
      <Modal
        title="批量查询手机号"
        open={batchPhoneModalOpen}
        onCancel={() => setBatchPhoneModalOpen(false)}
        onOk={applyBatchPhoneQuery}
        okText="查询"
        cancelText="取消"
        destroyOnClose
      >
        <p style={{ color: "#666", marginBottom: 8 }}>
          粘贴手机号，支持换行、逗号或分号分隔。支持国际号格式（如 +62
          81218331371 → 6281218331371）；可带或不带区号、前导
          0；结果仍按当前列表状态筛选。
        </p>
        <Input.TextArea
          value={batchPhoneDraft}
          onChange={(e) => setBatchPhoneDraft(e.target.value)}
          placeholder={
            "例如：\n+62 81218331371\n6281234567890\n081234567890"
          }
          rows={10}
          allowClear
        />
      </Modal>
      <Modal
        title="批量查询运单号"
        open={batchShippingModalOpen}
        onCancel={() => setBatchShippingModalOpen(false)}
        onOk={applyBatchShippingQuery}
        okText="查询"
        cancelText="取消"
        destroyOnClose
      >
        <p style={{ color: "#666", marginBottom: 8 }}>
          粘贴运单号，支持换行、逗号或空格分隔。结果仍按当前列表状态筛选。
        </p>
        <Input.TextArea
          value={batchShippingDraft}
          onChange={(e) => setBatchShippingDraft(e.target.value)}
          placeholder={"例如：\nJT1234567890\nJT0987654321"}
          rows={10}
          allowClear
        />
      </Modal>
      <Modal
        title="批量发货"
        open={shipModalOpen}
        onCancel={resetShipModal}
        onOk={() => void submitBatchShip()}
        okText={
          shipRows.length > 0 ? `确认发货（${shipRows.length}）` : "确认发货"
        }
        cancelText="取消"
        confirmLoading={batching}
        okButtonProps={{
          disabled: shipRows.length === 0 || !selectedShipperId,
        }}
        destroyOnClose
        width={720}
      >
        <p style={{ color: "#666", marginBottom: 12 }}>
          粘贴「订单号 + 运单号」（每行一笔，Tab / 空格 /
          逗号分隔）会自动解析；也可上传含这两列的 Excel。本批共用同一寄件人与归属成员。
        </p>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <div style={{ marginBottom: 6 }}>发货文本</div>
            <Input.TextArea
              value={shipTextDraft}
              onChange={(e) => setShipTextDraft(e.target.value)}
              status={shipTextError ? "error" : undefined}
              placeholder={
                "例如：\nTEST-MRXUV4DL-030\tWB37081261001\nCOD-TEST-001\tWB37081261007"
              }
              rows={8}
              allowClear
            />
            {shipTextError ? (
              <p style={{ color: "#ff4d4f", marginTop: 6, marginBottom: 0 }}>
                {shipTextError}
              </p>
            ) : shipRows.length > 0 && !shipFileName ? (
              <p style={{ color: "#666", marginTop: 6, marginBottom: 0 }}>
                已识别 {shipRows.length} 笔
              </p>
            ) : null}
            <div style={{ marginTop: 8 }}>
              <Upload
                accept=".xlsx,.xls"
                showUploadList={false}
                beforeUpload={(file) => {
                  void onShipExcelSelected(file);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>
                  {shipFileName ? `重新选择（${shipFileName}）` : "上传 Excel"}
                </Button>
              </Upload>
            </div>
          </div>

          <Form form={shipForm} layout="vertical">
            <Form.Item
              name="owner_member"
              label="归属成员"
              rules={[{ required: true, message: "请填写归属成员" }]}
              extra="默认当前登录用户，可修改"
            >
              <Input
                maxLength={INPUT_LIMITS.shippingMeta}
                placeholder="归属成员"
              />
            </Form.Item>
          </Form>

          <div>
            <div style={{ marginBottom: 6 }}>
              寄件人 <span style={{ color: "#ff4d4f" }}>*</span>
            </div>
            <Select
              style={{ width: "100%" }}
              placeholder="请选择寄件人"
              value={selectedShipperId}
              status={selectedShipperId ? undefined : "error"}
              onChange={(value) => setSelectedShipperId(value)}
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

          {shipRows.length > 0 ? (
            <Table
              size="small"
              rowKey={(r) => `${r.row}-${r.order_no}`}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              dataSource={shipRows}
              columns={[
                { title: "行", dataIndex: "row", width: 60 },
                { title: "订单号", dataIndex: "order_no" },
                { title: "运单号", dataIndex: "shipping_order_no" },
              ]}
              scroll={{ y: 260 }}
            />
          ) : null}
        </Space>
      </Modal>
      <Modal
        title={
          exportKind === "finance"
            ? "导出财务 Excel"
            : exportKind === "logistics"
              ? "导出物流 Excel"
              : "导出订单"
        }
        open={exportOpen}
        onCancel={resetExportModal}
        onOk={() => void submitExport()}
        okText="导出"
        cancelText="取消"
        confirmLoading={exporting}
        destroyOnClose
        width={exportKind === "orders" ? 680 : 560}
      >
        <p style={{ color: "#666", marginBottom: 12 }}>
          {exportKind === "finance"
            ? "按当前列表筛选条件导出已发货订单，列对齐财务系统模板（订单号 / 商品 / 下单时间 / 金额 / 归属成员 / 中文属性*数量 / 购买数量）。可再按商品收窄。"
            : exportKind === "logistics"
              ? "按当前列表筛选条件导出，对齐极兔物流模板；第 1 列为订单号，第 2 列为物流订单号（运单号）；电商订单号仍填系统订单号。无数据字段留空或填模板默认值。可再按商品收窄。"
              : "按当前列表筛选条件导出 COD 订单；勾选需要导出的数据列，未勾选的列不会出现在 Excel 中。可再按商品收窄。"}
        </p>
        <div>
          <div style={{ marginBottom: 6 }}>商品（可多选）</div>
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="不选则导出有权限的全部商品"
            loading={exportMetaLoading}
            value={exportProductIds}
            onChange={setExportProductIds}
            style={{ width: "100%" }}
            options={exportProducts.map((p) => ({
              value: p.id,
              label: p.name || p.id,
            }))}
          />
        </div>
        {exportKind === "orders" ? (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>导出列（可多选）</span>
              <Space size={0}>
                <Button
                  type="link"
                  size="small"
                  onClick={() => setExportColumnKeys(ALL_ORDER_EXPORT_COLUMN_KEYS)}
                >
                  全选
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() => setExportColumnKeys([])}
                >
                  清空
                </Button>
              </Space>
            </div>
            <Checkbox.Group
              value={exportColumnKeys}
              onChange={(values) =>
                setExportColumnKeys(values as OrderExportColumnKey[])
              }
              style={{ width: "100%" }}
            >
              <div
                style={{
                  maxHeight: 260,
                  overflow: "auto",
                  border: "1px solid #d9d9d9",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "4px 12px",
                  }}
                >
                  {ORDER_EXPORT_COLUMNS.map((col) => (
                    <Checkbox key={col.key} value={col.key}>
                      {col.header}
                    </Checkbox>
                  ))}
                </div>
              </div>
            </Checkbox.Group>
            <div style={{ marginTop: 6, color: "#999", fontSize: 12 }}>
              已选 {exportColumnKeys.length} / {ORDER_EXPORT_COLUMNS.length} 列
            </div>
          </div>
        ) : null}
      </Modal>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: "max-content" }}
        rowSelection={
          enableRowSelection
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
              }
            : undefined
        }
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100", "500"],
          showTotal: (n) => `共 ${n} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
      <OrderEditModal
        open={editOrderId !== null}
        orderId={editOrderId}
        onClose={() => setEditOrderId(null)}
        onSaved={() => void load()}
      />
    </div>
  );
}
