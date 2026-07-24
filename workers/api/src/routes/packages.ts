import { Hono } from "hono";
import type { UpsertProductPackageInput } from "@shopad/shared";
import { writeAuditLog } from "../lib/audit";
import { assertProductAccess } from "../lib/access";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

export const packagesRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

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

  return c.json({
    data: (packages ?? []).map((pkg) => ({
      ...pkg,
      items: itemsByPackage.get(pkg.id) ?? [],
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
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (productError) return c.json({ error: productError.message }, 500);
  if (!product) return c.json({ error: "商品不存在" }, 404);

  // Replace-all strategy for simplicity (matches admin form save)
  const { error: deleteError } = await supabase
    .from("product_packages")
    .delete()
    .eq("product_id", productId);
  if (deleteError) return c.json({ error: deleteError.message }, 500);

  if (list.length === 0) {
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

  // Return refreshed list
  const refreshed = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  if (refreshed.error) return c.json({ error: refreshed.error.message }, 500);

  await supabase
    .from("products")
    .update({ updated_by: actor.id })
    .eq("id", productId);

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: productId,
    action: "packages_update",
    actor,
    toValue: String(list.length),
    changes: { package_count: list.length },
  });

  return c.json({ data: refreshed.data ?? [] });
});
