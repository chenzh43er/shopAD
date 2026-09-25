/** 审计日志字段对比：生成 before/after 明细，供前端展示 */

export type AuditFieldDiff = {
  field: string;
  from: unknown;
  to: unknown;
};

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: "商品名称",
  description: "描述",
  description_entries: "描述条目",
  price: "价格",
  status: "状态",
  link_suffix: "链接后缀",
  title_external: "外文标题",
  label: "语言名称",
  cover_url: "封面图",
  gallery_urls: "轮播图",
  detail_image_urls: "详情图",
  facebook_pixel_id: "Facebook 像素",
  google_conversion_id: "Google 转化 ID",
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
  image_url: "图片",
  locale: "语言字段",
  removed_locale: "删除语言",
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
  owner_member: "归属成员",
  shipping_order_no: "发货订单号",
  remark: "备注",
};

export function fieldLabelZh(field: string): string {
  return PRODUCT_FIELD_LABELS[field] ?? field;
}

export function summarizeFieldDiffs(diffs: AuditFieldDiff[]): string {
  if (diffs.length === 0) return "无字段差异";
  return diffs
    .map((d) => `${fieldLabelZh(d.field)}: ${formatBrief(d.from)} → ${formatBrief(d.to)}`)
    .join("；");
}

function formatBrief(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return `${value.length} 项`;
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function normalizeComparable(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value.length);
    }
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const left = [...a].map((x) => normalizeComparable(x)).sort();
    const right = [...b].map((x) => normalizeComparable(x)).sort();
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return normalizeComparable(a) === normalizeComparable(b);
}

/** 从 before 行与 patch 生成实际发生变化的字段列表 */
export function buildFieldDiffs(
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
  options?: { skipKeys?: string[] },
): AuditFieldDiff[] {
  const skip = new Set(options?.skipKeys ?? ["updated_by", "updated_at"]);
  const diffs: AuditFieldDiff[] = [];
  for (const [field, to] of Object.entries(patch)) {
    if (skip.has(field)) continue;
    const from = before ? before[field] : undefined;
    if (valuesEqual(from, to)) continue;
    diffs.push({ field, from: from ?? null, to: to ?? null });
  }
  return diffs;
}

export function packageSnapshot(pkg: {
  name?: string | null;
  name_external?: string | null;
  original_price?: number | null;
  discount_price?: number | null;
  summary?: string | null;
  image_url?: string | null;
  is_visible?: boolean | null;
  sort_order?: number | null;
  locales?: Record<
    string,
    { name?: string; name_external?: string; image_url?: string | null }
  > | null;
  items?: Array<{
    ref_product_id?: string | null;
    quantity?: number | null;
    independent_attrs?: boolean | null;
  }> | null;
}) {
  const items = (pkg.items ?? []).map((item) => ({
    ref_product_id: item.ref_product_id ?? null,
    quantity: Number(item.quantity) || 0,
    independent_attrs: Boolean(item.independent_attrs),
  }));
  const locales: Record<
    string,
    { name: string; name_external: string; image_url: string | null }
  > = {};
  for (const [code, value] of Object.entries(pkg.locales ?? {})) {
    const name = value?.name?.trim() || "";
    const nameExternal = value?.name_external?.trim() || "";
    const imageUrl = value?.image_url?.trim() || null;
    if (!name && !nameExternal && !imageUrl) continue;
    locales[code] = {
      name,
      name_external: nameExternal,
      image_url: imageUrl,
    };
  }
  return {
    name: (pkg.name ?? "").trim(),
    name_external: (pkg.name_external ?? "").trim(),
    original_price: Number(pkg.original_price) || 0,
    discount_price:
      pkg.discount_price == null ? null : Number(pkg.discount_price) || 0,
    summary: (pkg.summary ?? "").trim() || null,
    image_url: (pkg.image_url ?? "").trim() || null,
    is_visible: pkg.is_visible ?? true,
    sort_order: Number(pkg.sort_order) || 0,
    item_count: items.length,
    items,
    locales,
    locale_count: Object.keys(locales).length,
  };
}

type PackageSnap = ReturnType<typeof packageSnapshot>;

const PACKAGE_SUB_FIELD_LABELS: Record<string, string> = {
  original_price: "原价",
  discount_price: "折扣价",
  summary: "说明",
  image_url: "图片",
  is_visible: "是否显示",
  sort_order: "排序",
  item_count: "明细件数",
  items: "明细内容",
  locales: "多语言",
  locale_count: "语言数",
};

function packageKey(pkg: PackageSnap): string {
  return `${pkg.name}||${pkg.name_external}`;
}

function formatLocalesBrief(
  locales: PackageSnap["locales"],
): string {
  const codes = Object.keys(locales);
  if (codes.length === 0) return "无";
  return codes
    .map((code) => {
      const row = locales[code]!;
      const parts = [row.name || row.name_external || "未命名"];
      if (row.image_url) parts.push("有图");
      return `${code}(${parts.join("·")})`;
    })
    .join(", ");
}

/** 对比套餐全量替换前后，生成可读变更摘要与明细 */
export function buildPackageUpdateDiffs(
  beforeList: PackageSnap[],
  afterList: PackageSnap[],
): { diffs: AuditFieldDiff[]; summary: string } {
  const diffs: AuditFieldDiff[] = [];
  const lines: string[] = [];

  if (beforeList.length !== afterList.length) {
    diffs.push({
      field: "package_count",
      from: beforeList.length,
      to: afterList.length,
    });
    lines.push(`套餐数量: ${beforeList.length} → ${afterList.length}`);
  }

  const beforeMap = new Map(beforeList.map((p) => [packageKey(p), p]));
  const afterMap = new Map(afterList.map((p) => [packageKey(p), p]));
  const matchedBefore = new Set<string>();

  for (const [key, after] of afterMap) {
    const before = beforeMap.get(key);
    if (!before) {
      diffs.push({
        field: "package_added",
        from: null,
        to: after.name || after.name_external || "未命名套餐",
      });
      const priceText =
        after.discount_price != null
          ? `折扣价 ${after.discount_price}`
          : `原价 ${after.original_price}`;
      lines.push(
        `新增套餐「${after.name || after.name_external}」（${priceText}，明细 ${after.item_count} 件）`,
      );
      continue;
    }
    matchedBefore.add(key);
    const fieldChanges: string[] = [];
    const compareFields: Array<keyof PackageSnap> = [
      "original_price",
      "discount_price",
      "summary",
      "image_url",
      "is_visible",
      "sort_order",
      "item_count",
      "locale_count",
    ];
    for (const field of compareFields) {
      if (!valuesEqual(before[field], after[field])) {
        diffs.push({
          field: `package.${after.name}.${String(field)}`,
          from: before[field],
          to: after[field],
        });
        const label = PACKAGE_SUB_FIELD_LABELS[String(field)] ?? String(field);
        fieldChanges.push(
          `${label}: ${formatBrief(before[field])} → ${formatBrief(after[field])}`,
        );
      }
    }
    if (!valuesEqual(before.items, after.items)) {
      if (!fieldChanges.some((x) => x.startsWith("明细件数"))) {
        diffs.push({
          field: `package.${after.name}.items`,
          from: before.items,
          to: after.items,
        });
        fieldChanges.push(
          `明细内容: ${before.item_count} 件 → ${after.item_count} 件`,
        );
      }
    }
    if (!valuesEqual(before.locales, after.locales)) {
      diffs.push({
        field: `package.${after.name}.locales`,
        from: before.locales,
        to: after.locales,
      });
      fieldChanges.push(
        `多语言: ${formatLocalesBrief(before.locales)} → ${formatLocalesBrief(after.locales)}`,
      );
    }
    if (fieldChanges.length > 0) {
      lines.push(`修改套餐「${after.name}」(${fieldChanges.join("；")})`);
    }
  }

  for (const [key, before] of beforeMap) {
    if (matchedBefore.has(key) || afterMap.has(key)) continue;
    diffs.push({
      field: "package_removed",
      from: before.name || before.name_external || "未命名套餐",
      to: null,
    });
    lines.push(`删除套餐「${before.name || before.name_external}」`);
  }

  if (lines.length === 0) {
    lines.push("套餐内容已保存（无字段级差异）");
  }

  return { diffs, summary: lines.join("；") };
}

const LOCALE_CONTENT_FIELDS = [
  "label",
  "title_external",
  "facebook_pixel_id",
  "google_conversion_id",
  "google_label",
  "description",
  "description_entries",
  "cover_url",
  "gallery_urls",
  "detail_image_urls",
] as const;

/** 商品语言覆盖快照，用于增删改审计 */
export function localeContentSnapshot(
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const key of LOCALE_CONTENT_FIELDS) {
    out[key] = row[key] ?? null;
  }
  return out;
}

export function buildLocaleAudit(
  locale: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  mode: "create" | "update" | "delete",
): {
  action: "locale_create" | "locale_update" | "locale_delete";
  diffs: AuditFieldDiff[];
  remark: string;
} {
  if (mode === "delete") {
    const beforeSnap = localeContentSnapshot(before);
    const diffs: AuditFieldDiff[] = [
      { field: "removed_locale", from: locale, to: null },
    ];
    for (const [field, from] of Object.entries(beforeSnap)) {
      if (from == null || from === "") continue;
      if (Array.isArray(from) && from.length === 0) continue;
      diffs.push({ field, from, to: null });
    }
    return {
      action: "locale_delete",
      diffs,
      remark: `删除语言「${locale}」`,
    };
  }

  const beforeSnap = localeContentSnapshot(before);
  const afterSnap = localeContentSnapshot(after);
  const diffs = buildFieldDiffs(beforeSnap, afterSnap);
  if (mode === "create") {
    return {
      action: "locale_create",
      diffs: [{ field: "locale", from: null, to: locale }, ...diffs],
      remark:
        diffs.length > 0
          ? `新增语言「${locale}」；${summarizeFieldDiffs(diffs)}`
          : `新增语言「${locale}」`,
    };
  }
  return {
    action: "locale_update",
    diffs: diffs.length > 0 ? diffs : [{ field: "locale", from: locale, to: locale }],
    remark:
      diffs.length > 0
        ? `更新语言「${locale}」；${summarizeFieldDiffs(diffs)}`
        : `更新语言「${locale}」（无字段差异）`,
  };
}
