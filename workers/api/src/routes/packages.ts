import { Hono } from "hono";
import type { UpsertProductPackageInput } from "@shopad/shared";
import { MAX_PACKAGE_SKUS } from "@shopad/shared";
import { writeAuditLog } from "../lib/audit";
import {
  buildPackageUpdateDiffs,
  packageSnapshot,
} from "../lib/auditDiff";
import { assertProductAccess } from "../lib/access";
import {
  listPackageLocalesByPackageIds,
  saveAllPackageLocales,
} from "../lib/productLocales";
import {
  hostFromProductDomain,
  scheduleStorefrontRevalidate,
} from "../lib/storefrontRevalidate";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

export const packagesRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

type NormalizedPackageSku = {
  sku_display: string;
  sku_code: string;
  image_url: string | null;
  sort_order: number;
};

/** 解析套餐独立属性入参；未传或 null 视为空数组 */
function normalizePackageSkus(
  value: unknown,
): { ok: true; rows: NormalizedPackageSku[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, rows: [] };
  if (!Array.isArray(value)) return { ok: false, error: "独立属性格式无效" };
  const rows: NormalizedPackageSku[] = [];
  for (const [index, item] of value.entries()) {
    if (item === null || typeof item !== "object") {
      return { ok: false, error: `第 ${index + 1} 个独立属性格式无效` };
    }
    const raw = item as Record<string, unknown>;
    const skuDisplay =
      typeof raw.sku_display === "string" ? raw.sku_display.trim() : "";
    const skuCode =
      typeof raw.sku_code === "string" ? raw.sku_code.trim() : "";
    const imageUrl =
      typeof raw.image_url === "string" ? raw.image_url.trim() : "";
    if (!skuDisplay && !skuCode && !imageUrl) continue;
    if (!skuDisplay || !skuCode) {
      return {
        ok: false,
        error: `第 ${index + 1} 个独立属性：前端SKU名称与后端SKU均必填`,
      };
    }
    if (skuDisplay.length > 120 || skuCode.length > 120) {
      return { ok: false, error: `第 ${index + 1} 个独立属性：SKU 内容过长` };
    }
    rows.push({
      sku_display: skuDisplay,
      sku_code: skuCode,
      image_url: imageUrl || null,
      sort_order: rows.length,
    });
  }
  if (rows.length > MAX_PACKAGE_SKUS) {
    return { ok: false, error: `独立属性最多 ${MAX_PACKAGE_SKUS} 个` };
  }
  return { ok: true, rows };
}

/** 同一套餐内：前端SKU名称与后端SKU不能重复 */
function findPackageSkuValueConflict(
  rows: NormalizedPackageSku[],
): string | null {
  const seen = new Map<string, string>();
  for (const row of rows) {
    for (const [label, value] of [
      ["前端SKU名称", row.sku_display],
      ["后端SKU", row.sku_code],
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

/**
 * 后端SKU 跨商品唯一：同一商品的不同套餐允许重复，
 * 因此这里排除当前商品的套餐属性，只校验其他商品（含其他商品的单一SKU）。
 */
async function findSkuCodeConflict(
  supabase: ReturnType<typeof createServiceClient>,
  rows: NormalizedPackageSku[],
  excludeProductId: string | null,
): Promise<string | null> {
  const checked = new Set<string>();
  for (const row of rows) {
    const key = row.sku_code.toLowerCase();
    if (checked.has(key)) continue;
    checked.add(key);
    const { data, error } = await supabase.rpc("product_sku_code_taken", {
      p_code: row.sku_code,
      p_exclude_product_id: excludeProductId,
    });
    if (error) {
      if (
        /could not find the function|schema cache|does not exist/i.test(
          error.message,
        )
      ) {
        return "套餐独立属性数据表尚未迁移，请先应用 product_package_skus 迁移";
      }
      return error.message;
    }
    if (data === true) {
      return `后端SKU「${row.sku_code}」已被其他商品使用，后端SKU不能跨商品重复`;
    }
  }
  return null;
}

async function listPackageSkus(
  supabase: ReturnType<typeof createServiceClient>,
  packageIds: string[],
): Promise<Map<string, unknown[]>> {
  const map = new Map<string, unknown[]>();
  if (packageIds.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from("product_package_skus")
      .select("*")
      .in("package_id", packageIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      if (!/schema cache|could not find the table|does not exist/i.test(error.message)) {
        throw new Error(error.message);
      }
      return map;
    }
    for (const row of data ?? []) {
      const list = map.get(row.package_id as string) ?? [];
      list.push(row);
      map.set(row.package_id as string, list);
    }
  } catch (e) {
    console.warn(
      "package skus read failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return map;
}

packagesRoutes.get("/:productId/packages", async (c) => {
  const productId = c.req.param("productId");
  const supabase = createServiceClient(c.env);

  try {
    const access = await assertProductAccess(supabase, productId, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const { data: packages, error } = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return c.json({ error: error.message }, 500);

  const packageIds = (packages ?? []).map((p) => p.id);
  if (packageIds.length === 0) {
    return c.json({ data: [] });
  }

  const { data: items, error: itemsError } = await supabase
    .from("product_package_items")
    .select("*")
    .in("package_id", packageIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsError) return c.json({ error: itemsError.message }, 500);

  const refIds = [
    ...new Set(
      (items ?? [])
        .map((i) => i.ref_product_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const refMap = new Map<
    string,
    { id: string; name: string; cover_url: string | null }
  >();
  if (refIds.length > 0) {
    const { data: refs, error: refsError } = await supabase
      .from("products")
      .select("id, name, cover_url")
      .in("id", refIds);
    if (refsError) return c.json({ error: refsError.message }, 500);
    for (const p of refs ?? []) {
      refMap.set(p.id, p);
    }
  }

  const itemsByPackage = new Map<string, unknown[]>();
  for (const item of items ?? []) {
    const list = itemsByPackage.get(item.package_id) ?? [];
    list.push({
      ...item,
      ref_product: item.ref_product_id
        ? (refMap.get(item.ref_product_id) ?? null)
        : null,
    });
    itemsByPackage.set(item.package_id, list);
  }

  let localesByPackage = new Map<string, Record<string, unknown>[]>();
  try {
    localesByPackage = await listPackageLocalesByPackageIds(
      supabase,
      packageIds,
      productId,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("package locales read failed:", msg);
    localesByPackage = new Map();
  }

  const skusByPackage = await listPackageSkus(supabase, packageIds);

  return c.json({
    data: (packages ?? []).map((pkg) => ({
      ...pkg,
      items: itemsByPackage.get(pkg.id) ?? [],
      skus: skusByPackage.get(pkg.id) ?? [],
      locales: localesByPackage.get(pkg.id) ?? [],
    })),
  });
});

packagesRoutes.put("/:productId/packages", async (c) => {
  const productId = c.req.param("productId");
  const actor = {
    id: c.get("userId"),
    email: c.get("userEmail"),
    name: c.get("userName"),
  };
  const body = (await c.req.json()) as {
    packages?: UpsertProductPackageInput[];
  };
  const list = body.packages;

  if (!Array.isArray(list)) {
    return c.json({ error: "packages 必须是数组" }, 400);
  }

  for (const [index, pkg] of list.entries()) {
    if (!pkg.name?.trim() || !pkg.name_external?.trim()) {
      return c.json({ error: `第 ${index + 1} 个套餐名称/外文名必填` }, 400);
    }
    if (typeof pkg.original_price !== "number" || pkg.original_price < 0) {
      return c.json({ error: `第 ${index + 1} 个套餐原价无效` }, 400);
    }
    if (
      pkg.discount_price != null &&
      (typeof pkg.discount_price !== "number" || pkg.discount_price < 0)
    ) {
      return c.json({ error: `第 ${index + 1} 个套餐折扣价无效` }, 400);
    }
    if (typeof pkg.sku_title === "string" && pkg.sku_title.length > 120) {
      return c.json({ error: `第 ${index + 1} 个套餐属性标题过长` }, 400);
    }
  }

  const supabase = createServiceClient(c.env);

  try {
    const access = await assertProductAccess(supabase, productId, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select(
      "id, link_suffix, domain:domains!products_domain_id_fkey(host)",
    )
    .eq("id", productId)
    .maybeSingle();
  if (productError) return c.json({ error: productError.message }, 500);
  if (!product) return c.json({ error: "商品不存在" }, 404);

  const normalizedSkusByPackage: NormalizedPackageSku[][] = [];
  for (const [index, pkg] of list.entries()) {
    const packageName = pkg.name?.trim() || `第 ${index + 1} 个套餐`;
    const normalizedSkus = normalizePackageSkus(pkg.skus);
    if (!normalizedSkus.ok) {
      return c.json(
        { error: `套餐「${packageName}」：${normalizedSkus.error}` },
        400,
      );
    }
    // 同一套餐内仍需唯一；不同套餐之间允许重复（同一商品内 SKU 可复用）
    const skuValueConflict = findPackageSkuValueConflict(normalizedSkus.rows);
    if (skuValueConflict) {
      return c.json(
        { error: `套餐「${packageName}」：${skuValueConflict}` },
        400,
      );
    }
    normalizedSkusByPackage.push(normalizedSkus.rows);
  }
  const allSkuRows = normalizedSkusByPackage.flat();
  if (allSkuRows.length > 0) {
    const skuCodeConflict = await findSkuCodeConflict(
      supabase,
      allSkuRows,
      productId,
    );
    if (skuCodeConflict) {
      return c.json({ error: skuCodeConflict }, 400);
    }
  }

  const { data: beforePackages, error: beforePkgError } = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (beforePkgError) return c.json({ error: beforePkgError.message }, 500);

  const beforePackageIds = (beforePackages ?? []).map((p) => p.id as string);
  let beforeLocalesByPackage = new Map<string, Record<string, unknown>[]>();
  try {
    beforeLocalesByPackage = await listPackageLocalesByPackageIds(
      supabase,
      beforePackageIds,
      productId,
    );
  } catch {
    beforeLocalesByPackage = new Map();
  }
  let beforeItems: Array<{
    package_id: string;
    ref_product_id: string | null;
    quantity: number | null;
    independent_attrs: boolean | null;
  }> = [];
  if (beforePackageIds.length > 0) {
    const { data: items, error: beforeItemsError } = await supabase
      .from("product_package_items")
      .select("package_id, ref_product_id, quantity, independent_attrs")
      .in("package_id", beforePackageIds);
    if (beforeItemsError) {
      return c.json({ error: beforeItemsError.message }, 500);
    }
    beforeItems = (items ?? []) as typeof beforeItems;
  }
  const beforeItemsByPackage = new Map<string, typeof beforeItems>();
  for (const item of beforeItems) {
    const rows = beforeItemsByPackage.get(item.package_id) ?? [];
    rows.push(item);
    beforeItemsByPackage.set(item.package_id, rows);
  }
  const beforeSkusByPackage = await listPackageSkus(supabase, beforePackageIds);
  const beforeSnapshots = (beforePackages ?? []).map((pkg) => {
    const localeRows = beforeLocalesByPackage.get(pkg.id as string) ?? [];
    const locales: Record<
      string,
      { name: string; name_external: string; image_url: string | null }
    > = {};
    for (const row of localeRows) {
      const code = String(row.locale ?? "");
      if (!code) continue;
      locales[code] = {
        name: String(row.name ?? ""),
        name_external: String(row.name_external ?? ""),
        image_url: (row.image_url as string | null) ?? null,
      };
    }
    return packageSnapshot({
      ...pkg,
      locales,
      items: beforeItemsByPackage.get(pkg.id as string) ?? [],
      skus: beforeSkusByPackage.get(pkg.id as string) ?? [],
    });
  });

  // Replace-all strategy for simplicity (matches admin form save)
  const { error: deleteError } = await supabase
    .from("product_packages")
    .delete()
    .eq("product_id", productId);
  if (deleteError) return c.json({ error: deleteError.message }, 500);

  if (list.length === 0) {
    const emptyDiff = buildPackageUpdateDiffs(beforeSnapshots, []);
    await writeAuditLog(supabase, {
      entityType: "product",
      entityId: productId,
      action: "packages_update",
      actor,
      fromValue: String(beforeSnapshots.length),
      toValue: "0",
      changes: { fields: emptyDiff.diffs },
      remark: emptyDiff.summary,
    });
    scheduleStorefrontRevalidate(c, {
      linkSuffixes: [product.link_suffix as string | null],
      hosts: [hostFromProductDomain(product.domain)],
    });
    return c.json({ data: [] });
  }

  const packageRows = list.map((pkg, index) => ({
    product_id: productId,
    name: pkg.name.trim(),
    name_external: pkg.name_external.trim(),
    original_price: pkg.original_price,
    discount_price: pkg.discount_price ?? null,
    summary: pkg.summary?.trim() || null,
    image_url: pkg.image_url || null,
    sku_title: pkg.sku_title?.trim() || null,
    is_visible: pkg.is_visible ?? true,
    sort_order: pkg.sort_order ?? index,
  }));

  const { data: insertedPackages, error: insertPkgError } = await supabase
    .from("product_packages")
    .insert(packageRows)
    .select("*");

  if (insertPkgError) return c.json({ error: insertPkgError.message }, 500);

  const bySort = new Map(
    (insertedPackages ?? []).map((p) => [p.sort_order as number, p]),
  );

  const itemRows: Array<{
    package_id: string;
    ref_product_id: string;
    quantity: number;
    independent_attrs: boolean;
    sort_order: number;
  }> = [];

  for (let i = 0; i < list.length; i++) {
    const pkg = list[i]!;
    const inserted = bySort.get(pkg.sort_order ?? i);
    if (!inserted) continue;
    const items = pkg.items ?? [];
    for (let j = 0; j < items.length; j++) {
      const item = items[j]!;
      if (!item.ref_product_id) {
        return c.json({ error: `套餐「${pkg.name}」明细商品必选` }, 400);
      }
      if (typeof item.quantity !== "number" || item.quantity <= 0) {
        return c.json({ error: `套餐「${pkg.name}」数量无效` }, 400);
      }
      itemRows.push({
        package_id: inserted.id,
        ref_product_id: item.ref_product_id,
        quantity: item.quantity,
        independent_attrs: item.independent_attrs ?? false,
        sort_order: item.sort_order ?? j,
      });
    }
  }

  if (itemRows.length > 0) {
    const { error: insertItemsError } = await supabase
      .from("product_package_items")
      .insert(itemRows);
    if (insertItemsError) {
      return c.json({ error: insertItemsError.message }, 500);
    }
  }

  // 写入套餐独立属性（随套餐保存）
  const skuRows: Array<{
    package_id: string;
    sku_display: string;
    sku_code: string;
    image_url: string | null;
    sort_order: number;
  }> = [];
  for (let i = 0; i < list.length; i++) {
    const inserted = bySort.get(list[i]!.sort_order ?? i);
    if (!inserted) continue;
    for (const row of normalizedSkusByPackage[i] ?? []) {
      skuRows.push({ package_id: inserted.id as string, ...row });
    }
  }
  if (skuRows.length > 0) {
    const { error: insertSkusError } = await supabase
      .from("product_package_skus")
      .insert(skuRows);
    if (insertSkusError) {
      const msg = insertSkusError.message;
      if (/SKU_CODE_USED_BY_OTHER_PRODUCT/.test(msg)) {
        return c.json(
          { error: "后端SKU已被其他商品使用：后端SKU不能跨商品重复" },
          400,
        );
      }
      if (
        /product_package_skus_package_code_uidx|product_package_skus_code_uidx/.test(
          msg,
        )
      ) {
        return c.json({ error: "后端SKU重复：同一套餐内不能重复" }, 400);
      }
      if (/product_package_skus_package_display_uidx/.test(msg)) {
        return c.json({ error: "前端SKU名称重复：同一套餐内不能重复" }, 400);
      }
      if (/duplicate key/i.test(msg)) {
        return c.json(
          { error: "独立属性重复：同一套餐内前端SKU名称与后端SKU均不能重复" },
          400,
        );
      }
      return c.json({ error: msg }, 500);
    }
  }

  // 按新 package id 写入语言覆盖（Storage）
  type LocaleSkuValue = {
    sku_display?: string;
    image_url?: string;
  };
  const localeMap: Record<
    string,
    Record<
      string,
      {
        name: string;
        name_external: string;
        image_url?: string | null;
        skus?: Record<string, LocaleSkuValue>;
      }
    >
  > = {};
  for (let i = 0; i < list.length; i++) {
    const pkg = list[i]!;
    const inserted = bySort.get(pkg.sort_order ?? i);
    if (!inserted || !pkg.locales) continue;
    const skuCodes = new Set(
      (normalizedSkusByPackage[i] ?? []).map((row) => row.sku_code.trim()),
    );
    const next: Record<
      string,
      {
        name: string;
        name_external: string;
        image_url?: string | null;
        skus?: Record<string, LocaleSkuValue>;
      }
    > = {};
    for (const [locale, value] of Object.entries(pkg.locales)) {
      const skus: Record<string, LocaleSkuValue> = {};
      for (const [codeRaw, skuValue] of Object.entries(value?.skus ?? {})) {
        const code = codeRaw.trim();
        if (!code || !skuCodes.has(code)) continue;
        const skuDisplay = skuValue?.sku_display?.trim() || "";
        const skuImage = skuValue?.image_url?.trim() || "";
        if (!skuDisplay && !skuImage) continue;
        skus[code] = {
          ...(skuDisplay ? { sku_display: skuDisplay } : {}),
          ...(skuImage ? { image_url: skuImage } : {}),
        };
      }
      next[locale] = {
        name: value?.name?.trim() || "",
        name_external: value?.name_external?.trim() || "",
        image_url: value?.image_url?.trim() || null,
        ...(Object.keys(skus).length > 0 ? { skus } : {}),
      };
    }
    localeMap[inserted.id] = next;
  }
  try {
    await saveAllPackageLocales(supabase, productId, localeMap);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "保存套餐语言失败" },
      500,
    );
  }

  // Return refreshed list
  const refreshed = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  if (refreshed.error) return c.json({ error: refreshed.error.message }, 500);

  const refreshedIds = (refreshed.data ?? []).map((p) => p.id as string);
  const refreshedSkusByPackage = await listPackageSkus(supabase, refreshedIds);
  let localesByPackage = new Map<string, Record<string, unknown>[]>();
  try {
    localesByPackage = await listPackageLocalesByPackageIds(
      supabase,
      refreshedIds,
      productId,
    );
  } catch (e) {
    console.warn(
      "package locales read failed:",
      e instanceof Error ? e.message : e,
    );
    localesByPackage = new Map();
  }

  await supabase
    .from("products")
    .update({ updated_by: actor.id })
    .eq("id", productId);

  const afterSnapshots = list.map((pkg, index) =>
    packageSnapshot({
      name: pkg.name,
      name_external: pkg.name_external,
      original_price: pkg.original_price,
      discount_price: pkg.discount_price,
      summary: pkg.summary,
      image_url: pkg.image_url,
      sku_title: pkg.sku_title,
      is_visible: pkg.is_visible,
      sort_order: pkg.sort_order ?? index,
      locales: pkg.locales ?? {},
      items: pkg.items ?? [],
      skus: normalizedSkusByPackage[index] ?? [],
    }),
  );
  const packageDiff = buildPackageUpdateDiffs(beforeSnapshots, afterSnapshots);

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: productId,
    action: "packages_update",
    actor,
    fromValue: String(beforeSnapshots.length),
    toValue: String(list.length),
    changes: { fields: packageDiff.diffs },
    remark: packageDiff.summary,
  });

  scheduleStorefrontRevalidate(c, {
    linkSuffixes: [product.link_suffix as string | null],
    hosts: [hostFromProductDomain(product.domain)],
  });

  return c.json({
    data: (refreshed.data ?? []).map((pkg) => ({
      ...pkg,
      skus: refreshedSkusByPackage.get(pkg.id as string) ?? [],
      locales: localesByPackage.get(pkg.id as string) ?? [],
    })),
  });
});
