import type { createServiceClient } from "./supabase";

const BUCKET = "product-locales";
/** 与 product-1 storefront-regions cacheKey v3 对齐 */
export const REGION_TREE_SNAPSHOT_FILE = "tree-fees-v3.json";

type Supabase = ReturnType<typeof createServiceClient>;

type FlatRegionRow = {
  id: string;
  parent_id: string | null;
  name: string;
  level: number;
  actual_shipping_fee?: number | string | null;
  sort_order?: number | null;
};

export type CompactRegionCity = [
  name: string,
  districts: string[],
  fees?: Array<number | null>,
];
export type CompactRegionTree = Array<[string, CompactRegionCity[]]>;

export type RegionTreeSnapshot = {
  v: 3;
  libraryId: string;
  updatedAt: string;
  tree: CompactRegionTree;
};

function snapshotPath(libraryId: string) {
  return `addresses/${libraryId}/${REGION_TREE_SNAPSHOT_FILE}`;
}

function parseTreeFee(
  raw: number | string | null | undefined,
): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 压缩成店面省市区树（可嵌运费） */
export function buildCompactRegionTree(
  rows: FlatRegionRow[],
): CompactRegionTree {
  const districtsByCity = new Map<
    string,
    Array<{ name: string; fee: number | null }>
  >();
  const citiesByProvince = new Map<string, CompactRegionCity[]>();
  const provinceOrder: Array<{ id: string; name: string }> = [];

  for (const row of rows) {
    if (row.level === 1 && row.parent_id == null) {
      provinceOrder.push({ id: row.id, name: row.name });
    } else if (row.level === 3 && row.parent_id) {
      const entry = {
        name: row.name,
        fee: parseTreeFee(row.actual_shipping_fee),
      };
      const list = districtsByCity.get(row.parent_id);
      if (list) list.push(entry);
      else districtsByCity.set(row.parent_id, [entry]);
    }
  }

  for (const row of rows) {
    if (row.level === 2 && row.parent_id) {
      const entries = districtsByCity.get(row.id) ?? [];
      const names = entries.map((e) => e.name);
      const fees = entries.map((e) => e.fee);
      const hasFee = fees.some((f) => f != null);
      const city: CompactRegionCity = hasFee
        ? [row.name, names, fees]
        : [row.name, names];
      const list = citiesByProvince.get(row.parent_id);
      if (list) list.push(city);
      else citiesByProvince.set(row.parent_id, [city]);
    }
  }

  return provinceOrder.map((p) => [
    p.name,
    citiesByProvince.get(p.id) ?? [],
  ]);
}

async function fetchFlatRows(
  supabase: Supabase,
  libraryId: string,
): Promise<FlatRegionRow[]> {
  const pageSize = 1000;
  const rows: FlatRegionRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("address_regions")
      .select("id, parent_id, name, level, actual_shipping_fee, sort_order")
      .eq("library_id", libraryId)
      .gte("level", 1)
      .lte("level", 3)
      .order("level", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as FlatRegionRow[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

/** 从 DB 构建并上传公开快照，店面优先读 CDN 而不是扫 5k+ 行 */
export async function publishAddressRegionTreeSnapshot(
  supabase: Supabase,
  libraryId: string,
): Promise<RegionTreeSnapshot> {
  const rows = await fetchFlatRows(supabase, libraryId);
  const tree = buildCompactRegionTree(rows);
  const snapshot: RegionTreeSnapshot = {
    v: 3,
    libraryId,
    updatedAt: new Date().toISOString(),
    tree,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(snapshotPath(libraryId), bytes, {
      contentType: "application/json",
      upsert: true,
      cacheControl: "3600",
    });
  if (error) throw new Error(error.message);
  return snapshot;
}

export async function deleteAddressRegionTreeSnapshot(
  supabase: Supabase,
  libraryId: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([snapshotPath(libraryId)]);
  if (error && !/not found|404/i.test(error.message)) {
    throw new Error(error.message);
  }
}
