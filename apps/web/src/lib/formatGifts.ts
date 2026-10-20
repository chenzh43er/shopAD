import type { OrderGiftSnapshot } from "@shopad/shared";

/** 赠品展示项：label 为中文属性（SKU）优先，回退赠品名 */
export type GiftDisplayItem = {
  label: string;
  /** 赠品名（快照中的内部名） */
  name: string | null;
  /** 订单总件数 = 赠品数量 × 赠品套餐内件数（不乘购买数量） */
  quantity: number;
};

/** 解析订单赠品快照（兼容 jsonb 数组 / JSON 字符串） */
export function parseGiftSnapshot(raw: unknown): OrderGiftSnapshot[] {
  let items: unknown = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      items = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(items)) return [];
  const list: OrderGiftSnapshot[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<OrderGiftSnapshot>;
    const sku = typeof row.sku_code === "string" ? row.sku_code.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!sku && !name) continue;
    const quantity = Number(row.quantity);
    const packageName =
      typeof row.package_name === "string" ? row.package_name.trim() : "";
    const rawPkgCount = Number(row.package_count);
    const packageCount =
      Number.isFinite(rawPkgCount) && rawPkgCount > 0
        ? Math.floor(rawPkgCount)
        : 1;
    list.push({
      sku_code: sku || null,
      name: name || null,
      package_name: packageName || null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
      package_count: packageCount,
    });
  }
  return list;
}

/**
 * 赠品展示项：按中文属性合并数量，并按赠品自身套餐内件数换算总件数。
 * 与导出口径一致：件数 = 赠品数量 × 赠品自身套餐内件数（不乘购买数量）。
 */
export function buildGiftDisplayItems(raw: unknown): GiftDisplayItem[] {
  const merged = new Map<string, GiftDisplayItem>();
  for (const gift of parseGiftSnapshot(raw)) {
    const label = gift.sku_code || gift.name || "";
    if (!label) continue;
    const units =
      Number.isFinite(Number(gift.package_count)) &&
      Number(gift.package_count) > 0
        ? Math.floor(Number(gift.package_count))
        : 1;
    const units2 = gift.quantity * units;
    const exist = merged.get(label);
    if (exist) {
      exist.quantity += units2;
    } else {
      merged.set(label, {
        label,
        name: gift.name,
        quantity: units2,
      });
    }
  }
  return [...merged.values()];
}

/** 赠品摘要文案，如「SKU-A*2，SKU-B*1」 */
export function formatGiftSummary(raw: unknown): string {
  return buildGiftDisplayItems(raw)
    .map((item) => `${item.label}*${item.quantity}`)
    .join("，");
}
