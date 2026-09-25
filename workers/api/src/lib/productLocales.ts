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

/** packageId -> locale -> names / image */
type PackageLocaleMap = Record<
  string,
  Record<
    string,
    { name: string; name_external: string; image_url?: string | null }
  >
>;

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
        { name?: string; name_external?: string; image_url?: string | null }
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
    const next: Record<
      string,
      { name: string; name_external: string; image_url?: string | null }
    > = {};
    for (const [localeRaw, value] of Object.entries(locales)) {
      const check = validateLocaleCode(localeRaw);
      if (!check.ok) continue;
      const name = value?.name?.trim() || "";
      const nameExternal = value?.name_external?.trim() || "";
      const imageUrl = value?.image_url?.trim() || null;
      if (!name && !nameExternal && !imageUrl) continue;
      next[check.locale] = {
        name,
        name_external: nameExternal,
        image_url: imageUrl,
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
    const next: Record<
      string,
      { name: string; name_external: string; image_url?: string | null }
    > = {};
    for (const [localeRaw, value] of Object.entries(locales || {})) {
      const check = validateLocaleCode(localeRaw);
      if (!check.ok) continue;
      const name = value?.name?.trim() || "";
      const nameExternal = value?.name_external?.trim() || "";
      const imageUrl = value?.image_url?.trim() || null;
      if (!name && !nameExternal && !imageUrl) continue;
      next[check.locale] = {
        name,
        name_external: nameExternal,
        image_url: imageUrl,
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
