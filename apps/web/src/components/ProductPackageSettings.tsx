import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Image,
  Input,
  InputNumber,
  Space,
  Switch,
  Table,
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
  ProductPackageLocale,
  ProductPackageWithItems,
  UpsertProductPackageInput,
} from "@shopad/shared";
import {
  localeDisplayLabel,
  saPathPrefixForLocale,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";

type LocaleNames = {
  name: string;
  name_external: string;
  image_url: string | null;
};

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
  /** locale → 名称/图片覆盖 */
  locales: Record<string, LocaleNames>;
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
    locales: {},
  };
}

function emptyLocaleNames(): LocaleNames {
  return { name: "", name_external: "", image_url: null };
}

function localesFromApi(
  rows: ProductPackageLocale[] | undefined,
): Record<string, LocaleNames> {
  const out: Record<string, LocaleNames> = {};
  for (const row of rows ?? []) {
    out[row.locale] = {
      name: row.name ?? "",
      name_external: row.name_external ?? "",
      image_url: row.image_url ?? null,
    };
  }
  return out;
}

interface Props {
  productId: string;
  /** 套餐明细固定为基本信息保存后的当前商品 */
  currentProduct: Pick<Product, "id" | "name" | "cover_url">;
  /** 与套餐页语言工具栏同步：default | en | fr … */
  contentLocale?: "default" | string;
  addedLocales?: string[];
  /** 商品地区名，用于拼接 /{region}_{locale} */
  regionName?: string | null;
  localeLabels?: Record<string, string>;
}

export function ProductPackageSettings({
  productId,
  currentProduct,
  contentLocale = "default",
  addedLocales = [],
  regionName,
  localeLabels = {},
}: Props) {
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
          locales: localesFromApi(pkg.locales as ProductPackageLocale[]),
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

  const updateLocaleNames = (
    key: string,
    locale: string,
    patch: Partial<LocaleNames>,
  ) => {
    setPackages((prev) =>
      prev.map((p) => {
        if (p.key !== key) return p;
        const cur = p.locales[locale] ?? emptyLocaleNames();
        return {
          ...p,
          locales: {
            ...p.locales,
            [locale]: { ...cur, ...patch },
          },
        };
      }),
    );
  };

  const uploadPackageImage = async (
    packageKey: string,
    file: File,
    locale?: string | null,
  ) => {
    setUploadingKey(packageKey);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ url: string }>("/api/uploads/product-image", {
        method: "POST",
        body,
      });
      if (locale) {
        updateLocaleNames(packageKey, locale, { image_url: res.url });
      } else {
        updatePackage(packageKey, { image_url: res.url });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploadingKey(null);
    }
  };

  const save = async () => {
    for (const [i, pkg] of packages.entries()) {
      if (!pkg.name.trim() || !pkg.name_external.trim()) {
        message.error(`第 ${i + 1} 个套餐：默认名称与外文名必填`);
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
      locales: pkg.locales,
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

  const editingLocale =
    contentLocale !== "default" ? contentLocale : null;
  const localeLabel = editingLocale
    ? localeDisplayLabel(editingLocale, localeLabels[editingLocale])
    : null;

  return (
    <div>
      <div style={{ marginBottom: 12, color: "#666" }}>
        套餐商品固定为当前商品，只需填写数量与是否独立选属性。售价以套餐为准。
        {editingLocale ? (
          <span>
            {" "}
            当前编辑{" "}
            <b>
              {localeLabel} · {editingLocale}（
              {saPathPrefixForLocale(editingLocale, regionName)}）
            </b>{" "}
            的套餐名称、外文名与图片；价格/数量等仍在「默认」语言下修改。
          </span>
        ) : addedLocales.length > 0 ? (
          <span>
            {" "}
            已添加语言：{addedLocales.join(", ")}
            。上方切换语言后，可填写该语言的套餐名称、外文名与图片。
          </span>
        ) : null}
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
                <span style={{ color: "#ff4d4f" }}>* </span>
                {editingLocale
                  ? `套餐名称（${localeLabel}）`
                  : "套餐名称"}
              </span>
            ),
            dataIndex: "name",
            width: 140,
            render: (_, row) =>
              editingLocale ? (
                <Input
                  value={row.locales[editingLocale]?.name ?? ""}
                  maxLength={INPUT_LIMITS.name}
                  placeholder="该语言套餐名"
                  onChange={(e) =>
                    updateLocaleNames(row.key, editingLocale, {
                      name: e.target.value,
                    })
                  }
                />
              ) : (
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
                <span style={{ color: "#ff4d4f" }}>* </span>
                {editingLocale
                  ? `套餐名称(外文)（${localeLabel}）`
                  : "套餐名称(外文)"}
              </span>
            ),
            dataIndex: "name_external",
            width: 160,
            render: (_, row) =>
              editingLocale ? (
                <Input
                  value={row.locales[editingLocale]?.name_external ?? ""}
                  maxLength={INPUT_LIMITS.name}
                  placeholder="该语言外文名"
                  onChange={(e) =>
                    updateLocaleNames(row.key, editingLocale, {
                      name_external: e.target.value,
                    })
                  }
                />
              ) : (
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
                disabled={Boolean(editingLocale)}
                onChange={(v) =>
                  updatePackage(row.key, { original_price: Number(v ?? 0) })
                }
              />
            ),
          },
          {
            title: "折扣价",
            dataIndex: "discount_price",
            width: 130,
            render: (_, row) => (
              <InputNumber
                min={0}
                precision={2}
                style={{ width: "100%" }}
                value={row.discount_price ?? undefined}
                disabled={Boolean(editingLocale)}
                onChange={(v) =>
                  updatePackage(row.key, {
                    discount_price: v == null ? null : Number(v),
                  })
                }
              />
            ),
          },
          {
            title: "数量",
            dataIndex: "quantity",
            width: 100,
            render: (_, row) => (
              <InputNumber
                min={1}
                precision={0}
                style={{ width: "100%" }}
                value={row.quantity}
                disabled={Boolean(editingLocale)}
                onChange={(v) =>
                  updatePackage(row.key, { quantity: Number(v ?? 1) })
                }
              />
            ),
          },
          {
            title: "独立选属性",
            dataIndex: "independent_attrs",
            width: 100,
            render: (_, row) => (
              <Switch
                checked={row.independent_attrs}
                disabled={Boolean(editingLocale)}
                onChange={(checked) =>
                  updatePackage(row.key, { independent_attrs: checked })
                }
              />
            ),
          },
          {
            title: "可见",
            dataIndex: "is_visible",
            width: 80,
            render: (_, row) => (
              <Switch
                checked={row.is_visible}
                disabled={Boolean(editingLocale)}
                onChange={(checked) =>
                  updatePackage(row.key, { is_visible: checked })
                }
              />
            ),
          },
          {
            title: editingLocale ? `图片（${localeLabel}）` : "图片",
            dataIndex: "image_url",
            width: 180,
            render: (_, row) => {
              const imgUrl = editingLocale
                ? (row.locales[editingLocale]?.image_url ?? null)
                : row.image_url;
              return (
                <Space>
                  {imgUrl ? (
                    <Image src={imgUrl} width={40} height={40} />
                  ) : null}
                  <Upload
                    accept="image/*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void uploadPackageImage(
                        row.key,
                        file,
                        editingLocale,
                      );
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
                  {editingLocale && imgUrl ? (
                    <Button
                      size="small"
                      type="text"
                      danger
                      onClick={() =>
                        updateLocaleNames(row.key, editingLocale, {
                          image_url: null,
                        })
                      }
                    >
                      清除
                    </Button>
                  ) : null}
                </Space>
              );
            },
          },
          {
            title: "操作",
            width: 80,
            fixed: "right",
            render: (_, row) => (
              <Button
                danger
                type="text"
                icon={<DeleteOutlined />}
                disabled={Boolean(editingLocale)}
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

      <Space style={{ marginTop: 16 }}>
        <Button
          icon={<PlusOutlined />}
          disabled={Boolean(editingLocale)}
          onClick={() => {
            const pkg = emptyPackage();
            setPackages((prev) => [...prev, pkg]);
            setActiveKey(pkg.key);
          }}
        >
          添加套餐
        </Button>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存套餐
        </Button>
      </Space>
    </div>
  );
}
