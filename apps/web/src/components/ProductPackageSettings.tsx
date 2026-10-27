import { useCallback, useEffect, useState } from "react";
import {
  Button,
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
  MAX_PACKAGE_SKUS,
} from "@shopad/shared";
import { apiFetch } from "../lib/api";
import { INPUT_LIMITS } from "../lib/inputLimits";
import { ThumbImage } from "./ThumbImage";

type PackageSkuDraft = {
  key: string;
  sku_display: string;
  sku_code: string;
  image_url: string | null;
};

function newSkuDraft(): PackageSkuDraft {
  return {
    key: newKey(),
    sku_display: "",
    sku_code: "",
    image_url: null,
  };
}

type SkuLocaleOverride = {
  sku_display: string;
  image_url: string | null;
};

type LocaleNames = {
  name: string;
  name_external: string;
  image_url: string | null;
  /** sku_code → 该语言的属性名称/图片覆盖 */
  skus: Record<string, SkuLocaleOverride>;
};

type DraftPackage = {
  key: string;
  name: string;
  name_external: string;
  original_price: number;
  discount_price: number | null;
  summary: string;
  image_url: string | null;
  /** 独立属性标题（落地页属性选择区标题） */
  sku_title: string;
  is_visible: boolean;
  quantity: number;
  independent_attrs: boolean;
  /** 独立属性（开启「独立选属性」后配置） */
  skus: PackageSkuDraft[];
  /** locale → 名称/图片覆盖 */
  locales: Record<string, LocaleNames>;
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasSkuContent(sku: PackageSkuDraft): boolean {
  return Boolean(
    sku.sku_display.trim() || sku.sku_code.trim() || sku.image_url,
  );
}

function validatePackageSkuDrafts(rows: PackageSkuDraft[]): string | null {
  const filled = rows.filter(hasSkuContent);
  if (filled.length > MAX_PACKAGE_SKUS) {
    return `独立属性最多 ${MAX_PACKAGE_SKUS} 个`;
  }
  const seen = new Map<string, string>();
  for (const [index, row] of filled.entries()) {
    const display = row.sku_display.trim();
    const code = row.sku_code.trim();
    if (!display || !code) {
      return `第 ${index + 1} 个独立属性：前端SKU名称与后端SKU均必填`;
    }
    for (const [label, value] of [
      ["前端SKU名称", display],
      ["后端SKU", code],
    ] as const) {
      const key = value.toLowerCase();
      const prev = seen.get(key);
      if (prev) {
        return `独立属性「${value}」重复：同一套餐内前端SKU名称与后端SKU均不能重复（${prev}）`;
      }
      seen.set(key, label);
    }
  }
  return null;
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
    sku_title: "",
    is_visible: true,
    quantity: 1,
    independent_attrs: false,
    skus: [],
    locales: {},
  };
}

function emptyLocaleNames(): LocaleNames {
  return { name: "", name_external: "", image_url: null, skus: {} };
}

function localesFromApi(
  rows: ProductPackageLocale[] | undefined,
): Record<string, LocaleNames> {
  const out: Record<string, LocaleNames> = {};
  for (const row of rows ?? []) {
    const skus: Record<string, SkuLocaleOverride> = {};
    for (const [codeRaw, value] of Object.entries(row.skus ?? {})) {
      const code = codeRaw.trim();
      if (!code) continue;
      skus[code] = {
        sku_display: value?.sku_display?.trim() || "",
        image_url: value?.image_url ?? null,
      };
    }
    out[row.locale] = {
      name: row.name ?? "",
      name_external: row.name_external ?? "",
      image_url: row.image_url ?? null,
      skus,
    };
  }
  return out;
}

/** 某语言下独立属性的名称/图片覆盖（按后端SKU匹配） */
function skuLocaleOverride(
  locales: Record<string, LocaleNames>,
  locale: string,
  skuCode: string,
): SkuLocaleOverride | undefined {
  const code = skuCode.trim();
  if (!code) return undefined;
  return locales[locale]?.skus[code];
}

/** 写入/清除某语言下独立属性的名称与图片覆盖 */
function withPackageSkuLocale(
  pkg: DraftPackage,
  locale: string,
  skuCode: string,
  override: SkuLocaleOverride | null,
): DraftPackage {
  const code = skuCode.trim();
  if (!code) return pkg;
  const current = pkg.locales[locale] ?? emptyLocaleNames();
  const nextSkus = { ...current.skus };
  if (override && (override.sku_display.trim() || override.image_url)) {
    nextSkus[code] = override;
  } else {
    delete nextSkus[code];
  }
  return {
    ...pkg,
    locales: {
      ...pkg.locales,
      [locale]: { ...current, skus: nextSkus },
    },
  };
}

/** 后端SKU改名时，同步迁移各语言的属性名称/图片覆盖 key */
function migrateSkuLocaleCode(
  pkg: DraftPackage,
  oldCode: string,
  newCode: string,
): DraftPackage {
  const from = oldCode.trim();
  const to = newCode.trim();
  if (!from || !to || from === to) return pkg;
  const locales: Record<string, LocaleNames> = {};
  for (const [locale, value] of Object.entries(pkg.locales)) {
    const override = value.skus[from];
    if (!override) {
      locales[locale] = value;
      continue;
    }
    const nextSkus = { ...value.skus };
    delete nextSkus[from];
    nextSkus[to] = override;
    locales[locale] = { ...value, skus: nextSkus };
  }
  return { ...pkg, locales };
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
  /** 当前行内编辑的独立属性（无弹窗） */
  const [skuEdit, setSkuEdit] = useState<{
    packageKey: string;
    skuKey: string;
    draft: PackageSkuDraft;
    isNew: boolean;
  } | null>(null);
  const [skuTitleEdit, setSkuTitleEdit] = useState<{
    packageKey: string;
    value: string;
  } | null>(null);
  const [skuUploading, setSkuUploading] = useState(false);

  // 切换语言时退出行内编辑，避免把上一语言的输入写到新语言
  useEffect(() => {
    setSkuEdit(null);
    setSkuTitleEdit(null);
  }, [contentLocale]);

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
          sku_title: pkg.sku_title ?? "",
          is_visible: pkg.is_visible,
          quantity: first?.quantity ?? 1,
          independent_attrs: first?.independent_attrs ?? false,
          skus: (pkg.skus ?? []).map((sku) => ({
            key: sku.id ?? newKey(),
            sku_display: sku.sku_display,
            sku_code: sku.sku_code,
            image_url: sku.image_url,
          })),
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

  const validatePackageDrafts = (list: DraftPackage[]): string | null => {
    for (const [i, pkg] of list.entries()) {
      if (!pkg.name.trim() || !pkg.name_external.trim()) {
        return `第 ${i + 1} 个套餐：默认名称与外文名必填`;
      }
      if (pkg.original_price < 0) {
        return `套餐「${pkg.name || i + 1}」原价无效`;
      }
      if (!Number.isFinite(pkg.quantity) || pkg.quantity < 1) {
        return `套餐「${pkg.name || i + 1}」数量无效`;
      }
      const filledSkus = pkg.skus.filter(hasSkuContent);
      if (pkg.independent_attrs && filledSkus.length === 0) {
        return `套餐「${pkg.name || i + 1}」已开启独立选属性，请至少添加一个独立属性`;
      }
      // 唯一性只在同一套餐内校验；同一商品的不同套餐之间允许重复
      const skuError = validatePackageSkuDrafts(pkg.skus);
      if (skuError) {
        return `套餐「${pkg.name || i + 1}」：${skuError}`;
      }
    }
    return null;
  };

  const persistPackages = async (
    listToSave: DraftPackage[],
    options?: { reload?: boolean; successText?: string },
  ): Promise<boolean> => {
    const validationError = validatePackageDrafts(listToSave);
    if (validationError) {
      message.error(validationError);
      return false;
    }

    const payload: UpsertProductPackageInput[] = listToSave.map((pkg, index) => ({
      name: pkg.name.trim(),
      name_external: pkg.name_external.trim(),
      original_price: pkg.original_price,
      discount_price: pkg.discount_price,
      summary: pkg.summary.trim() || null,
      image_url: pkg.image_url,
      sku_title: pkg.sku_title.trim() || null,
      is_visible: pkg.is_visible,
      sort_order: index,
      skus: pkg.skus
        .filter(hasSkuContent)
        .map((sku, skuIndex) => ({
          sku_display: sku.sku_display.trim(),
          sku_code: sku.sku_code.trim(),
          image_url: sku.image_url,
          sort_order: skuIndex,
        })),
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
      message.success(options?.successText ?? "套餐已保存");
      if (options?.reload ?? true) {
        await load();
      }
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存套餐失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (skuEdit) {
      message.warning("请先保存或取消正在编辑的独立属性");
      return;
    }
    if (skuTitleEdit) {
      message.warning("请先保存或取消正在编辑的属性标题");
      return;
    }
    await persistPackages(packages);
  };

  const editSkuTitle = (pkg: DraftPackage) => {
    if (editingLocale) return;
    if (skuEdit) {
      message.warning("请先保存或取消正在编辑的独立属性");
      return;
    }
    if (skuTitleEdit) {
      message.warning("请先保存或取消正在编辑的属性标题");
      return;
    }
    setSkuTitleEdit({ packageKey: pkg.key, value: pkg.sku_title });
  };

  const cancelSkuTitleEdit = () => {
    setSkuTitleEdit(null);
  };

  const saveSkuTitle = async () => {
    if (!skuTitleEdit) return;
    const pkg = packages.find((item) => item.key === skuTitleEdit.packageKey);
    if (!pkg) {
      setSkuTitleEdit(null);
      return;
    }
    const title = skuTitleEdit.value.trim();
    const nextPackages = packages.map((item) =>
      item.key === pkg.key ? { ...item, sku_title: title } : item,
    );
    const ok = await persistPackages(nextPackages, {
      reload: false,
      successText: "属性标题已保存",
    });
    if (!ok) return;
    setPackages(nextPackages);
    setSkuTitleEdit(null);
  };

  const patchSkuDraft = (patch: Partial<PackageSkuDraft>) => {
    setSkuEdit((prev) =>
      prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev,
    );
  };

  const addSkuRow = (pkg: DraftPackage) => {
    if (editingLocale) return;
    if (skuEdit) {
      message.warning("请先保存或取消当前正在编辑的独立属性");
      return;
    }
    if (skuTitleEdit) {
      message.warning("请先保存或取消正在编辑的属性标题");
      return;
    }
    if (pkg.skus.filter(hasSkuContent).length >= MAX_PACKAGE_SKUS) {
      message.warning(`独立属性最多 ${MAX_PACKAGE_SKUS} 个`);
      return;
    }
    const draft = newSkuDraft();
    setSkuEdit({
      packageKey: pkg.key,
      skuKey: draft.key,
      draft,
      isNew: true,
    });
  };

  const editSkuRow = (pkg: DraftPackage, sku: PackageSkuDraft) => {
    if (skuEdit) {
      message.warning("请先保存或取消当前正在编辑的独立属性");
      return;
    }
    if (skuTitleEdit) {
      message.warning("请先保存或取消正在编辑的属性标题");
      return;
    }
    if (editingLocale) {
      const override = skuLocaleOverride(
        pkg.locales,
        editingLocale,
        sku.sku_code,
      );
      setSkuEdit({
        packageKey: pkg.key,
        skuKey: sku.key,
        draft: {
          ...sku,
          sku_display: override?.sku_display.trim() || sku.sku_display,
          image_url: override?.image_url ?? null,
        },
        isNew: false,
      });
      return;
    }
    setSkuEdit({
      packageKey: pkg.key,
      skuKey: sku.key,
      draft: { ...sku },
      isNew: false,
    });
  };

  const cancelSkuEdit = () => {
    setSkuEdit(null);
  };

  const saveSkuRow = async () => {
    if (!skuEdit) return;
    const pkg = packages.find((item) => item.key === skuEdit.packageKey);
    if (!pkg) {
      setSkuEdit(null);
      return;
    }

    // 多语言模式：只覆盖当前语言的属性名称/图片，不改默认值
    if (editingLocale) {
      const base = pkg.skus.find((sku) => sku.key === skuEdit.skuKey);
      if (!base) {
        setSkuEdit(null);
        return;
      }
      const code = base.sku_code.trim();
      const name = skuEdit.draft.sku_display.trim();
      const image = skuEdit.draft.image_url;
      if (!code) {
        message.error("后端SKU不能为空");
        return;
      }
      const effectiveName = (name || base.sku_display).trim().toLowerCase();
      const duplicate = pkg.skus.some((sku) => {
        if (sku.key === base.key) return false;
        const other = skuLocaleOverride(
          pkg.locales,
          editingLocale,
          sku.sku_code,
        );
        const otherName = (other?.sku_display.trim() || sku.sku_display)
          .trim()
          .toLowerCase();
        return otherName === effectiveName;
      });
      if (duplicate) {
        message.error("该语言下前端SKU名称与同套餐其他属性重复");
        return;
      }
      const nextPackages = packages.map((item) =>
        item.key === pkg.key
          ? withPackageSkuLocale(item, editingLocale, code, {
              // 与默认名称一致时不写入冗余覆盖，保持跟随默认值
              sku_display:
                name && name !== base.sku_display.trim() ? name : "",
              image_url: image,
            })
          : item,
      );
      const ok = await persistPackages(nextPackages, {
        reload: false,
        successText: "语言属性已保存",
      });
      if (!ok) return;
      setPackages(nextPackages);
      setSkuEdit(null);
      return;
    }

    const display = skuEdit.draft.sku_display.trim();
    const code = skuEdit.draft.sku_code.trim();
    if (!display || !code) {
      message.error("前端SKU名称与后端SKU均必填");
      return;
    }
    const duplicate = pkg.skus.some(
      (sku) =>
        sku.key !== skuEdit.skuKey &&
        (sku.sku_display.trim().toLowerCase() === display.toLowerCase() ||
          sku.sku_code.trim().toLowerCase() === code.toLowerCase()),
    );
    if (duplicate) {
      message.error("同一套餐内前端SKU名称与后端SKU不能重复");
      return;
    }
    const base = pkg.skus.find((sku) => sku.key === skuEdit.skuKey);
    const oldCode = base?.sku_code.trim() ?? "";
    const normalized: PackageSkuDraft = {
      ...skuEdit.draft,
      sku_display: display,
      sku_code: code,
    };
    const nextPackages = packages.map((item) => {
      if (item.key !== pkg.key) return item;
      const nextItem: DraftPackage = {
        ...item,
        skus: skuEdit.isNew
          ? [...item.skus, normalized]
          : item.skus.map((sku) =>
              sku.key === skuEdit.skuKey ? normalized : sku,
            ),
      };
      return oldCode && oldCode !== code
        ? migrateSkuLocaleCode(nextItem, oldCode, code)
        : nextItem;
    });
    const ok = await persistPackages(nextPackages, {
      reload: false,
      successText: "独立属性已保存",
    });
    if (!ok) return;
    setPackages(nextPackages);
    setSkuEdit(null);
  };

  const deleteSkuRow = async (pkg: DraftPackage, sku: PackageSkuDraft) => {
    if (editingLocale) return;
    if (skuTitleEdit) {
      message.warning("请先保存或取消正在编辑的属性标题");
      return;
    }
    if (skuEdit?.isNew && skuEdit.skuKey === sku.key) {
      setSkuEdit(null);
      return;
    }
    if (sku.key === skuEdit?.skuKey) {
      setSkuEdit(null);
    }
    const remaining = pkg.skus.filter((row) => row.key !== sku.key);
    const disableIndependent =
      pkg.independent_attrs && remaining.filter(hasSkuContent).length === 0;
    const nextPackages = packages.map((item) =>
      item.key === pkg.key
        ? {
            ...item,
            independent_attrs: disableIndependent
              ? false
              : item.independent_attrs,
            skus: remaining,
          }
        : item,
    );
    const ok = await persistPackages(nextPackages, {
      reload: false,
      successText: "独立属性已删除",
    });
    if (!ok) return;
    setPackages(nextPackages);
    if (disableIndependent) {
      message.info("已删除最后一个独立属性，已自动关闭「独立选属性」");
    }
  };

  const uploadSkuImage = async (file: File) => {
    setSkuUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ url: string }>(
        "/api/uploads/product-image",
        { method: "POST", body },
      );
      patchSkuDraft({ image_url: res.url });
      message.success("属性图片上传成功");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setSkuUploading(false);
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
        {!editingLocale ? (
          <span>
            {" "}
            开启某个套餐的「独立选属性」后，套餐下方会显示独立属性表格，可直接添加、编辑、删除；行内「保存 / 删除」立即生效，未上传图片时默认使用套餐图片。表格上方的「属性标题」可点击「编辑」设置落地页展示标题。
          </span>
        ) : null}
        {editingLocale ? (
          <span>
            {" "}
            当前编辑{" "}
            <b>
              {localeLabel} · {editingLocale}（
              {saPathPrefixForLocale(editingLocale, regionName)}）
            </b>{" "}
            的套餐名称、外文名与图片；独立属性可在下方表格中点「编辑」修改该语言的名称和图片。价格/数量等仍在「默认」语言下修改。
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
          <ThumbImage src={currentProduct.cover_url} width={48} height={48} />
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
        className="package-table"
        rowKey="key"
        loading={loading}
        pagination={false}
        dataSource={packages}
        scroll={{ x: "max-content" }}
        expandable={{
          // 独立属性常驻显示在各自套餐行下方
          expandedRowKeys: packages
            .filter((pkg) => pkg.independent_attrs)
            .map((pkg) => pkg.key),
          expandIcon: () => null,
          rowExpandable: (row) => row.independent_attrs,
          expandedRowRender: (row) => {
            const localeImage = editingLocale
              ? row.locales[editingLocale]?.image_url
              : null;
            const fallbackImage =
              localeImage || row.image_url || currentProduct.cover_url || null;
            const isRowEditing = (skuKey: string) =>
              skuEdit?.packageKey === row.key && skuEdit.skuKey === skuKey;
            const skuRows =
              skuEdit?.packageKey === row.key
                ? skuEdit.isNew
                  ? [...row.skus, skuEdit.draft]
                  : row.skus.map((sku) =>
                      sku.key === skuEdit.skuKey ? skuEdit.draft : sku,
                    )
                : row.skus;
            const disabled = Boolean(editingLocale);
            const editingTitle = skuTitleEdit?.packageKey === row.key;
            const imagePlaceholder = (
              <div
                style={{
                  width: 40,
                  height: 40,
                  background: "#fafafa",
                  border: "1px dashed #d9d9d9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "#999",
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                无图
              </div>
            );

            return (
              <div
                style={{
                  margin: "2px 0 6px",
                  padding: "10px 12px 12px",
                  background: "#f7fafd",
                  border: "1px dashed #dce5ef",
                  borderRadius: 10,
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 10,
                    minHeight: 24,
                  }}
                >
                  {editingTitle ? (
                    <>
                      <Input
                        size="small"
                        autoFocus
                        maxLength={INPUT_LIMITS.name}
                        value={skuTitleEdit?.value ?? ""}
                        placeholder="属性标题"
                        disabled={saving}
                        style={{ maxWidth: 320 }}
                        onChange={(e) =>
                          setSkuTitleEdit((prev) =>
                            prev ? { ...prev, value: e.target.value } : prev,
                          )
                        }
                        onPressEnter={() => void saveSkuTitle()}
                      />
                      <Space size={8}>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          loading={saving}
                          onClick={() => void saveSkuTitle()}
                        >
                          保存
                        </Button>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          disabled={saving}
                          onClick={cancelSkuTitleEdit}
                        >
                          取消
                        </Button>
                      </Space>
                    </>
                  ) : (
                    <>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1f2d3d",
                        }}
                      >
                        {row.sku_title.trim() || "属性标题"}
                      </span>
                      {!disabled ? (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          disabled={saving || Boolean(skuEdit)}
                          onClick={() => editSkuTitle(row)}
                        >
                          编辑
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
                {skuRows.length > 0 ? (
                  <Table<PackageSkuDraft>
                    className="package-sku-table"
                    rowKey="key"
                    size="small"
                    pagination={false}
                    dataSource={skuRows}
                    style={{ marginBottom: 10 }}
                    columns={[
                      {
                        title: "图片",
                        dataIndex: "image_url",
                        width: "18%",
                        render: (_, sku) => {
                          const editing = isRowEditing(sku.key);
                          const base = row.skus.find(
                            (item) => item.key === sku.key,
                          );
                          const override =
                            editingLocale && base
                              ? skuLocaleOverride(
                                  row.locales,
                                  editingLocale,
                                  base.sku_code,
                                )
                              : undefined;
                          const ownImage = editing
                            ? editingLocale
                              ? sku.image_url || base?.image_url || null
                              : sku.image_url
                            : editingLocale
                              ? override?.image_url || sku.image_url
                              : sku.image_url;
                          const localeImage = editing
                            ? editingLocale
                              ? sku.image_url
                              : null
                            : editingLocale
                              ? (override?.image_url ?? null)
                              : null;
                          const imageUrl =
                            localeImage || ownImage || fallbackImage;
                          if (!editing) {
                            return (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                {imageUrl ? (
                                  <ThumbImage
                                    src={imageUrl}
                                    width={40}
                                    height={40}
                                  />
                                ) : (
                                  imagePlaceholder
                                )}
                                {!ownImage && fallbackImage ? (
                                  <span
                                    style={{ fontSize: 11, color: "#b0bcc9" }}
                                  >
                                    默认套餐图
                                  </span>
                                ) : null}
                              </div>
                            );
                          }
                          return (
                            <Space size={4} align="center">
                              {imageUrl ? (
                                <ThumbImage
                                  src={imageUrl}
                                  width={40}
                                  height={40}
                                />
                              ) : (
                                imagePlaceholder
                              )}
                              <Upload
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                showUploadList={false}
                                disabled={saving || skuUploading}
                                beforeUpload={(file) => {
                                  void uploadSkuImage(file);
                                  return false;
                                }}
                              >
                                <Button
                                  size="small"
                                  type="link"
                                  style={{ padding: 0 }}
                                  loading={skuUploading}
                                  disabled={saving}
                                >
                                  {sku.image_url ? "更换" : "上传"}
                                </Button>
                              </Upload>
                              {sku.image_url ? (
                                <Button
                                  size="small"
                                  type="link"
                                  danger
                                  style={{ padding: 0 }}
                                  disabled={saving}
                                  onClick={() =>
                                    patchSkuDraft({ image_url: null })
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
                        title: "名称",
                        dataIndex: "sku_display",
                        width: "26%",
                        render: (_, sku) => {
                          if (!isRowEditing(sku.key)) {
                            const base =
                              row.skus.find((item) => item.key === sku.key) ??
                              sku;
                            const override = editingLocale
                              ? skuLocaleOverride(
                                  row.locales,
                                  editingLocale,
                                  base.sku_code,
                                )
                              : undefined;
                            return (
                              <span style={{ fontSize: 13 }}>
                                {override?.sku_display.trim() ||
                                  sku.sku_display ||
                                  "—"}
                              </span>
                            );
                          }
                          return (
                            <Input
                              size="small"
                              maxLength={INPUT_LIMITS.name}
                              value={sku.sku_display}
                              disabled={saving}
                              placeholder={
                                editingLocale
                                  ? "该语言的前端SKU名称"
                                  : "前端SKU名称"
                              }
                              onChange={(e) =>
                                patchSkuDraft({
                                  sku_display: e.target.value,
                                })
                              }
                            />
                          );
                        },
                      },
                      {
                        title: "SKU",
                        dataIndex: "sku_code",
                        width: "26%",
                        render: (_, sku) => {
                          const editing = isRowEditing(sku.key);
                          const base = row.skus.find(
                            (item) => item.key === sku.key,
                          );
                          if (!editing) {
                            return (
                              <span style={{ fontSize: 13, color: "#5b6b7c" }}>
                                {sku.sku_code || "—"}
                              </span>
                            );
                          }
                          if (editingLocale) {
                            return (
                              <span
                                style={{ fontSize: 13, color: "#8c9bab" }}
                                title="后端SKU不随语言变化，请在默认语言下修改"
                              >
                                {base?.sku_code || sku.sku_code || "—"}
                              </span>
                            );
                          }
                          return (
                            <Input
                              size="small"
                              maxLength={INPUT_LIMITS.name}
                              value={sku.sku_code}
                              disabled={saving}
                              placeholder="后端SKU"
                              onChange={(e) =>
                                patchSkuDraft({ sku_code: e.target.value })
                              }
                            />
                          );
                        },
                      },
                      {
                        title: "编辑",
                        width: "15%",
                        render: (_, sku) => {
                          if (!isRowEditing(sku.key)) {
                            return (
                              <Button
                                type="link"
                                size="small"
                                style={{ padding: 0 }}
                                disabled={saving}
                                onClick={() => editSkuRow(row, sku)}
                              >
                                编辑
                              </Button>
                            );
                          }
                          return (
                            <Space size={8}>
                              <Button
                                type="link"
                                size="small"
                                style={{ padding: 0 }}
                                loading={saving}
                                onClick={() => void saveSkuRow()}
                              >
                                保存
                              </Button>
                              <Button
                                type="link"
                                size="small"
                                style={{ padding: 0 }}
                                disabled={saving}
                                onClick={cancelSkuEdit}
                              >
                                取消
                              </Button>
                            </Space>
                          );
                        },
                      },
                      {
                        title: "删除",
                        width: "15%",
                        render: (_, sku) => (
                          <Button
                            type="link"
                            size="small"
                            danger
                            style={{ padding: 0 }}
                            disabled={disabled || saving}
                            onClick={() => void deleteSkuRow(row, sku)}
                          >
                            删除
                          </Button>
                        ),
                      },
                    ]}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={
                    disabled ||
                    saving ||
                    Boolean(skuEdit) ||
                    Boolean(skuTitleEdit)
                  }
                  onClick={() => addSkuRow(row)}
                  style={{
                    width: "100%",
                    padding: "14px 12px",
                    background: "#fff",
                    border: "1px dashed #c9d8e8",
                    borderRadius: 8,
                    color:
                      disabled ||
                      saving ||
                      Boolean(skuEdit) ||
                      Boolean(skuTitleEdit)
                        ? "#bfbfbf"
                        : "#3b9cff",
                    fontSize: 13,
                    cursor:
                      disabled ||
                      saving ||
                      Boolean(skuEdit) ||
                      Boolean(skuTitleEdit)
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  <PlusOutlined style={{ marginRight: 6 }} />
                  添加独立属性
                </button>
                {disabled ? (
                  <div style={{ fontSize: 12, color: "#8c9bab", marginTop: 6 }}>
                    当前为 {localeLabel} 语言：可编辑独立属性的名称和图片；
                    添加/删除请在「默认」语言下操作。
                  </div>
                ) : null}
              </div>
            );
          },
        }}
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
                    <ThumbImage src={imgUrl} width={40} height={40} />
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
                  if (skuEdit?.packageKey === row.key) setSkuEdit(null);
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
