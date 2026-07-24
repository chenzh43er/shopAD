import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Image,
  Input,
  InputNumber,
  Space,
  Switch,
  Table,
  Tabs,
  Upload,
  message,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type {
  Product,
  ProductPackageWithItems,
  UpsertProductPackageInput,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";

type DraftPackage = {
  key: string;
  name: string;
  name_external: string;
  original_price: number;
  discount_price: number | null;
  summary: string;
  image_url: string | null;
  is_visible: boolean;
  quantity: number;
  independent_attrs: boolean;
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPackage(): DraftPackage {
  return {
    key: newKey(),
    name: "",
    name_external: "",
    original_price: 0,
    discount_price: null,
    summary: "",
    image_url: null,
    is_visible: true,
    quantity: 1,
    independent_attrs: false,
  };
}

interface Props {
  productId: string;
  /** 套餐明细固定为基本信息保存后的当前商品 */
  currentProduct: Pick<Product, "id" | "name" | "cover_url">;
}

export function ProductPackageSettings({ productId, currentProduct }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packages, setPackages] = useState<DraftPackage[]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: ProductPackageWithItems[] }>(
        `/api/products/${productId}/packages`,
      );
      const drafts: DraftPackage[] = (res.data ?? []).map((pkg) => {
        const first = (pkg.items ?? [])[0];
        return {
          key: pkg.id,
          name: pkg.name,
          name_external: pkg.name_external,
          original_price: Number(pkg.original_price),
          discount_price:
            pkg.discount_price == null ? null : Number(pkg.discount_price),
          summary: pkg.summary ?? "",
          image_url: pkg.image_url,
          is_visible: pkg.is_visible,
          quantity: first?.quantity ?? 1,
          independent_attrs: first?.independent_attrs ?? false,
        };
      });
      setPackages(drafts);
      setActiveKey(drafts[0]?.key ?? "");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载套餐失败");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePackage = (key: string, patch: Partial<DraftPackage>) => {
    setPackages((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    );
  };

  const uploadPackageImage = async (packageKey: string, file: File) => {
    setUploadingKey(packageKey);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ url: string }>(
        "/api/uploads/product-image",
        { method: "POST", body },
      );
      updatePackage(packageKey, { image_url: res.url });
      message.success("套餐图片已上传");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploadingKey(null);
    }
  };

  const save = async () => {
    for (const [i, pkg] of packages.entries()) {
      if (!pkg.name.trim() || !pkg.name_external.trim()) {
        message.error(`第 ${i + 1} 个套餐：名称与外文名必填`);
        return;
      }
      if (pkg.original_price < 0) {
        message.error(`套餐「${pkg.name || i + 1}」原价无效`);
        return;
      }
      if (!Number.isFinite(pkg.quantity) || pkg.quantity < 1) {
        message.error(`套餐「${pkg.name || i + 1}」数量无效`);
        return;
      }
    }

    const payload: UpsertProductPackageInput[] = packages.map((pkg, index) => ({
      name: pkg.name.trim(),
      name_external: pkg.name_external.trim(),
      original_price: pkg.original_price,
      discount_price: pkg.discount_price,
      summary: pkg.summary.trim() || null,
      image_url: pkg.image_url,
      is_visible: pkg.is_visible,
      sort_order: index,
      items: [
        {
          ref_product_id: currentProduct.id,
          quantity: pkg.quantity,
          independent_attrs: pkg.independent_attrs,
          sort_order: 0,
        },
      ],
    }));

    setSaving(true);
    try {
      await apiFetch(`/api/products/${productId}/packages`, {
        method: "PUT",
        body: JSON.stringify({ packages: payload }),
      });
      message.success("套餐已保存");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存套餐失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12, color: "#666" }}>
        套餐商品固定为当前商品，只需填写数量与是否独立选属性。售价以套餐为准。
      </div>

      <Space style={{ marginBottom: 16 }} align="center">
        {currentProduct.cover_url ? (
          <Image src={currentProduct.cover_url} width={48} height={48} />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              background: "#f5f5f5",
              color: "#999",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
            }}
          >
            无图
          </div>
        )}
        <span>当前商品：{currentProduct.name}</span>
      </Space>

      <Table<DraftPackage>
        rowKey="key"
        loading={loading}
        pagination={false}
        dataSource={packages}
        scroll={{ x: "max-content" }}
        columns={[
          {
            title: (
              <span>
                <span style={{ color: "#ff4d4f" }}>* </span>套餐名称
              </span>
            ),
            dataIndex: "name",
            width: 120,
            render: (_, row) => (
              <Input
                value={row.name}
                maxLength={INPUT_LIMITS.name}
                placeholder="如 6pcs"
                onChange={(e) =>
                  updatePackage(row.key, { name: e.target.value })
                }
              />
            ),
          },
          {
            title: (
              <span>
                <span style={{ color: "#ff4d4f" }}>* </span>套餐名称(外文)
              </span>
            ),
            dataIndex: "name_external",
            width: 140,
            render: (_, row) => (
              <Input
                value={row.name_external}
                maxLength={INPUT_LIMITS.name}
                placeholder="如 6pcs"
                onChange={(e) =>
                  updatePackage(row.key, { name_external: e.target.value })
                }
              />
            ),
          },
          {
            title: (
              <span>
                <span style={{ color: "#ff4d4f" }}>* </span>套餐原价
              </span>
            ),
            dataIndex: "original_price",
            width: 130,
            render: (_, row) => (
              <InputNumber
                min={0}
                precision={2}
                style={{ width: "100%" }}
                value={row.original_price}
                onChange={(v) =>
                  updatePackage(row.key, { original_price: Number(v ?? 0) })
                }
              />
            ),
          },
          {
            title: "套餐折扣价",
            dataIndex: "discount_price",
            width: 130,
            render: (_, row) => (
              <InputNumber
                min={0}
                precision={2}
                style={{ width: "100%" }}
                value={row.discount_price ?? undefined}
                onChange={(v) =>
                  updatePackage(row.key, {
                    discount_price: v == null ? null : Number(v),
                  })
                }
              />
            ),
          },
          {
            title: "套餐摘要",
            dataIndex: "summary",
            width: 160,
            render: (_, row) => (
              <Input
                value={row.summary}
                maxLength={INPUT_LIMITS.mediumText}
                onChange={(e) =>
                  updatePackage(row.key, { summary: e.target.value })
                }
              />
            ),
          },
          {
            title: "套餐图片",
            dataIndex: "image_url",
            width: 120,
            render: (_, row) => (
              <Space direction="vertical" size={4}>
                {row.image_url ? (
                  <Image src={row.image_url} width={48} height={48} />
                ) : null}
                <Upload
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void uploadPackageImage(row.key, file);
                    return false;
                  }}
                >
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    loading={uploadingKey === row.key}
                  >
                    上传
                  </Button>
                </Upload>
              </Space>
            ),
          },
          {
            title: "是否前端可见",
            dataIndex: "is_visible",
            width: 110,
            render: (_, row) => (
              <Switch
                checked={row.is_visible}
                onChange={(checked) =>
                  updatePackage(row.key, { is_visible: checked })
                }
              />
            ),
          },
          {
            title: "",
            width: 56,
            fixed: "right",
            render: (_, row) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setPackages((prev) => {
                    const next = prev.filter((p) => p.key !== row.key);
                    if (activeKey === row.key) {
                      setActiveKey(next[0]?.key ?? "");
                    }
                    return next;
                  });
                }}
              />
            ),
          },
        ]}
      />

      <Button
        type="dashed"
        icon={<PlusOutlined />}
        style={{ marginTop: 12 }}
        onClick={() => {
          const pkg = emptyPackage();
          setPackages((prev) => [...prev, pkg]);
          setActiveKey(pkg.key);
        }}
      >
        添加新套餐
      </Button>

      <h3 style={{ marginTop: 28, marginBottom: 12 }}>套餐明细</h3>
      {packages.length === 0 ? (
        <div style={{ color: "#999" }}>请先添加套餐</div>
      ) : (
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          items={packages.map((pkg) => ({
            key: pkg.key,
            label: pkg.name.trim() || "未命名套餐",
            children: (
              <Table
                rowKey="key"
                pagination={false}
                scroll={{ x: "max-content" }}
                dataSource={[
                  {
                    key: pkg.key,
                    name: currentProduct.name,
                    cover_url: currentProduct.cover_url,
                    quantity: pkg.quantity,
                    independent_attrs: pkg.independent_attrs,
                  },
                ]}
                columns={[
                  { title: "商品名称", dataIndex: "name" },
                  {
                    title: "商品封面",
                    width: 90,
                    render: (_, row) =>
                      row.cover_url ? (
                        <Image src={row.cover_url} width={48} height={48} />
                      ) : (
                        <span style={{ color: "#999" }}>无图</span>
                      ),
                  },
                  {
                    title: (
                      <span>
                        <span style={{ color: "#ff4d4f" }}>* </span>数量
                      </span>
                    ),
                    width: 120,
                    render: () => (
                      <InputNumber
                        min={1}
                        precision={0}
                        value={pkg.quantity}
                        onChange={(v) =>
                          updatePackage(pkg.key, {
                            quantity: Math.max(1, Number(v ?? 1)),
                          })
                        }
                      />
                    ),
                  },
                  {
                    title: "是否每个商品独立选择属性",
                    width: 220,
                    render: () => (
                      <Switch
                        checked={pkg.independent_attrs}
                        onChange={(checked) =>
                          updatePackage(pkg.key, {
                            independent_attrs: checked,
                          })
                        }
                      />
                    ),
                  },
                ]}
              />
            ),
          }))}
        />
      )}

      <div style={{ marginTop: 24 }}>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存套餐设置
        </Button>
      </div>
    </div>
  );
}
