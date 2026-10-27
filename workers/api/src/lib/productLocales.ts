import type { UpsertProductLocaleInput } from "@shopad/shared";
import type { createServiceClient } from "../lib/supabase";

const MAX_GALLERY = 20;
const MAX_DETAIL_IMAGES = 30;
const MAX_DESCRIPTION_ENTRIES = 30;
const BUCKET = "product-locales";

type Supabase = ReturnType<typeof createServiceClient>;

function normalizeUrlList(value: unknown, max: number): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const urls = value
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length > max) return null;
  return urls;
}

function normalizeStringList(value: unknown, max: number): string[] | null {
  if (value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const items = parsed
            .filter((u): u is string => typeof u === "string")
            .map((u) => u.trim())
            .filter(Boolean);
          if (items.length > max) return null;
          return items;
        }
      } catch {
        /* single */
      }
    }
    return [trimmed];
  }
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);
  if (items.length > max) return null;
  return items;
}

export function coerceLocaleRow<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    description_entries:
      normalizeStringList(row.description_entries, MAX_DESCRIPTION_ENTRIES) ??
      [],
    gallery_urls: normalizeUrlList(row.gallery_urls, MAX_GALLERY) ?? [],
    detail_image_urls:
      normalizeUrlList(row.detail_image_urls, MAX_DETAIL_IMAGES) ?? [],
  };
}

function productLocalePath(productId: string, locale: string) {
  return `products/${productId}/${locale}.json`;
}

function packageLocalesPath(productId: string) {
  return `packages/${productId}.json`;
}

function giftLocalesPath(productId: string) {
  return `gifts/${productId}.json`;
}

/** 前端草稿兜底：只保留语言内容字段，防止 product_id/locale 污染 */
function cleanFallback(fallback?: Record<string, unknown>) {
  if (!fallback || typeof fallback !== "object") return {};
  const {
    product_id: _pid,
    locale: _locale,
    created_at: _c,
    updated_at: _u,
    ...rest
  } = fallback;
  return rest;
}

async function downloadJson<T>(
  supabase: Supabase,
  path: string,
): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) {
    const msg = error.message || "";
    if (/not found|404|Object not found/i.test(msg)) return null;
    throw new Error(msg);
  }
  if (!data) return null;
  const text = await data.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

async function uploadJson(
  supabase: Supabase,
  path: string,
  body: unknown,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(body, null, 0));
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/json",
    // 语言 JSON 会被店面按语言实时读取；禁用 CDN 缓存，避免覆盖后仍返回旧内容
    cacheControl: "0",
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

async function removePath(supabase: Supabase, path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error && !/not found|404/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function listProductLocales(supabase: Supabase, productId: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(`products/${productId}`, { limit: 100 });
  if (error) {
    // bucket empty / folder missing
    if (/not found|404/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  const files = (data ?? []).filter(
    (f) => f.name.endsWith(".json") && f.name !== "_index.json",
  );
  const rows: Record<string, unknown>[] = [];
  for (const file of files) {
    const locale = file.name.replace(/\.json$/i, "");
    const raw = await downloadJson<Record<string, unknown>>(
      supabase,
      productLocalePath(productId, locale),
    );
    if (!raw) continue;
    rows.push(
      coerceLocaleRow({
        product_id: productId,
        locale,
        ...raw,
      }),
    );
  }
  rows.sort((a, b) => String(a.locale).localeCompare(String(b.locale)));
  return rows;
}

/** 批量读取商品各语言版本的「商品标题(外部)」：productId → locale → title_external。 */
export async function loadProductTitleExternalLocales(
  supabase: Supabase,
  productIds: string[],
): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  const ids = [...new Set(productIds)].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0) return result;
  await Promise.all(
    ids.map(async (id) => {
      try {
        const rows = await listProductLocales(supabase, id);
        const map: Record<string, string> = {};
        for (const row of rows) {
          const title =
            typeof row.title_external === "string"
              ? row.title_external.trim()
              : "";
          if (title) map[String(row.locale)] = title;
        }
        if (Object.keys(map).length > 0) result.set(id, map);
      } catch {
        /* 单个商品语言读取失败不影响其他 */
      }
    }),
  );
  return result;
}

export function validateLocaleCode(
  locale: unknown,
): { ok: true; locale: string } | { ok: false; error: string } {
  if (typeof locale !== "string" || !locale.trim()) {
    return { ok: false, error: "请填写语言字段" };
  }
  const code = locale.trim().toLowerCase();
  if (code === "id" || code === "default" || code === "ar") {
    return {
      ok: false,
      error: "默认内容请直接编辑商品主字段，勿作为覆盖语言",
    };
  }
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(code)) {
    return { ok: false, error: "语言字段须为 2 位小写字母，如 en、fr" };
  }
  return { ok: true, locale: code };
}

export function buildLocaleUpsertRow(
  productId: string,
  body: UpsertProductLocaleInput,
  locale: string,
):
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string } {
  const gallery =
    body.gallery_urls !== undefined
      ? normalizeUrlList(body.gallery_urls, MAX_GALLERY)
      : [];
  if (body.gallery_urls !== undefined && gallery === null) {
    return { ok: false, error: `轮播图最多 ${MAX_GALLERY} 张` };
  }
  const details =
    body.detail_image_urls !== undefined
      ? normalizeUrlList(body.detail_image_urls, MAX_DETAIL_IMAGES)
      : [];
  if (body.detail_image_urls !== undefined && details === null) {
    return { ok: false, error: `详情图最多 ${MAX_DETAIL_IMAGES} 张` };
  }
  const entries =
    body.description_entries !== undefined
      ? normalizeStringList(body.description_entries, MAX_DESCRIPTION_ENTRIES)
      : [];
  if (body.description_entries !== undefined && entries === null) {
    return {
      ok: false,
      error: `描述条目最多 ${MAX_DESCRIPTION_ENTRIES} 条`,
    };
  }

  return {
    ok: true,
    row: {
      product_id: productId,
      locale,
      ...(body.label !== undefined
        ? { label: body.label?.trim() || null }
        : {}),
      ...(body.title_external !== undefined
        ? { title_external: body.title_external?.trim() || null }
        : {}),
      ...(body.facebook_pixel_id !== undefined
        ? { facebook_pixel_id: body.facebook_pixel_id?.trim() || null }
        : {}),
      ...(body.google_conversion_id !== undefined
        ? { google_conversion_id: body.google_conversion_id?.trim() || null }
        : {}),
      ...(body.google_label !== undefined
        ? { google_label: body.google_label?.trim() || null }
        : {}),
      ...(body.description !== undefined
        ? { description: body.description?.trim() || null }
        : {}),
      ...(body.description_entries !== undefined
        ? { description_entries: entries ?? [] }
        : {}),
      ...(body.cover_url !== undefined
        ? { cover_url: body.cover_url?.trim() || null }
        : {}),
      ...(body.gallery_urls !== undefined
        ? { gallery_urls: gallery ?? [] }
        : {}),
      ...(body.detail_image_urls !== undefined
        ? { detail_image_urls: details ?? [] }
        : {}),
      updated_at: new Date().toISOString(),
    },
  };
}

export async function upsertProductLocale(
  supabase: Supabase,
  productId: string,
  body: UpsertProductLocaleInput,
) {
  const localeCheck = validateLocaleCode(body.locale);
  if (!localeCheck.ok) return localeCheck;
  const built = buildLocaleUpsertRow(productId, body, localeCheck.locale);
  if (!built.ok) return built;

  const { product_id: _pid, ...payload } = built.row;
  // 去掉 undefined，避免覆盖已有 label
  const clean = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined),
  );
  const existing = await downloadJson<Record<string, unknown>>(
    supabase,
    productLocalePath(productId, localeCheck.locale),
  );
  const merged = { ...(existing ?? {}), ...clean };
  await uploadJson(
    supabase,
    productLocalePath(productId, localeCheck.locale),
    merged,
  );
  return {
    ok: true as const,
    data: coerceLocaleRow({
      product_id: productId,
      locale: localeCheck.locale,
      ...merged,
    }),
  };
}

export async function deleteProductLocale(
  supabase: Supabase,
  productId: string,
  locale: string,
) {
  const localeCheck = validateLocaleCode(locale);
  if (!localeCheck.ok) return localeCheck;
  await removePath(
    supabase,
    productLocalePath(productId, localeCheck.locale),
  );
  return { ok: true as const, locale: localeCheck.locale };
}

/** 重命名语言字段码：复制商品语言 JSON + 迁移套餐语言 key + 删除旧文件；
 * 旧文件缺失时（如仅前端存在按钮）则用前端传来的草稿数据直接创建新文件，保证可编辑。 */
export async function renameProductLocale(
  supabase: Supabase,
  productId: string,
  oldLocale: string,
  newLocale: string,
  label?: string | null,
  fallback?: Record<string, unknown>,
) {
  const oldCheck = validateLocaleCode(oldLocale);
  if (!oldCheck.ok) return oldCheck;
  const newCheck = validateLocaleCode(newLocale);
  if (!newCheck.ok) return newCheck;
  const from = oldCheck.locale;
  const to = newCheck.locale;
  if (from === to) {
    // 仅改显示名；旧文件缺失时用兜底数据创建
    const existing =
      (await downloadJson<Record<string, unknown>>(
        supabase,
        productLocalePath(productId, from),
      )) ?? fallback ?? null;
    if (!existing) return { ok: false as const, error: `语言「${from}」不存在` };
    if (label !== undefined || fallback) {
      const merged = {
        ...existing,
        ...cleanFallback(fallback),
        ...(label !== undefined ? { label: label?.trim() || null } : {}),
      };
      await uploadJson(supabase, productLocalePath(productId, from), merged);
      return {
        ok: true as const,
        data: coerceLocaleRow({
          product_id: productId,
          locale: from,
          ...merged,
        }),
      };
    }
    return {
      ok: true as const,
      data: coerceLocaleRow({ product_id: productId, locale: from, ...existing }),
    };
  }
  const existing =
    (await downloadJson<Record<string, unknown>>(
      supabase,
      productLocalePath(productId, from),
    )) ?? fallback ?? null;
  if (!existing) return { ok: false as const, error: `语言「${from}」不存在，请先点“保存本语言内容”后再改字段` };
  const target = await downloadJson<Record<string, unknown>>(
    supabase,
    productLocalePath(productId, to),
  );
  if (target) return { ok: false as const, error: `语言字段「${to}」已存在` };
  const merged = {
    ...existing,
    ...cleanFallback(fallback),
    ...(label !== undefined ? { label: label?.trim() || null } : {}),
  };
  await uploadJson(supabase, productLocalePath(productId, to), merged);
  await removePath(supabase, productLocalePath(productId, from));
  // 迁移套餐语言 key
  try {
    const pkgMap =
      (await downloadJson<PackageLocaleMap>(
        supabase,
        packageLocalesPath(productId),
      )) ?? {};
    let changed = false;
    for (const pkgLocales of Object.values(pkgMap)) {
      if (pkgLocales[from] !== undefined && pkgLocales[to] === undefined) {
        pkgLocales[to] = pkgLocales[from]!;
        delete pkgLocales[from];
        changed = true;
      } else if (pkgLocales[from] !== undefined) {
        delete pkgLocales[from];
        changed = true;
      }
    }
    if (changed) {
      if (Object.keys(pkgMap).length === 0) {
        await removePath(supabase, packageLocalesPath(productId));
      } else {
        await uploadJson(supabase, packageLocalesPath(productId), pkgMap);
      }
    }
  } catch {
    /* 套餐迁移失败不阻断主流程 */
  }
  return {
    ok: true as const,
    data: coerceLocaleRow({ product_id: productId, locale: to, ...merged }),
    from,
    to,
  };
}

export async function copyProductLocales(
  supabase: Supabase,
  fromProductId: string,
  toProductId: string,
) {
  const rows = await listProductLocales(supabase, fromProductId);
  for (const row of rows) {
    const locale = String(row.locale);
    const { product_id: _p, locale: _l, ...rest } = row;
    await uploadJson(supabase, productLocalePath(toProductId, locale), rest);
  }

  const pkgMap = await downloadJson<
    Record<string, Record<string, { name?: string; name_external?: string }>>
  >(supabase, packageLocalesPath(fromProductId));
  if (pkgMap && Object.keys(pkgMap).length > 0) {
    // 复制商品时套餐 id 会变，由 packages copy 逻辑单独处理；此处仅复制商品级语言
  }
}

type PackageSkuLocaleEntry = {
  sku_display?: string | null;
  image_url?: string | null;
};

type PackageLocaleEntry = {
  name: string;
  name_external: string;
  image_url?: string | null;
  /** sku_code → 该语言的属性名称/图片覆盖 */
  skus?: Record<string, PackageSkuLocaleEntry>;
};

/** packageId -> locale -> names / image / 属性名称图片 */
type PackageLocaleMap = Record<string, Record<string, PackageLocaleEntry>>;

/** 清理某语言的独立属性名称/图片覆盖 */
function cleanPackageSkuLocales(
  value: unknown,
): Record<string, PackageSkuLocaleEntry> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, PackageSkuLocaleEntry> = {};
  for (const [codeRaw, raw] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const code = codeRaw.trim();
    if (!code || !raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const skuDisplay =
      typeof item.sku_display === "string" ? item.sku_display.trim() : "";
    const imageUrl =
      typeof item.image_url === "string" ? item.image_url.trim() : "";
    if (!skuDisplay && !imageUrl) continue;
    out[code] = {
      ...(skuDisplay ? { sku_display: skuDisplay } : {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function listPackageLocalesByPackageIds(
  supabase: Supabase,
  packageIds: string[],
  productId?: string,
) {
  const map = new Map<string, Record<string, unknown>[]>();
  if (packageIds.length === 0) return map;

  // Prefer product-scoped file when productId known
  if (productId) {
    const stored = await downloadJson<PackageLocaleMap>(
      supabase,
      packageLocalesPath(productId),
    );
    if (stored) {
      for (const pkgId of packageIds) {
        const locales = stored[pkgId];
        if (!locales) continue;
        const rows: Record<string, unknown>[] = [];
        for (const [locale, value] of Object.entries(locales)) {
          rows.push({
            package_id: pkgId,
            locale,
            name: value?.name ?? "",
            name_external: value?.name_external ?? "",
            image_url: value?.image_url ?? null,
            skus: value?.skus ?? {},
          });
        }
        map.set(pkgId, rows);
      }
      return map;
    }
  }

  return map;
}

export async function replacePackageLocales(
  supabase: Supabase,
  packageId: string,
  locales:
    | Record<
        string,
        {
          name?: string;
          name_external?: string;
          image_url?: string | null;
          skus?: Record<
            string,
            { sku_display?: string | null; image_url?: string | null }
          >;
        }
      >
    | undefined,
  productId: string,
) {
  const path = packageLocalesPath(productId);
  const current =
    (await downloadJson<PackageLocaleMap>(supabase, path)) ?? {};

  if (!locales || Object.keys(locales).length === 0) {
    delete current[packageId];
  } else {
    const next: Record<string, PackageLocaleEntry> = {};
    for (const [localeRaw, value] of Object.entries(locales)) {
      const check = validateLocaleCode(localeRaw);
      if (!check.ok) continue;
      const name = value?.name?.trim() || "";
      const nameExternal = value?.name_external?.trim() || "";
      const imageUrl = value?.image_url?.trim() || null;
      const skus = cleanPackageSkuLocales(value?.skus);
      if (!name && !nameExternal && !imageUrl && !skus) continue;
      next[check.locale] = {
        name,
        name_external: nameExternal,
        image_url: imageUrl,
        ...(skus ? { skus } : {}),
      };
    }
    if (Object.keys(next).length === 0) delete current[packageId];
    else current[packageId] = next;
  }

  if (Object.keys(current).length === 0) {
    await removePath(supabase, path);
  } else {
    await uploadJson(supabase, path, current);
  }
}

/** 整商品套餐语言一次性写入（replace-all 套餐后调用） */
export async function saveAllPackageLocales(
  supabase: Supabase,
  productId: string,
  byPackageId: PackageLocaleMap,
) {
  const path = packageLocalesPath(productId);
  const cleaned: PackageLocaleMap = {};
  for (const [pkgId, locales] of Object.entries(byPackageId)) {
    const next: Record<string, PackageLocaleEntry> = {};
    for (const [localeRaw, value] of Object.entries(locales || {})) {
      const check = validateLocaleCode(localeRaw);
      if (!check.ok) continue;
      const name = value?.name?.trim() || "";
      const nameExternal = value?.name_external?.trim() || "";
      const imageUrl = value?.image_url?.trim() || null;
      const skus = cleanPackageSkuLocales(value?.skus);
      if (!name && !nameExternal && !imageUrl && !skus) continue;
      next[check.locale] = {
        name,
        name_external: nameExternal,
        image_url: imageUrl,
        ...(skus ? { skus } : {}),
      };
    }
    if (Object.keys(next).length > 0) cleaned[pkgId] = next;
  }
  if (Object.keys(cleaned).length === 0) {
    await removePath(supabase, path);
  } else {
    await uploadJson(supabase, path, cleaned);
  }
}

/** gifts/{productId}.json 中区块总标题的保留键 */
export const GIFT_SECTION_KEY = "_section";

/** giftId -> locale -> gift_name */
type GiftLocaleMap = Record<string, Record<string, { gift_name: string }>>;

/** locale -> { title } */
type GiftSectionTitleMap = Record<string, { title: string }>;

/** Storage 中的赠品语言文件（含可选总标题） */
type GiftLocalesFile = GiftLocaleMap & {
  [GIFT_SECTION_KEY]?: GiftSectionTitleMap;
};

function isGiftSectionKey(key: string) {
  return key === GIFT_SECTION_KEY;
}

export async function listGiftLocalesByGiftIds(
  supabase: Supabase,
  giftIds: string[],
  productId?: string,
) {
  const map = new Map<string, Record<string, unknown>[]>();
  if (giftIds.length === 0 || !productId) return map;

  const stored = await downloadJson<GiftLocalesFile>(
    supabase,
    giftLocalesPath(productId),
  );
  if (!stored) return map;

  for (const giftId of giftIds) {
    if (isGiftSectionKey(giftId)) continue;
    const locales = stored[giftId];
    if (!locales || typeof locales !== "object") continue;
    const rows: Record<string, unknown>[] = [];
    for (const [locale, value] of Object.entries(locales)) {
      const giftName =
        value && typeof value === "object" && "gift_name" in value
          ? String((value as { gift_name?: string }).gift_name ?? "")
          : "";
      rows.push({
        gift_id: giftId,
        locale,
        gift_name: giftName,
      });
    }
    map.set(giftId, rows);
  }
  return map;
}

/** 读取赠品区块总标题的多语言覆盖：locale → title */
export async function loadGiftSectionTitles(
  supabase: Supabase,
  productId: string,
): Promise<Record<string, string>> {
  const stored = await downloadJson<GiftLocalesFile>(
    supabase,
    giftLocalesPath(productId),
  );
  const section = stored?.[GIFT_SECTION_KEY];
  if (!section || typeof section !== "object") return {};
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(section)) {
    const title =
      value && typeof value === "object"
        ? String((value as { title?: string }).title ?? "").trim()
        : "";
    if (title) out[locale] = title;
  }
  return out;
}

/**
 * 整商品赠品语言一次性写入（replace-all 赠品后调用）。
 * `sectionTitles === undefined`：保留文件中已有的 `_section`；
 * 传入对象（可为 {}）：整段替换总标题多语言。
 */
export async function saveAllGiftLocales(
  supabase: Supabase,
  productId: string,
  byGiftId: GiftLocaleMap,
  sectionTitles?: Record<string, string> | null,
) {
  const path = giftLocalesPath(productId);
  const existing =
    sectionTitles === undefined
      ? await downloadJson<GiftLocalesFile>(supabase, path)
      : null;
  const cleaned: GiftLocalesFile = {};
  for (const [giftId, locales] of Object.entries(byGiftId)) {
    if (isGiftSectionKey(giftId)) continue;
    const next: Record<string, { gift_name: string }> = {};
    for (const [localeRaw, value] of Object.entries(locales || {})) {
      const check = validateLocaleCode(localeRaw);
      if (!check.ok) continue;
      const giftName = value?.gift_name?.trim() || "";
      if (!giftName) continue;
      next[check.locale] = { gift_name: giftName };
    }
    if (Object.keys(next).length > 0) cleaned[giftId] = next;
  }

  if (sectionTitles !== undefined && sectionTitles !== null) {
    const section: GiftSectionTitleMap = {};
    for (const [localeRaw, titleRaw] of Object.entries(sectionTitles)) {
      const check = validateLocaleCode(localeRaw);
      if (!check.ok) continue;
      const title = titleRaw.trim();
      if (!title) continue;
      section[check.locale] = { title };
    }
    if (Object.keys(section).length > 0) {
      cleaned[GIFT_SECTION_KEY] = section;
    }
  } else if (existing?.[GIFT_SECTION_KEY]) {
    cleaned[GIFT_SECTION_KEY] = existing[GIFT_SECTION_KEY];
  }

  if (Object.keys(cleaned).length === 0) {
    await removePath(supabase, path);
  } else {
    await uploadJson(supabase, path, cleaned);
  }
}

/** 复制商品时：按新旧 gift id 映射复制赠品语言覆盖（含总标题） */
export async function copyGiftLocales(
  supabase: Supabase,
  fromProductId: string,
  toProductId: string,
  oldToNewGiftId: Map<string, string>,
) {
  const stored = await downloadJson<GiftLocalesFile>(
    supabase,
    giftLocalesPath(fromProductId),
  );
  if (!stored) return;
  const next: GiftLocaleMap = {};
  for (const [oldId, locales] of Object.entries(stored)) {
    if (isGiftSectionKey(oldId)) continue;
    const newId = oldToNewGiftId.get(oldId);
    if (!newId || !locales) continue;
    next[newId] = locales as Record<string, { gift_name: string }>;
  }
  const sectionTitles: Record<string, string> = {};
  for (const [locale, value] of Object.entries(
    stored[GIFT_SECTION_KEY] ?? {},
  )) {
    const title = value?.title?.trim();
    if (title) sectionTitles[locale] = title;
  }
  if (oldToNewGiftId.size === 0 && Object.keys(sectionTitles).length === 0) {
    return;
  }
  await saveAllGiftLocales(
    supabase,
    toProductId,
    next,
    Object.keys(sectionTitles).length > 0 ? sectionTitles : null,
  );
}
