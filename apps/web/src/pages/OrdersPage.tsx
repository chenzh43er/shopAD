import { useCallback, useEffect, useMemo, useRef, useState, type Key } from "react";
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ORDER_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
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
import type { ShipExcelRow } from "../lib/parseShipText";
import { parseShipText } from "../lib/parseShipText";
import { formatMoney } from "../lib/formatMoney";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { formatActor } from "../components/AuditLogPanel";
import { setOrdersListFrom } from "../lib/listNav";
import { useAuth } from "../auth/AuthContext";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

const MAX_BATCH_ORDER_NOS = 200;
const MAX_BATCH_PHONES = 200;

/** 解析粘贴的订单号：换行 / 逗号 / 空白 / 分号均可 */
function parseBatchOrderNos(raw: string): string[] {
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

/** 去掉空格、分隔符与 +，并去除前导 0，便于匹配入库手机号 */
function phoneSearchDigits(raw: string): string {
  const n = raw.replace(/[\s\-().+]/g, "").trim();
  if (!n) return "";
  return n.replace(/^0+/, "");
}

/** 解析粘贴的手机号：换行 / 逗号 / 空白 / 分号均可 */
function parseBatchPhones(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[\s,，;；]+/)) {
    const digits = phoneSearchDigits(part);
    if (!digits || seen.has(digits)) continue;
    if (result.length >= MAX_BATCH_PHONES) break;
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

const { RangePicker } = DatePicker;

const DATE_PRESETS: { label: string; value: [Dayjs, Dayjs] }[] = [
  {
    label: "本日",
    value: [dayjs().startOf("day"), dayjs().endOf("day")],
  },
  {
    label: "本周",
    value: [dayjs().startOf("isoWeek"), dayjs().endOf("isoWeek")],
  },
  {
    label: "本月",
    value: [dayjs().startOf("month"), dayjs().endOf("month")],
  },
  {
    label: "本年",
    value: [dayjs().startOf("year"), dayjs().endOf("year")],
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
  const { profile, user } = useAuth();
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
  const [batchOrderNos, setBatchOrderNos] = useState<string[]>([]);
  const [batchPhones, setBatchPhones] = useState<string[]>([]);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchPhoneModalOpen, setBatchPhoneModalOpen] = useState(false);
  const [batchDraft, setBatchDraft] = useState("");
  const [batchPhoneDraft, setBatchPhoneDraft] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<Order[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const pendingBatchNotify = useRef<"order_no" | "phone" | null>(null);
  const prevCodTabRef = useRef<CodTabKey>(activeCodTab);

  const [remarkModalOpen, setRemarkModalOpen] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState("");
  const [invalidModalOpen, setInvalidModalOpen] = useState(false);
  const [invalidReason, setInvalidReason] = useState("");

  const [shipModalOpen, setShipModalOpen] = useState(false);
  const [shipRows, setShipRows] = useState<ShipExcelRow[]>([]);
  const [shipFileName, setShipFileName] = useState("");
  const [shipTextDraft, setShipTextDraft] = useState("");
  const [shipTextError, setShipTextError] = useState<string | null>(null);
  const [shippers, setShippers] = useState<LogisticsShipper[]>([]);
  const [selectedShipperId, setSelectedShipperId] = useState<string>();
  const [shipForm] = Form.useForm<{ owner_member: string }>();
  const shipTextTruncWarned = useRef(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportKind, setExportKind] = useState<"finance" | "logistics">(
    "finance",
  );
  const [exporting, setExporting] = useState(false);
  const [exportMetaLoading, setExportMetaLoading] = useState(false);
  const [exportProducts, setExportProducts] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [exportProductIds, setExportProductIds] = useState<string[]>([]);

  const isAllTab = activeCodTab === "all";
  const isPendingReview = activeCodTab === "pending_review";
  const isAwaitingConfirmTab = activeCodTab === "awaiting_confirm";
  const isAwaitingShipmentTab = activeCodTab === "awaiting_shipment";
  const isShippedTab = activeCodTab === "shipped";
  const isCompletedTab = activeCodTab === "completed";
  const isInvalidTab = activeCodTab === "invalid";
  const isBatchOrderQuery = batchOrderNos.length > 0;
  const isBatchPhoneQuery = batchPhones.length > 0;
  const isBatchQuery = isBatchOrderQuery || isBatchPhoneQuery;
  const enableRowSelection =
    isPendingReview ||
    isAwaitingConfirmTab ||
    isAwaitingShipmentTab ||
    isShippedTab ||
    isInvalidTab;
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

      // 批量查询跨子状态展示，不按当前 Tab 的 status / review_status 收窄
      if (!isBatchQuery) {
        if (filters.reviewStatus) {
          params.set("review_status", filters.reviewStatus);
        }
        if (filters.status) {
          params.set("status", filters.status);
        }
        if (orderNo.trim()) params.set("order_no", orderNo.trim());
        const phone = phoneSearchDigits(customerPhone);
        if (phone) params.set("customer_phone", phone);
      } else if (isBatchOrderQuery) {
        params.set("order_nos", batchOrderNos.join(","));
      } else {
        params.set("customer_phones", batchPhones.join(","));
      }
      if (dateRange?.[0] && dateRange?.[1]) {
        params.set("date_from", dateRange[0].startOf("day").toISOString());
        params.set("date_to", dateRange[1].endOf("day").toISOString());
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
          notifyKind === "order_no" ? batchOrderNos : batchPhones;
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
    batchOrderNos,
    batchPhones,
    isBatchQuery,
    isBatchOrderQuery,
    dateRange,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // 进入无效 COD 子路径时纠正到默认项
  useEffect(() => {
    if (!routeTab || !COD_TABS.some((t) => t.key === routeTab)) {
      navigate(`/cod/${DEFAULT_COD_TAB}`, { replace: true });
    }
  }, [routeTab, navigate]);

  // 从「全部订单」切到子状态（含侧栏）时，清掉跨状态批量条件
  useEffect(() => {
    const prev = prevCodTabRef.current;
    prevCodTabRef.current = activeCodTab;
    if (prev !== "all" || activeCodTab === "all") return;
    if (batchOrderNos.length === 0 && batchPhones.length === 0) return;
    setBatchOrderNos([]);
    setBatchDraft("");
    setBatchPhones([]);
    setBatchPhoneDraft("");
    setPageSize(20);
  }, [activeCodTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [
    activeCodTab,
    page,
    pageSize,
    orderNo,
    customerPhone,
    batchOrderNos,
    batchPhones,
    dateRange,
  ]);

  const applyBatchQuery = () => {
    const nos = parseBatchOrderNos(batchDraft);
    if (nos.length === 0) {
      message.warning("请粘贴至少一个订单号");
      return;
    }
    const rawCount = batchDraft
      .split(/[\s,，;；]+/)
      .map((s) => s.trim())
      .filter(Boolean).length;
    if (rawCount > MAX_BATCH_ORDER_NOS) {
      message.warning(
        `单次最多查询 ${MAX_BATCH_ORDER_NOS} 个订单号，已截取前 ${MAX_BATCH_ORDER_NOS} 个`,
      );
    }
    pendingBatchNotify.current = "order_no";
    setOrderNo("");
    setCustomerPhone("");
    setBatchPhones([]);
    setBatchPhoneDraft("");
    setBatchOrderNos(nos);
    setPage(1);
    setPageSize(Math.min(100, Math.max(nos.length, 20)));
    setBatchModalOpen(false);
    // 批量结果跨状态，统一在「全部订单」展示
    if (activeCodTab !== "all") {
      navigate("/cod/all");
    }
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
    const rawCount = batchPhoneDraft
      .split(/[\s,，;；]+/)
      .map((s) => s.trim())
      .filter(Boolean).length;
    if (rawCount > MAX_BATCH_PHONES) {
      message.warning(
        `单次最多查询 ${MAX_BATCH_PHONES} 个手机号，已截取前 ${MAX_BATCH_PHONES} 个`,
      );
    }
    pendingBatchNotify.current = "phone";
    setOrderNo("");
    setCustomerPhone("");
    setBatchOrderNos([]);
    setBatchDraft("");
    setBatchPhones(phones);
    setPage(1);
    setPageSize(Math.min(100, Math.max(phones.length, 20)));
    setBatchPhoneModalOpen(false);
    // 批量结果跨状态，统一在「全部订单」展示
    if (activeCodTab !== "all") {
      navigate("/cod/all");
    }
  };

  const clearBatchPhoneQuery = () => {
    setBatchPhones([]);
    setBatchPhoneDraft("");
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

  const batchReopen = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要恢复的订单");
      return;
    }
    Modal.confirm({
      title: "批量恢复原先状态",
      content: `确认将选中的 ${selectedRowKeys.length} 笔无效订单恢复为作废前的状态？`,
      okText: "确认恢复",
      cancelText: "取消",
      onOk: async () => {
        setBatching(true);
        try {
          const res = await apiFetch<{
            succeeded: Array<{ id: string; restored_status: OrderStatus }>;
            failed: Array<{ id: string; error: string }>;
          }>("/api/orders/batch-reopen", {
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
          message.error(e instanceof Error ? e.message : "批量恢复失败");
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
    shipTextTruncWarned.current = false;
    setSelectedShipperId(undefined);
    shipForm.resetFields();
  };

  const resetExportModal = () => {
    setExportOpen(false);
    setExportProductIds([]);
  };

  const openExportModal = async (kind: "finance" | "logistics") => {
    if (kind === "finance" && !isShippedTab) return;
    if (kind === "logistics" && !exportOrderStatus) return;

    setExportKind(kind);
    setExportOpen(true);
    setExportProductIds([]);
    setExportMetaLoading(true);
    try {
      const status =
        kind === "finance"
          ? "cod_shipped"
          : (exportOrderStatus ?? "cod_shipped");
      const res = await apiFetch<{
        products: Array<{ id: string; name: string }>;
        owner_members: string[];
      }>(`/api/orders/finance-export/meta?status=${status}`);
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

    setExporting(true);
    try {
      const payload: Record<string, unknown> = {
        product_ids: exportProductIds,
      };

      // 沿用列表页当前筛选条件（日期 / 单号 / 电话 / 批量查询）
      if (dateRange?.[0] && dateRange?.[1]) {
        payload.date_from = dateRange[0].startOf("day").toISOString();
        payload.date_to = dateRange[1].endOf("day").toISOString();
      }
      if (isBatchOrderQuery) {
        payload.order_nos = batchOrderNos;
      } else if (isBatchPhoneQuery) {
        payload.customer_phones = batchPhones;
      } else {
        if (orderNo.trim()) payload.order_no = orderNo.trim();
        const phone = phoneSearchDigits(customerPhone);
        if (phone) payload.customer_phone = phone;
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
      shipTextTruncWarned.current = false;
      // 空文本时保留 Excel 解析结果
      if (!shipFileName) setShipRows([]);
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        const parsed = parseShipText(raw);
        if (parsed.rows.length > 200) {
          if (!shipTextTruncWarned.current) {
            message.warning("单次最多发货 200 笔，已截取前 200 行");
            shipTextTruncWarned.current = true;
          }
          setShipRows(parsed.rows.slice(0, 200));
        } else {
          shipTextTruncWarned.current = false;
          setShipRows(parsed.rows);
        }
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
      const rows =
        parsed.rows.length > 200
          ? parsed.rows.slice(0, 200)
          : parsed.rows;
      if (parsed.rows.length > 200) {
        message.warning("单次最多发货 200 笔，已截取前 200 行");
      }
      setShipFileName(file.name);
      setShipTextDraft("");
      setShipTextError(null);
      shipTextTruncWarned.current = false;
      setShipRows(rows);
      message.success(`已解析 ${rows.length} 行（${file.name}）`);
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
    { title: "订单号", dataIndex: "order_no", width: 180 },
    {
      title: "商品",
      dataIndex: "product_name",
      width: 140,
      render: (v: string) => v || "—",
    },
    {
      title: "套餐",
      dataIndex: "package_name",
      width: 140,
      render: (v: string | null) => v || "—",
    },
    { title: "客户", dataIndex: "customer_name", width: 120 },
    { title: "电话", dataIndex: "customer_phone", width: 130 },
    ...(isPendingReview
      ? [
          {
            title: "收件地址",
            key: "shipping_address",
            width: 360,
            render: (_: unknown, row: Order) => formatShippingAddress(row),
          } satisfies ColumnsType<Order>[number],
        ]
      : []),
    {
      title: "金额",
      dataIndex: "total_amount",
      width: 140,
      render: (v: number, row) => formatMoney(v, row.currency),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (s: OrderStatus) => (
        <Tag color={statusColor[s]}>{ORDER_STATUS_LABELS[s]}</Tag>
      ),
    },
    ...(isInvalidTab
      ? [
          {
            title: "拒绝理由",
            dataIndex: "reject_reason",
            width: 240,
            render: (v: string | null) => v || "—",
          } satisfies ColumnsType<Order>[number],
        ]
      : [
          {
            title: "审核",
            dataIndex: "review_status",
            width: 100,
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
      width: 100,
      render: (_, row) => formatActor(row.reviewer),
    },
    {
      title: "最近更新时间",
      dataIndex: "updated_at",
      width: 170,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
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
        );
      },
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>COD订单</h1>
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
        <Button.Group>
          {DATE_PRESETS.map((p) => (
            <Button
              key={p.label}
              onClick={() => {
                setPage(1);
                setDateRange(p.value);
              }}
            >
              {p.label}
            </Button>
          ))}
        </Button.Group>
        <Input.Search
          placeholder="搜索订单号"
          allowClear
          disabled={isBatchQuery}
          maxLength={INPUT_LIMITS.search}
          style={{ width: 240 }}
          onSearch={(value) => {
            setPage(1);
            setCustomerPhone("");
            setBatchPhones([]);
            setBatchPhoneDraft("");
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
            setBatchOrderNos([]);
            setBatchDraft("");
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
        <Button onClick={() => void load()}>刷新</Button>
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
          <Button
            type="primary"
            disabled={selectedRowKeys.length === 0}
            loading={batching}
            onClick={batchReopen}
          >
            批量恢复原先状态
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
          粘贴订单号，支持换行、逗号或空格分隔；单次最多{" "}
          {MAX_BATCH_ORDER_NOS} 个。批量查询会跨 COD
          子状态展示匹配结果。
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
          粘贴手机号，支持换行、逗号或空格分隔；单次最多{" "}
          {MAX_BATCH_PHONES}{" "}
          个。可带或不带国际区号、前导 0；批量查询会跨 COD
          子状态展示匹配结果。
        </p>
        <Input.TextArea
          value={batchPhoneDraft}
          onChange={(e) => setBatchPhoneDraft(e.target.value)}
          placeholder={"例如：\n081234567890\n6281234567890\n13200132000"}
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
        title={exportKind === "finance" ? "导出财务 Excel" : "导出物流 Excel"}
        open={exportOpen}
        onCancel={resetExportModal}
        onOk={() => void submitExport()}
        okText="导出"
        cancelText="取消"
        confirmLoading={exporting}
        destroyOnClose
        width={560}
      >
        <p style={{ color: "#666", marginBottom: 12 }}>
          {exportKind === "finance"
            ? "按当前列表筛选条件导出已发货订单，列对齐财务系统模板（订单号 / 商品 / 下单时间 / 金额 / 归属成员 / 中文属性*数量 / 购买数量）。可再按商品收窄。"
            : "按当前列表筛选条件导出，对齐极兔物流模板；第 1 列为订单号，第 2 列为物流订单号（运单号）；电商订单号仍填系统订单号。无数据字段留空或填模板默认值。可再按商品收窄。"}
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
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}
