import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { useNavigate, useParams } from "react-router-dom";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  type Order,
  type OrderStatus,
  type Paginated,
  type PaymentType,
  type ReviewStatus,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { formatActor } from "../components/AuditLogPanel";
import { setOrdersListFrom } from "../lib/listNav";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

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
  awaiting_shipment: "gold",
  shipped: "blue",
  cod_shipped: "cyan",
  completed: "success",
  cod_completed: "green",
  cancelled: "error",
};

/** 普通订单管理 Tabs（不含 COD 专属） */
const ORDER_TABS: Array<{ key: string; label: string; status?: OrderStatus }> =
  [
    { key: "all", label: "全部" },
    { key: "pending", label: "待支付", status: "pending" },
    { key: "paid", label: "已支付", status: "paid" },
    { key: "shipped", label: "已发货", status: "shipped" },
    { key: "completed", label: "已完成", status: "completed" },
    { key: "cancelled", label: "已取消", status: "cancelled" },
  ];

/** COD 订单子类 */
export const COD_TABS = [
  {
    key: "pending_review",
    label: "待审核",
    paymentType: "cod" as const,
    reviewStatus: "pending" as const,
    status: "awaiting_review" as OrderStatus,
  },
  {
    key: "rejected",
    label: "未通过",
    paymentType: "cod" as const,
    reviewStatus: "rejected" as const,
  },
  {
    key: "awaiting_shipment",
    label: "待发货",
    paymentType: "cod" as const,
    // 仅已通过审核且处于待发货，不含待审核/未通过
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
    label: "已完成",
    paymentType: "cod" as const,
    reviewStatus: "approved" as const,
    status: "cod_completed" as OrderStatus,
  },
] as const;

export type CodTabKey = (typeof COD_TABS)[number]["key"];

type OrdersPageProps = {
  /** 是否为 COD 订单入口 */
  scope?: "orders" | "cod";
};

export function OrdersPage({ scope = "orders" }: OrdersPageProps) {
  const navigate = useNavigate();
  const { tab: routeTab } = useParams<{ tab?: string }>();
  const isCod = scope === "cod";

  const defaultCodTab: CodTabKey = "pending_review";
  const activeCodTab: CodTabKey =
    isCod && COD_TABS.some((t) => t.key === routeTab)
      ? (routeTab as CodTabKey)
      : defaultCodTab;

  const [loading, setLoading] = useState(false);
  const [orderTab, setOrderTab] = useState("all");
  const [orderNo, setOrderNo] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<Order[]>([]);

  const filters = useMemo(() => {
    if (!isCod) {
      const current = ORDER_TABS.find((t) => t.key === orderTab);
      return {
        // 普通订单管理不包含 COD 订单
        paymentType: "non_cod" as PaymentType,
        reviewStatus: undefined as ReviewStatus | undefined,
        status: current?.status,
      };
    }
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
  }, [isCod, orderTab, activeCodTab]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      if (filters.paymentType) {
        params.set("payment_type", filters.paymentType);
      }
      if (filters.reviewStatus) {
        params.set("review_status", filters.reviewStatus);
      }
      if (filters.status) {
        params.set("status", filters.status);
      }
      if (orderNo.trim()) params.set("order_no", orderNo.trim());
      if (isCod && dateRange?.[0] && dateRange?.[1]) {
        params.set("date_from", dateRange[0].startOf("day").toISOString());
        params.set("date_to", dateRange[1].endOf("day").toISOString());
      }

      const res = await apiFetch<Paginated<Order>>(
        `/api/orders?${params.toString()}`,
      );
      setData(res.data);
      setTotal(res.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters, orderNo, isCod, dateRange]);

  useEffect(() => {
    void load();
  }, [load]);

  // 进入无效 COD 子路径时纠正到默认项
  useEffect(() => {
    if (!isCod) return;
    if (!routeTab || !COD_TABS.some((t) => t.key === routeTab)) {
      navigate(`/cod/${defaultCodTab}`, { replace: true });
    }
  }, [isCod, routeTab, navigate]);

  const columns: ColumnsType<Order> = [
    { title: "订单号", dataIndex: "order_no", width: 180 },
    {
      title: "商品",
      dataIndex: "product_name",
      width: 140,
      ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "套餐",
      dataIndex: "package_name",
      width: 140,
      ellipsis: true,
      render: (v: string | null) => v || "—",
    },
    { title: "客户", dataIndex: "customer_name", width: 120 },
    { title: "电话", dataIndex: "customer_phone", width: 130 },
    {
      title: "金额",
      dataIndex: "total_amount",
      width: 100,
      render: (v: number) => `¥${Number(v).toFixed(2)}`,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (s: OrderStatus) => (
        <Tag color={statusColor[s]}>{ORDER_STATUS_LABELS[s]}</Tag>
      ),
    },
    {
      title: "支付类别",
      dataIndex: "payment_type",
      width: 110,
      render: (v: PaymentType | null | undefined) =>
        PAYMENT_TYPE_LABELS[(v ?? "non_cod") as PaymentType],
    },
    {
      title: "审核",
      dataIndex: "review_status",
      width: 100,
      render: (v: ReviewStatus | null | undefined) => {
        const s = (v ?? "not_required") as ReviewStatus;
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
    },
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
          record.payment_type === "cod" && record.review_status === "pending"
            ? "去审核"
            : record.status === "awaiting_shipment"
              ? "去发货"
              : "详情";
        return (
          <Button
            size="small"
            onClick={() => {
              const from = isCod ? `/cod/${activeCodTab}` : "/orders";
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

  const pageTitle = isCod ? "COD订单" : "订单管理";
  const pageHint = isCod
    ? "货到付款订单须网站管理审核通过后，方可发货。可在左侧切换 COD 子状态。"
    : "仅显示非货到付款订单。货到付款订单请前往「COD订单」。";

  return (
    <div>
      <div className="page-header">
        <h1>{pageTitle}</h1>
      </div>
      <p style={{ color: "#666", marginTop: -8, marginBottom: 12 }}>
        {pageHint}
      </p>
      {isCod ? (
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
      ) : (
        <Tabs
          activeKey={orderTab}
          onChange={(key) => {
            setPage(1);
            setOrderTab(key);
          }}
          items={ORDER_TABS.map((t) => ({
            key: t.key,
            label: t.label,
          }))}
        />
      )}
      <Space style={{ marginBottom: 16 }} wrap>
        {isCod ? (
          <>
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
          </>
        ) : null}
        <Input.Search
          placeholder="搜索订单号"
          allowClear
          style={{ width: 240 }}
          onSearch={(value) => {
            setPage(1);
            setOrderNo(value);
          }}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
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
