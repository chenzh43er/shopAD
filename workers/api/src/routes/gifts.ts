import { Hono } from "hono";
import type {
  UpsertProductGiftInput,
  UpsertProductGiftsBody,
} from "@shopad/shared";
import { writeAuditLog } from "../lib/audit";
import {
  buildGiftUpdateDiffs,
  giftSnapshot,
  type GiftSnapshot,
} from "../lib/auditDiff";
import {
  assertProductAccess,
  listAccessibleProductIds,
} from "../lib/access";
import {
  listGiftLocalesByGiftIds,
  loadGiftSectionTitles,
  loadProductTitleExternalLocales,
  saveAllGiftLocales,
} from "../lib/productLocales";
import {
  hostFromProductDomain,
  scheduleStorefrontRevalidate,
} from "../lib/storefrontRevalidate";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

export const giftsRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

/** 赠品可选套餐（仅展示所需字段） */
type LookupPackage = {
  id: string;
  name: string;
  name_external: string;
  is_visible: boolean;
};

/** 赠品候选：商品内部名称 + 封面 + 链接后缀（供后台自动补全选择） */
type GiftCandidate = {
  id: string;
  name: string;
  title_external: string | null;
  cover_url: string | null;
  sku_code: string | null;
  link_suffix: string | null;
  status: string;
  packages_enabled: boolean;
};

const GIFT_CANDIDATE_SELECT =
  "id, name, title_external, cover_url, sku_code, link_suffix, status, packages_enabled";

/** 一次取回多个赠品商品的套餐，按 product_id 分组 */
async function loadGiftCandidatePackages(
  supabase: ReturnType<typeof createServiceClient>,
  productIds: string[],
): Promise<Map<string, LookupPackage[]>> {
  const result = new Map<string, LookupPackage[]>();
  if (productIds.length === 0) return result;
  const { data, error } = await supabase
    .from("product_packages")
    .select("id, product_id, name, name_external, sort_order, is_visible")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });
  if (error) return result;
  for (const pkg of data ?? []) {
    const list = result.get(pkg.product_id as string) ?? [];
    list.push({
      id: pkg.id as string,
      name: pkg.name as string,
      name_external: pkg.name_external as string,
      is_visible: pkg.is_visible ?? true,
    });
    result.set(pkg.product_id as string, list);
  }
  return result;
}

/**
 * 导入赠品用查询：
 * - `link_suffix` 精确匹配（单个结果）
 * - `q` 按商品名称或链接后缀模糊搜索（自动补全，最多 20 条）
 * - `owner_product_id` 传入当前商品时，候选仅限同一地区（ID 商品只能搜 ID，SA 只能搜 SA）
 * 只返回当前登录人有权限操作的商品。
 */
giftsRoutes.get("/lookup", async (c) => {
  const suffix = (c.req.query("link_suffix") ?? "").trim();
  const q = (c.req.query("q") ?? "").trim();
  const ownerProductId = (c.req.query("owner_product_id") ?? "").trim();
  if (!suffix && !q) {
    return c.json({ error: "请填写链接后缀或商品名称" }, 400);
  }

  const supabase = createServiceClient(c.env);

  const accessible = await listAccessibleProductIds(supabase, c);
  if (accessible !== "all" && accessible.length === 0) {
    return c.json({ data: { product: null, packages: [], candidates: [] } });
  }

  // 地区限定：赠品必须与当前商品同地区
  let regionId: string | null = null;
  let regionScoped = false;
  if (ownerProductId) {
    const { data: owner, error: ownerErr } = await supabase
      .from("products")
      .select("id, region_id")
      .eq("id", ownerProductId)
      .maybeSingle();
    if (ownerErr) return c.json({ error: ownerErr.message }, 500);
    if (!owner) return c.json({ error: "当前商品不存在" }, 404);
    regionId = (owner.region_id as string | null) ?? null;
    regionScoped = true;
  }

  const select = `${GIFT_CANDIDATE_SELECT},region_id`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = supabase.from("products").select(select as any);
  if (accessible !== "all") {
    query = query.in("id", accessible);
  }
  if (regionScoped) {
    query = regionId
      ? query.eq("region_id", regionId)
      : query.is("region_id", null);
  }
  if (suffix) {
    query = query.eq("link_suffix", suffix);
  } else {
    const escaped = q.replace(/[%,()]/g, " ");
    query = query
      .or(`name.ilike.%${escaped}%,link_suffix.ilike.%${escaped}%`)
      .order("status", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(20);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const rows = (data ?? []) as unknown as Array<
    GiftCandidate & { region_id?: string }
  >;
  if (suffix && rows.length === 0) {
    return c.json({ error: "未找到该链接后缀对应的商品" }, 404);
  }

  const packagesByProduct = await loadGiftCandidatePackages(
    supabase,
    rows.map((r) => r.id as string),
  );

  const candidates: Array<{
    product: GiftCandidate;
    packages: LookupPackage[];
  }> = rows.map((row) => {
    const product: GiftCandidate = {
      id: row.id,
      name: row.name,
      title_external: row.title_external ?? null,
      cover_url: row.cover_url,
      sku_code: row.sku_code,
      link_suffix: row.link_suffix,
      status: row.status,
      packages_enabled: row.packages_enabled ?? false,
    };
    return { product, packages: packagesByProduct.get(row.id as string) ?? [] };
  });

  if (suffix) {
    const first = candidates[0]!;
    return c.json({ data: { product: first.product, packages: first.packages } });
  }
  return c.json({ data: { product: null, packages: [], candidates } });
});

/** 某商品的赠品列表（含赠品商品与套餐概要） */
giftsRoutes.get("/:productId/gifts", async (c) => {
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

  const { data: productMeta, error: productMetaError } = await supabase
    .from("products")
    .select("id, gifts_title")
    .eq("id", productId)
    .maybeSingle();
  if (productMetaError) {
    // gifts_title 列未迁移时降级：仍返回赠品列表
    console.warn("products.gifts_title read failed:", productMetaError.message);
  }

  const { data: gifts, error } = await supabase
    .from("product_gifts")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message }, 500);

  const giftIds = [...new Set((gifts ?? []).map((g) => g.gift_product_id))].filter(
    (id): id is string => typeof id === "string",
  );
  const packageIds = [
    ...new Set(
      (gifts ?? [])
        .map((g) => g.package_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  const productMap = new Map<string, Record<string, unknown>>();
  if (giftIds.length > 0) {
    const { data: refs, error: refErr } = await supabase
      .from("products")
      .select("id, name, title_external, cover_url, sku_code, link_suffix, packages_enabled")
      .in("id", giftIds);
    if (refErr) return c.json({ error: refErr.message }, 500);
    for (const p of refs ?? []) productMap.set(p.id as string, p);
  }
  // 赠品名称的默认值是该语言版本的商品标题(外部)，供后台按语言展示
  const titleLocales = await loadProductTitleExternalLocales(
    supabase,
    giftIds,
  );
  const withTitleLocales = (product: Record<string, unknown> | null) =>
    product
      ? {
          ...product,
          title_external_locales: titleLocales.get(product.id as string) ?? null,
        }
      : null;

  const packageMap = new Map<string, Record<string, unknown>>();
  if (packageIds.length > 0) {
    const { data: pkgs, error: pkgErr } = await supabase
      .from("product_packages")
      .select("id, name, name_external")
      .in("id", packageIds);
    if (pkgErr) return c.json({ error: pkgErr.message }, 500);
    for (const p of pkgs ?? []) packageMap.set(p.id as string, p);
  }

  const giftRowIds = (gifts ?? []).map((g) => g.id as string);
  let localesByGift = new Map<string, Record<string, unknown>[]>();
  let giftsTitleLocales: Record<string, string> = {};
  try {
    localesByGift = await listGiftLocalesByGiftIds(
      supabase,
      giftRowIds,
      productId,
    );
    giftsTitleLocales = await loadGiftSectionTitles(supabase, productId);
  } catch (e) {
    console.warn(
      "gift locales read failed:",
      e instanceof Error ? e.message : e,
    );
    localesByGift = new Map();
  }

  return c.json({
    gifts_title:
      typeof productMeta?.gifts_title === "string"
        ? productMeta.gifts_title.trim() || null
        : null,
    gifts_title_locales: giftsTitleLocales,
    data: (gifts ?? []).map((gift) => ({
      ...gift,
      locales: localesByGift.get(gift.id as string) ?? [],
      gift_product: withTitleLocales(
        productMap.get(gift.gift_product_id as string) ?? null,
      ),
      package: gift.package_id
        ? (packageMap.get(gift.package_id as string) ?? null)
        : null,
    })),
  });
});

/** 全量替换某商品的赠品（replace-all，与套餐一致） */
giftsRoutes.put("/:productId/gifts", async (c) => {
  const productId = c.req.param("productId");
  const actor = {
    id: c.get("userId"),
    email: c.get("userEmail"),
    name: c.get("userName"),
  };
  const body = (await c.req.json()) as UpsertProductGiftsBody;
  const list = body.gifts;
  if (!Array.isArray(list)) {
    return c.json({ error: "gifts 必须是数组" }, 400);
  }
  if (body.gifts_title != null && typeof body.gifts_title !== "string") {
    return c.json({ error: "赠品总标题无效" }, 400);
  }
  if (
    typeof body.gifts_title === "string" &&
    body.gifts_title.trim().length > 80
  ) {
    return c.json({ error: "赠品总标题不能超过 80 字" }, 400);
  }
  if (
    body.gifts_title_locales != null &&
    typeof body.gifts_title_locales !== "object"
  ) {
    return c.json({ error: "赠品总标题多语言无效" }, 400);
  }
  // 仅显式传入时更新；未传则保留库中 / Storage 原值（避免只改赠品行时清空总标题）
  const updateGiftsTitle = Object.prototype.hasOwnProperty.call(
    body,
    "gifts_title",
  );
  const updateGiftsTitleLocales = Object.prototype.hasOwnProperty.call(
    body,
    "gifts_title_locales",
  );
  const giftsTitle = updateGiftsTitle
    ? (typeof body.gifts_title === "string" ? body.gifts_title : "").trim() ||
      null
    : undefined;
  const giftsTitleLocales: Record<string, string> | undefined =
    updateGiftsTitleLocales ? {} : undefined;
  if (giftsTitleLocales) {
    for (const [locale, title] of Object.entries(
      body.gifts_title_locales ?? {},
    )) {
      if (typeof title !== "string") continue;
      const trimmed = title.trim();
      if (!trimmed) continue;
      if (trimmed.length > 80) {
        return c.json({ error: `赠品总标题（${locale}）不能超过 80 字` }, 400);
      }
      giftsTitleLocales[locale] = trimmed;
    }
  }

  // 同一赠品商品可重复添加；仅「商品 + 套餐 + 数量」组合不允许重复
  const seenCombos = new Set<string>();
  for (const [index, gift] of list.entries()) {
    if (typeof gift.gift_product_id !== "string" || !gift.gift_product_id) {
      return c.json({ error: `第 ${index + 1} 个赠品：请先导入赠品商品` }, 400);
    }
    if (gift.gift_product_id === productId) {
      return c.json({ error: `第 ${index + 1} 个赠品：赠品不能是商品本身` }, 400);
    }
    if (
      typeof gift.quantity !== "number" ||
      !Number.isFinite(gift.quantity) ||
      gift.quantity < 1
    ) {
      return c.json({ error: `第 ${index + 1} 个赠品：数量无效` }, 400);
    }
    const packageId = gift.package_id || null;
    if (gift.gift_name != null && typeof gift.gift_name !== "string") {
      return c.json({ error: `第 ${index + 1} 个赠品：赠品名称无效` }, 400);
    }
    if (
      typeof gift.gift_name === "string" &&
      gift.gift_name.trim().length > 200
    ) {
      return c.json(
        { error: `第 ${index + 1} 个赠品：赠品名称不能超过 200 字` },
        400,
      );
    }
    if (gift.locales != null && typeof gift.locales !== "object") {
      return c.json({ error: `第 ${index + 1} 个赠品：多语言名称无效` }, 400);
    }
    if (gift.locales) {
      for (const [locale, value] of Object.entries(gift.locales)) {
        const name =
          typeof value?.gift_name === "string" ? value.gift_name.trim() : "";
        if (name.length > 200) {
          return c.json(
            {
              error: `第 ${index + 1} 个赠品：${locale} 赠品名称不能超过 200 字`,
            },
            400,
          );
        }
      }
    }
    const combo = `${gift.gift_product_id}|${packageId ?? ""}|${Math.floor(
      gift.quantity,
    )}`;
    if (seenCombos.has(combo)) {
      return c.json(
        { error: `第 ${index + 1} 个赠品：商品 + 套餐 + 数量组合重复` },
        400,
      );
    }
    seenCombos.add(combo);
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
      "id, link_suffix, region_id, domain:domains!products_domain_id_fkey(host)",
    )
    .eq("id", productId)
    .maybeSingle();
  if (productError) return c.json({ error: productError.message }, 500);
  if (!product) return c.json({ error: "商品不存在" }, 404);

  // gift_name 为新增列，数据库未迁移时回退到不带该列的查询
  let before: Record<string, unknown>[] | null = null;
  let beforeError: { message: string } | null = null;
  {
    const res = await supabase
      .from("product_gifts")
      .select("gift_product_id, package_id, quantity, gift_name")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true });
    if (res.error) {
      const fallback = await supabase
        .from("product_gifts")
        .select("gift_product_id, package_id, quantity")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true });
      if (fallback.error) {
        beforeError = fallback.error;
      } else {
        before = fallback.data as Record<string, unknown>[];
      }
    } else {
      before = res.data as Record<string, unknown>[];
    }
  }
  if (beforeError) return c.json({ error: beforeError.message }, 500);

  // 读取赠品商品 / 套餐名称，用于生成可读的审计日志
  const allGiftProductIds = [
    ...new Set(
      [...(before ?? []), ...list].map((g) => g.gift_product_id as string),
    ),
  ];
  const allPackageIds = [
    ...new Set(
      [...(before ?? []), ...list]
        .map((g) => g.package_id as string | null)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const giftNameMap = new Map<string, string>();
  if (allGiftProductIds.length > 0) {
    const { data: giftProducts, error: giftProductErr } = await supabase
      .from("products")
      .select("id, name")
      .in("id", allGiftProductIds);
    if (giftProductErr) return c.json({ error: giftProductErr.message }, 500);
    for (const p of giftProducts ?? []) {
      giftNameMap.set(p.id as string, (p.name as string) ?? "");
    }
  }
  const giftPackageNameMap = new Map<string, string>();
  if (allPackageIds.length > 0) {
    const { data: giftPkgs, error: giftPkgErr } = await supabase
      .from("product_packages")
      .select("id, name")
      .in("id", allPackageIds);
    if (giftPkgErr) return c.json({ error: giftPkgErr.message }, 500);
    for (const p of giftPkgs ?? []) {
      giftPackageNameMap.set(p.id as string, (p.name as string) ?? "");
    }
  }

  const toSnapshot = (row: {
    gift_product_id?: string | null;
    package_id?: string | null;
    quantity?: number | null;
    gift_name?: string | null;
  }): GiftSnapshot =>
    giftSnapshot({
      gift_product_id: row.gift_product_id,
      gift_product_name: giftNameMap.get(row.gift_product_id as string),
      gift_name: row.gift_name ?? null,
      package_id: row.package_id ?? null,
      package_name: row.package_id
        ? giftPackageNameMap.get(row.package_id as string)
        : null,
      quantity: row.quantity,
    });

  const beforeSnapshots = (before ?? []).map(toSnapshot);
  const afterSnapshots = list.map(toSnapshot);

  // 校验赠品商品与套餐归属
  if (list.length > 0) {
    const refIds = [...new Set(list.map((g) => g.gift_product_id))];
    const { data: refs, error: refsError } = await supabase
      .from("products")
      .select("id, region_id")
      .in("id", refIds);
    if (refsError) return c.json({ error: refsError.message }, 500);
    const refMap = new Map(
      (refs ?? []).map((r) => [r.id as string, (r.region_id as string | null) ?? null]),
    );
    const missing = refIds.filter((id) => !refMap.has(id));
    if (missing.length > 0) {
      return c.json({ error: "赠品商品不存在，请重新导入" }, 400);
    }
    // 赠品必须与主商品同地区（ID 商品只能配 ID 赠品，SA 只能配 SA 赠品）
    const ownerRegionId = (product.region_id as string | null) ?? null;
    const crossRegion = refIds.filter(
      (id) => (refMap.get(id) ?? null) !== ownerRegionId,
    );
    if (crossRegion.length > 0) {
      return c.json(
        { error: "赠品必须与当前商品属于同一地区" },
        400,
      );
    }

    const pkgIds = [
      ...new Set(
        list
          .map((g) => g.package_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (pkgIds.length > 0) {
      const { data: pkgs, error: pkgErr } = await supabase
        .from("product_packages")
        .select("id, product_id")
        .in("id", pkgIds);
      if (pkgErr) return c.json({ error: pkgErr.message }, 500);
      const pkgOwner = new Map(
        (pkgs ?? []).map((p) => [p.id as string, p.product_id as string]),
      );
      for (const gift of list) {
        const pkgId = gift.package_id ?? null;
        if (!pkgId) continue;
        const owner = pkgOwner.get(pkgId);
        if (!owner) {
          return c.json({ error: "赠品套餐不存在，请重新选择" }, 400);
        }
        if (owner !== gift.gift_product_id) {
          return c.json({ error: "赠品套餐不属于该赠品商品" }, 400);
        }
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("product_gifts")
    .delete()
    .eq("product_id", productId);
  if (deleteError) return c.json({ error: deleteError.message }, 500);

  if (list.length > 0) {
    const rows = list.map((gift, index) => {
      const row: Record<string, unknown> = {
        product_id: productId,
        gift_product_id: gift.gift_product_id,
        package_id: gift.package_id || null,
        quantity: Math.floor(gift.quantity),
        sort_order: gift.sort_order ?? index,
      };
      const customName = (gift.gift_name ?? "").trim();
      if (customName) row.gift_name = customName;
      return row;
    });
    const { error: insertError } = await supabase
      .from("product_gifts")
      .insert(rows);
    if (insertError) return c.json({ error: insertError.message }, 500);
  }

  // 按新 gift id（sort_order）写入语言覆盖
  const { data: insertedGifts, error: insertedErr } = await supabase
    .from("product_gifts")
    .select("id, sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (insertedErr) return c.json({ error: insertedErr.message }, 500);

  const bySort = new Map(
    (insertedGifts ?? []).map((g) => [g.sort_order as number, g]),
  );
  const localeMap: Record<string, Record<string, { gift_name: string }>> = {};
  for (let i = 0; i < list.length; i++) {
    const gift = list[i]!;
    const inserted = bySort.get(gift.sort_order ?? i);
    if (!inserted || !gift.locales) continue;
    const next: Record<string, { gift_name: string }> = {};
    for (const [locale, value] of Object.entries(gift.locales)) {
      const name =
        typeof value?.gift_name === "string" ? value.gift_name.trim() : "";
      if (!name) continue;
      next[locale] = { gift_name: name };
    }
    if (Object.keys(next).length > 0) {
      localeMap[inserted.id as string] = next;
    }
  }
  try {
    await saveAllGiftLocales(
      supabase,
      productId,
      localeMap,
      giftsTitleLocales,
    );
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "保存赠品语言失败" },
      500,
    );
  }

  const productPatch: Record<string, unknown> = {
    updated_by: actor.id,
  };
  if (giftsTitle !== undefined) {
    productPatch.gifts_title = giftsTitle;
  }
  {
    const { error: titleErr } = await supabase
      .from("products")
      .update(productPatch)
      .eq("id", productId);
    if (titleErr) {
      // 列未迁移时仍保存赠品行与语言文件，仅跳过总标题列
      if (/gifts_title/i.test(titleErr.message)) {
        console.warn("products.gifts_title update skipped:", titleErr.message);
        await supabase
          .from("products")
          .update({ updated_by: actor.id })
          .eq("id", productId);
      } else {
        return c.json({ error: titleErr.message }, 500);
      }
    }
  }

  const giftDiff = buildGiftUpdateDiffs(beforeSnapshots, afterSnapshots);
  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: productId,
    action: "gifts_update",
    actor,
    fromValue: String(beforeSnapshots.length),
    toValue: String(afterSnapshots.length),
    changes: { fields: giftDiff.diffs },
    remark: giftDiff.summary,
  });

  scheduleStorefrontRevalidate(c, {
    linkSuffixes: [product.link_suffix as string | null],
    hosts: [hostFromProductDomain(product.domain)],
  });

  const { data: saved, error: readError } = await supabase
    .from("product_gifts")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (readError) return c.json({ error: readError.message }, 500);

  const refIds = [
    ...new Set((saved ?? []).map((g) => g.gift_product_id as string)),
  ];
  const refMap = new Map<string, Record<string, unknown>>();
  if (refIds.length > 0) {
    const { data: refs } = await supabase
      .from("products")
      .select("id, name, title_external, cover_url, sku_code, link_suffix, packages_enabled")
      .in("id", refIds);
    for (const p of refs ?? []) refMap.set(p.id as string, p);
  }
  const titleLocalesByRef = await loadProductTitleExternalLocales(
    supabase,
    refIds,
  );
  const withRefTitleLocales = (product: Record<string, unknown> | null) =>
    product
      ? {
          ...product,
          title_external_locales:
            titleLocalesByRef.get(product.id as string) ?? null,
        }
      : null;
  const pkgIds = [
    ...new Set(
      (saved ?? [])
        .map((g) => g.package_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const pkgMap = new Map<string, Record<string, unknown>>();
  if (pkgIds.length > 0) {
    const { data: pkgs } = await supabase
      .from("product_packages")
      .select("id, name, name_external")
      .in("id", pkgIds);
    for (const p of pkgs ?? []) pkgMap.set(p.id as string, p);
  }

  const savedIds = (saved ?? []).map((g) => g.id as string);
  let localesByGift = new Map<string, Record<string, unknown>[]>();
  try {
    localesByGift = await listGiftLocalesByGiftIds(
      supabase,
      savedIds,
      productId,
    );
  } catch (e) {
    console.warn(
      "gift locales read failed:",
      e instanceof Error ? e.message : e,
    );
    localesByGift = new Map();
  }

  let savedTitleLocales: Record<string, string> = {};
  try {
    savedTitleLocales = await loadGiftSectionTitles(supabase, productId);
  } catch {
    savedTitleLocales = {};
  }

  let savedGiftsTitle: string | null =
    giftsTitle !== undefined ? giftsTitle : null;
  if (giftsTitle === undefined) {
    const { data: titleRow } = await supabase
      .from("products")
      .select("gifts_title")
      .eq("id", productId)
      .maybeSingle();
    savedGiftsTitle =
      typeof titleRow?.gifts_title === "string"
        ? titleRow.gifts_title.trim() || null
        : null;
  }

  return c.json({
    gifts_title: savedGiftsTitle,
    gifts_title_locales: savedTitleLocales,
    data: (saved ?? []).map((gift) => ({
      ...gift,
      locales: localesByGift.get(gift.id as string) ?? [],
      gift_product: withRefTitleLocales(
        refMap.get(gift.gift_product_id as string) ?? null,
      ),
      package: gift.package_id
        ? (pkgMap.get(gift.package_id as string) ?? null)
        : null,
    })),
  });
});
