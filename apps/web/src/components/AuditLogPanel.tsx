import { useEffect, useState } from "react";
import { Empty, Table, Tag } from "antd";
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
};

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
          render: (_, row) => {
            if (row.from_value || row.to_value) {
              return `${row.from_value ?? "—"} → ${row.to_value ?? "—"}`;
            }
            if (row.remark) return row.remark;
            return "—";
          },
        },
        {
          title: "备注",
          dataIndex: "remark",
          render: (v: string | null) => v || "—",
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
