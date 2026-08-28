import { useEffect, useState } from "react";
import { Empty, Table, Tag, Typography } from "antd";
import type { AuditLog } from "@shopad/shared";
import { apiFetch } from "../lib/api";
import dayjs from "dayjs";

const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  update: "修改",
  status_change: "状态变更",
  review: "审核",
  delete: "删除",
  remark_update: "备注修改",
  packages_update: "套餐更新",
  order_update: "订单修改",
};

const FIELD_LABELS: Record<string, string> = {
  name: "商品名称",
  description: "描述",
  price: "价格",
  status: "状态",
  link_suffix: "链接后缀",
  title_external: "外文标题",
  cover_url: "封面图",
  gallery_urls: "轮播图",
  facebook_pixel_id: "Facebook Pixel",
  google_conversion_id: "Google Conversion",
  google_label: "Google Label",
  extra_html: "附加 HTML",
  sku_code: "中文属性",
  sku_display: "SKU 展示",
  packages_enabled: "开启套餐",
  sales_count: "虚拟销量",
  weight: "重量",
  region_id: "地区",
  currency_id: "币种",
  domain_id: "域名",
  owner_ids: "所属人",
  package_count: "套餐数量",
  package_added: "新增套餐",
  package_removed: "删除套餐",
  original_price: "原价",
  discount_price: "折扣价",
  summary: "套餐说明",
  is_visible: "是否显示",
  sort_order: "排序",
  item_count: "明细件数",
  items: "套餐明细",
  customer_name: "收件人",
  customer_phone: "收件电话",
  shipping_province: "收件省",
  shipping_city: "收件城市",
  shipping_district: "收件地区",
  shipping_detail: "收件地址",
  shipping_address: "收件地址信息",
  quantity: "购买数量",
  unit_price: "单价",
  total_amount: "总金额",
  product_id: "商品",
  product_name: "商品名称",
  package_id: "套餐",
  package_name: "套餐名称",
  sku_code_order: "中文属性",
  owner_member: "归属成员",
  shipping_order_no: "发货订单号",
  remark: "备注",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  on_sale: "在售",
  off_sale: "已下架",
  pending: "待处理",
  approved: "已通过",
  rejected: "已拒绝",
  true: "是",
  false: "否",
};

type FieldDiff = { field: string; from: unknown; to: unknown };

function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const packageField = /^package\.(.+)\.(.+)$/.exec(field);
  if (packageField) {
    const pkgName = packageField[1]!;
    const sub = packageField[2]!;
    return `套餐「${pkgName}」${FIELD_LABELS[sub] ?? sub}`;
  }
  return field;
}

function formatScalar(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "空";
    if (value.every((x) => typeof x === "string" || typeof x === "number")) {
      const joined = value.map(String).join(", ");
      return joined.length > 80 ? `${joined.slice(0, 80)}…（${value.length}项）` : joined;
    }
    return `${value.length} 项`;
  }
  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value);
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    } catch {
      return "[对象]";
    }
  }
  const text = String(value);
  if (STATUS_LABELS[text]) return STATUS_LABELS[text];
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function extractFieldDiffs(changes: Record<string, unknown> | null): FieldDiff[] {
  if (!changes) return [];
  if (Array.isArray(changes.fields)) {
    return (changes.fields as FieldDiff[]).filter(
      (d) => d && typeof d.field === "string",
    );
  }

  // 兼容旧结构：{ before, after }
  if (
    changes.before &&
    typeof changes.before === "object" &&
    changes.after &&
    typeof changes.after === "object"
  ) {
    const before = changes.before as Record<string, unknown>;
    const after = changes.after as Record<string, unknown>;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diffs: FieldDiff[] = [];
    for (const key of keys) {
      const from = before[key];
      const to = after[key];
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      diffs.push({ field: key, from, to });
    }
    return diffs;
  }

  // 兼容更旧：直接把 patch 当 after，无 before
  const skip = new Set(["fields", "summary", "before", "after", "updated_by"]);
  const diffs: FieldDiff[] = [];
  for (const [field, to] of Object.entries(changes)) {
    if (skip.has(field)) continue;
    if (field === "package_count") {
      diffs.push({ field, from: null, to });
      continue;
    }
    diffs.push({ field, from: null, to });
  }
  return diffs;
}

function formatChangeCell(row: AuditLog): string {
  // 套餐更新：remark 已是中文摘要（新增/删除/修改了哪些套餐）
  if (row.action === "packages_update" && row.remark) {
    return row.remark;
  }

  const diffs = extractFieldDiffs(row.changes);
  if (diffs.length > 0) {
    return diffs
      .map((d) => {
        if (d.field === "package_added") {
          return `${fieldLabel(d.field)}: ${formatScalar(d.to)}`;
        }
        if (d.field === "package_removed") {
          return `${fieldLabel(d.field)}: ${formatScalar(d.from)}`;
        }
        return `${fieldLabel(d.field)}: ${formatScalar(d.from)} → ${formatScalar(d.to)}`;
      })
      .join("；");
  }

  if (row.remark) return row.remark;

  if (row.from_value || row.to_value) {
    // 旧商品「修改」常把状态写成 on_sale → on_sale，且无字段明细
    if (
      row.action === "update" &&
      row.from_value &&
      row.from_value === row.to_value
    ) {
      return `状态未变（${formatScalar(row.from_value)}）；历史日志未记录字段明细`;
    }
    if (row.action === "packages_update") {
      return `套餐数量: ${formatScalar(row.from_value)} → ${formatScalar(row.to_value)}（历史日志未记录套餐明细，重新保存套餐后将显示具体变更）`;
    }
    const label =
      row.action === "status_change" || row.action === "delete"
        ? "状态"
        : "值";
    return `${label}: ${formatScalar(row.from_value)} → ${formatScalar(row.to_value)}`;
  }

  return "—";
}

interface Props {
  entityType: "order" | "product";
  entityId: string;
  refreshKey?: number | string;
}

export function AuditLogPanel({ entityType, entityId, refreshKey }: Props) {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const path =
          entityType === "order"
            ? `/api/orders/${entityId}/logs`
            : `/api/products/${entityId}/logs`;
        const res = await apiFetch<{ data: AuditLog[] }>(path);
        if (!cancelled) setLogs(res.data ?? []);
      } catch {
        if (!cancelled) setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, refreshKey]);

  if (!loading && logs.length === 0) {
    return <Empty description="暂无操作日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Table<AuditLog>
      rowKey="id"
      size="small"
      loading={loading}
      pagination={false}
      dataSource={logs}
      scroll={{ x: "max-content" }}
      columns={[
        {
          title: "时间",
          dataIndex: "created_at",
          width: 170,
          render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
        },
        {
          title: "操作",
          dataIndex: "action",
          width: 110,
          render: (v: string) => (
            <Tag>{ACTION_LABELS[v] ?? v}</Tag>
          ),
        },
        {
          title: "操作人",
          width: 140,
          render: (_, row) => row.actor_name || row.actor_email || "—",
        },
        {
          title: "变更",
          width: 420,
          render: (_, row) => (
            <Typography.Paragraph
              style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
              ellipsis={{ rows: 4, expandable: true, symbol: "展开" }}
            >
              {formatChangeCell(row)}
            </Typography.Paragraph>
          ),
        },
        {
          title: "备注",
          dataIndex: "remark",
          width: 220,
          render: (v: string | null, row) => {
            // 变更列已展示详细内容时，备注列避免重复
            if (!v) return "—";
            const changeText = formatChangeCell(row);
            if (changeText === v) return "—";
            if (row.action === "packages_update") return "—";
            return v;
          },
        },
      ]}
    />
  );
}

export function formatActor(
  actor?: { display_name: string | null } | null,
): string {
  return actor?.display_name || "—";
}
