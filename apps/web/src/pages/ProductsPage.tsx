import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Image,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import {
  PRODUCT_STATUS_LABELS,
  type Paginated,
  type Product,
  type ProductStatus,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { formatActor } from "../components/AuditLogPanel";

const statusColor: Record<ProductStatus, string> = {
  draft: "default",
  on_sale: "success",
  off_sale: "warning",
};

type ListTab = "active" | "deleted";

const ACTIVE_STATUS_OPTIONS = (
  Object.entries(PRODUCT_STATUS_LABELS) as [ProductStatus, string][]
)
  .filter(([value]) => value !== "off_sale")
  .map(([value, label]) => ({ value, label }));

function buildProductUrl(product: Product): string | null {
  const host = product.domain?.host?.trim();
  const suffix = product.link_suffix?.trim().replace(/^\/+/, "");
  if (!host || !suffix) return null;
  return `https://${host}/${suffix}`;
}

export function ProductsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<ListTab>("active");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ProductStatus | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<Product[]>([]);

  const isDeletedTab = tab === "deleted";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q.trim()) params.set("q", q.trim());
      if (isDeletedTab) {
        params.set("status", "off_sale");
      } else if (status) {
        params.set("status", status);
      }

      const res = await apiFetch<Paginated<Product>>(
        `/api/products?${params.toString()}`,
      );
      setData(res.data);
      setTotal(res.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q, status, isDeletedTab]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<Product> = [
    {
      title: "操作",
      key: "actions",
      width: 260,
      fixed: "left",
      render: (_, record) => (
        <Space wrap>
          <Button
            size="small"
            onClick={() => navigate(`/products/${record.id}/edit`)}
          >
            编辑
          </Button>
          <Button
            size="small"
            onClick={async () => {
              const url = buildProductUrl(record);
              if (!url) {
                message.warning("请先配置域名和链接后缀");
                return;
              }
              try {
                await navigator.clipboard.writeText(url);
                message.success("已复制产品链接");
              } catch {
                message.error("复制失败");
              }
            }}
          >
            复制链接
          </Button>
          {isDeletedTab ? (
            <Button
              size="small"
              type="primary"
              onClick={async () => {
                try {
                  await apiFetch(`/api/products/${record.id}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "on_sale" }),
                  });
                  message.success("已恢复并上架");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "操作失败");
                }
              }}
            >
              恢复
            </Button>
          ) : (
            <Popconfirm
              title="确认删除该商品？"
              onConfirm={async () => {
                try {
                  await apiFetch(`/api/products/${record.id}`, {
                    method: "DELETE",
                  });
                  message.success("已删除");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "删除失败");
                }
              }}
            >
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
    {
      title: "封面",
      dataIndex: "cover_url",
      width: 72,
      render: (url: string | null) =>
        url ? (
          <Image src={url} className="cover-thumb" width={48} height={48} />
        ) : (
          <div className="cover-placeholder">无图</div>
        ),
    },
    {
      title: "内部标题",
      dataIndex: "name",
      render: (v: string) => v || "—",
    },
    {
      title: "地区",
      key: "region",
      width: 140,
      render: (_, row) => row.region?.name || "—",
    },
    {
      title: "域名",
      key: "domain",
      width: 180,
      render: (_, row) => row.domain?.host || "—",
    },
    {
      title: "链接后缀",
      dataIndex: "link_suffix",
      width: 280,
      render: (v) => v || "—",
    },
    {
      title: "属性码",
      dataIndex: "sku_code",
      width: 120,
      render: (v) => v || "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (s: ProductStatus) => (
        <Tag color={statusColor[s]}>{PRODUCT_STATUS_LABELS[s]}</Tag>
      ),
    },
    {
      title: "所属人",
      width: 160,
      render: (_, row) =>
        row.owners?.length
          ? row.owners.map((o) => formatActor(o)).join("、")
          : formatActor(row.creator),
    },
    {
      title: "修改人",
      width: 110,
      render: (_, row) => formatActor(row.updater),
    },
    {
      title: "最近更新时间",
      dataIndex: "updated_at",
      width: 170,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-title">
          <h1>商品管理</h1>
          <span className="list-count">共 {total} 条</span>
        </div>
        {!isDeletedTab && (
          <Button type="primary" onClick={() => navigate("/products/new")}>
            新建商品
          </Button>
        )}
      </div>
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key as ListTab);
          setPage(1);
          setStatus(undefined);
          setQ("");
        }}
        items={[
          { key: "active", label: "商品列表" },
          { key: "deleted", label: "已删除" },
        ]}
        style={{ marginBottom: 8 }}
      />
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          key={tab}
          placeholder="搜索商品名称"
          allowClear
          maxLength={INPUT_LIMITS.search}
          style={{ width: 240 }}
          onSearch={(value) => {
            setPage(1);
            setQ(value);
          }}
        />
        {!isDeletedTab && (
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 140 }}
            value={status}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
            options={ACTIVE_STATUS_OPTIONS}
          />
        )}
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: "max-content" }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (n) => `共 ${n} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}
