import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Image,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router-dom";
import {
  PRODUCT_STATUS_LABELS,
  type Paginated,
  type Product,
  type ProductStatus,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { formatActor } from "../components/AuditLogPanel";

const statusColor: Record<ProductStatus, string> = {
  draft: "default",
  on_sale: "success",
  off_sale: "warning",
};

export function ProductsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ProductStatus | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<Product[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);

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
  }, [page, pageSize, q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<Product> = [
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
    { title: "内部标题", dataIndex: "name" },
    {
      title: "链接后缀",
      dataIndex: "link_suffix",
      width: 100,
      render: (v) => v || "—",
    },
    { title: "属性码", dataIndex: "sku_code", width: 120, render: (v) => v || "—" },
    {
      title: "价格",
      dataIndex: "price",
      width: 100,
      render: (v: number) => `¥${Number(v).toFixed(2)}`,
    },
    { title: "库存", dataIndex: "stock", width: 80 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (s: ProductStatus) => (
        <Tag color={statusColor[s]}>{PRODUCT_STATUS_LABELS[s]}</Tag>
      ),
    },
    {
      title: "添加人",
      width: 110,
      render: (_, row) => formatActor(row.creator),
    },
    {
      title: "修改人",
      width: 110,
      render: (_, row) => formatActor(row.updater),
    },
    {
      title: "操作",
      key: "actions",
      width: 280,
      render: (_, record) => (
        <Space wrap>
          <Button
            size="small"
            onClick={() => navigate(`/products/${record.id}/edit`)}
          >
            编辑
          </Button>
          {record.status !== "on_sale" ? (
            <Button
              size="small"
              type="primary"
              onClick={async () => {
                try {
                  await apiFetch(`/api/products/${record.id}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "on_sale" }),
                  });
                  message.success("已上架");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "操作失败");
                }
              }}
            >
              上架
            </Button>
          ) : (
            <Button
              size="small"
              onClick={async () => {
                try {
                  await apiFetch(`/api/products/${record.id}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "off_sale" }),
                  });
                  message.success("已下架");
                  void load();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : "操作失败");
                }
              }}
            >
              下架
            </Button>
          )}
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
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>商品管理</h1>
        <Button type="primary" onClick={() => navigate("/products/new")}>
          新建商品
        </Button>
      </div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索商品名称"
          allowClear
          style={{ width: 240 }}
          onSearch={(value) => {
            setPage(1);
            setQ(value);
          }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          value={status}
          onChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
          options={(
            Object.entries(PRODUCT_STATUS_LABELS) as [ProductStatus, string][]
          ).map(([value, label]) => ({ value, label }))}
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
