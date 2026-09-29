import type { UpsertAddressLibraryLocaleInput } from "@shopad/shared";
import { validateLocaleCode } from "./productLocales";
import type { createServiceClient } from "../lib/supabase";

const BUCKET = "product-locales";

type Supabase = ReturnType<typeof createServiceClient>;

function addressLocalePath(libraryId: string, locale: string) {
  return `addresses/${libraryId}/${locale}.json`;
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

function coerceNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (!name) continue;
    out[k] = name;
  }
  return out;
}

export async function listAddressLibraryLocales(
  supabase: Supabase,
  libraryId: string,
) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(`addresses/${libraryId}`, { limit: 100 });
  if (error) {
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
      addressLocalePath(libraryId, locale),
    );
    if (!raw) continue;
    rows.push({
      library_id: libraryId,
      locale,
      label: typeof raw.label === "string" ? raw.label : null,
      names: coerceNames(raw.names),
      updated_at:
        typeof raw.updated_at === "string"
          ? raw.updated_at
          : new Date().toISOString(),
    });
  }
  rows.sort((a, b) => String(a.locale).localeCompare(String(b.locale)));
  return rows;
}

export async function listAddressLibraryLocaleMeta(
  supabase: Supabase,
  libraryId: string,
) {
  const rows = await listAddressLibraryLocales(supabase, libraryId);
  return rows.map((row) => ({
    locale: String(row.locale),
    label:
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : null,
  }));
}

export async function upsertAddressLibraryLocale(
  supabase: Supabase,
  libraryId: string,
  body: UpsertAddressLibraryLocaleInput,
) {
  const localeCheck = validateLocaleCode(body.locale);
  if (!localeCheck.ok) return localeCheck;

  const existing = await downloadJson<Record<string, unknown>>(
    supabase,
    addressLocalePath(libraryId, localeCheck.locale),
  );

  const nextNames =
    body.names !== undefined
      ? coerceNames(body.names)
      : coerceNames(existing?.names);

  const label =
    body.label !== undefined
      ? body.label?.trim() || null
      : typeof existing?.label === "string"
        ? existing.label
        : null;

  const payload = {
    label,
    names: nextNames,
    updated_at: new Date().toISOString(),
  };

  await uploadJson(
    supabase,
    addressLocalePath(libraryId, localeCheck.locale),
    payload,
  );

  return {
    ok: true as const,
    data: {
      library_id: libraryId,
      locale: localeCheck.locale,
      label,
      names: nextNames,
      updated_at: payload.updated_at,
    },
  };
}

export async function deleteAddressLibraryLocale(
  supabase: Supabase,
  libraryId: string,
  locale: string,
) {
  const localeCheck = validateLocaleCode(locale);
  if (!localeCheck.ok) return localeCheck;
  await removePath(
    supabase,
    addressLocalePath(libraryId, localeCheck.locale),
  );
  return { ok: true as const, locale: localeCheck.locale };
}

/** 默认树重导入后清空各语言 names，保留语言条目与 label */
export async function clearAddressLocaleNames(
  supabase: Supabase,
  libraryId: string,
) {
  const rows = await listAddressLibraryLocales(supabase, libraryId);
  for (const row of rows) {
    const locale = String(row.locale);
    await uploadJson(supabase, addressLocalePath(libraryId, locale), {
      label: typeof row.label === "string" ? row.label : null,
      names: {},
      updated_at: new Date().toISOString(),
    });
  }
}

/** 删除地址库时清理全部语言覆盖文件 */
export async function deleteAllAddressLibraryLocales(
  supabase: Supabase,
  libraryId: string,
) {
  const rows = await listAddressLibraryLocales(supabase, libraryId);
  for (const row of rows) {
    await removePath(supabase, addressLocalePath(libraryId, String(row.locale)));
  }
}
