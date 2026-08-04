import { Hono } from "hono";
import type {
  CreateProductInput,
  ProductStatus,
  UpdateProductInput,
} from "@shopad/shared";
import { PRODUCT_STATUSES, normalizeUserRole } from "@shopad/shared";
import {
  attachActors,
  attachActorsOne,
  listAuditLogs,
  writeAuditLog,
} from "../lib/audit";
import {
  assertProductAccess,
  attachProductOwners,
  attachProductOwnersOne,
  scopeProductsByOwner,
  syncProductOwners,
} from "../lib/access";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

function parsePage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parsePageSize(raw: string | undefined, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

function isProductStatus(value: unknown): value is ProductStatus {
  return (
    typeof value === "string" &&
    (PRODUCT_STATUSES as readonly string[]).includes(value)
  );
}

const MAX_GALLERY = 20;
const MAX_DETAIL_IMAGES = 30;
const MAX_EXTRA_HTML = 20;
const MAX_DESCRIPTION_ENTRIES = 30;

function normalizeUrlList(
  value: unknown,
  max: number,
): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const urls = value
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length > max) return null;
  return urls;
}

function normalizeStringList(
  value: unknown,
  max: number,
): string[] | null {
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
        /* treat as single snippet */
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

function normalizeExtraHtml(value: unknown): string[] | null {
  return normalizeStringList(value, MAX_EXTRA_HTML);
}

function normalizeDescriptionEntries(value: unknown): string[] | null {
  return normalizeStringList(value, MAX_DESCRIPTION_ENTRIES);
}

/** 读库时统一成 string[]（兼容 text 列里的 JSON 字符串） */
function coerceProductListFields<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    extra_html: normalizeExtraHtml(row.extra_html) ?? [],
    description_entries:
      normalizeDescriptionEntries(row.description_entries) ?? [],
  };
}

function isExtraHtmlTypeError(message: string): boolean {
  return /extra_html|text\[\]|character varying|invalid input syntax|malformed array|22P02|42804/i.test(
    message,
  );
}

function isLinkSuffixUniqueError(message: string): boolean {
  return /products_link_suffix_uidx|duplicate key.*link_suffix/i.test(message);
}

function actorFrom(c: { get: (k: keyof Variables) => string }) {
  return {
    id: c.get("userId"),
    email: c.get("userEmail"),
    name: c.get("userName"),
  };
}

const PRODUCT_SELECT =
  "*, region:address_libraries!products_region_id_fkey(id, name, remark), currency:currencies!products_currency_id_fkey(id, code, name, name_zh, symbol, symbol_suffix), domain:domains!products_domain_id_fkey(id, host, name, remark)";

async function resolveRegionId(
  supabase: ReturnType<typeof createServiceClient>,
  regionId: unknown,
  required: boolean,
): Promise<{ ok: true; regionId: string | null } | { ok: false; error: string }> {
  if (regionId === undefined) {
    return required
      ? { ok: false, error: "请选择地区" }
      : { ok: true, regionId: null };
  }
  if (regionId === null || regionId === "") {
    return required
      ? { ok: false, error: "请选择地区" }
      : { ok: true, regionId: null };
  }
  if (typeof regionId !== "string") {
    return { ok: false, error: "地区无效" };
  }
  const id = regionId.trim();
  if (!id) {
    return required
      ? { ok: false, error: "请选择地区" }
      : { ok: true, regionId: null };
  }
  const { data, error } = await supabase
    .from("address_libraries")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "所选地区不存在" };
  return { ok: true, regionId: id };
}

async function resolveCurrencyId(
  supabase: ReturnType<typeof createServiceClient>,
  currencyId: unknown,
  required: boolean,
): Promise<
  { ok: true; currencyId: string | null } | { ok: false; error: string }
> {
  if (currencyId === undefined) {
    const { data: def, error } = await supabase
      .from("currencies")
      .select("id")
      .eq("is_default", true)
      .eq("enabled", true)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (def) return { ok: true, currencyId: def.id };
    return required
      ? { ok: false, error: "请选择币种" }
      : { ok: true, currencyId: null };
  }
  if (currencyId === null || currencyId === "") {
    return required
      ? { ok: false, error: "请选择币种" }
      : { ok: true, currencyId: null };
  }
  if (typeof currencyId !== "string") {
    return { ok: false, error: "币种无效" };
  }
  const id = currencyId.trim();
  if (!id) {
    return required
      ? { ok: false, error: "请选择币种" }
      : { ok: true, currencyId: null };
  }
  const { data, error } = await supabase
    .from("currencies")
    .select("id, enabled")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "所选币种不存在" };
  if (!data.enabled) return { ok: false, error: "所选币种已停用" };
  return { ok: true, currencyId: id };
}

async function resolveDomainId(
  supabase: ReturnType<typeof createServiceClient>,
  domainId: unknown,
  required: boolean,
): Promise<
  { ok: true; domainId: string | null } | { ok: false; error: string }
> {
  if (domainId === undefined) {
    return required
      ? { ok: false, error: "请选择域名" }
      : { ok: true, domainId: null };
  }
  if (domainId === null || domainId === "") {
    return required
      ? { ok: false, error: "请选择域名" }
      : { ok: true, domainId: null };
  }
  if (typeof domainId !== "string") {
    return { ok: false, error: "域名无效" };
  }
  const id = domainId.trim();
  if (!id) {
    return required
      ? { ok: false, error: "请选择域名" }
      : { ok: true, domainId: null };
  }
  const { data, error } = await supabase
    .from("domains")
    .select("id, enabled")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "所选域名不存在" };
  if (!data.enabled) return { ok: false, error: "所选域名已停用" };
  return { ok: true, domainId: id };
}

/** 校验并解析所属人列表；仅超级管理员可指定他人，可多名 */
async function resolveOwnerIds(
  supabase: ReturnType<typeof createServiceClient>,
  opts: {
    userId: string;
    userRole: string;
    ownerIds: unknown;
    allowOmit: boolean;
    required: boolean;
  },
): Promise<
  | { ok: true; ownerIds: string[] | undefined }
  | { ok: false; error: string }
> {
  const selfId = opts.userId;
  const superAdmin = opts.userRole === "super_admin";

  // 员工：所属人固定为自己，忽略客户端传入
  if (!superAdmin) {
    if (opts.allowOmit && opts.ownerIds === undefined) {
      return { ok: true, ownerIds: undefined };
    }
    return { ok: true, ownerIds: [selfId] };
  }

  if (opts.ownerIds === undefined) {
    if (opts.allowOmit) return { ok: true, ownerIds: undefined };
    if (opts.required) return { ok: false, error: "请选择所属人" };
    return { ok: true, ownerIds: undefined };
  }

  if (!Array.isArray(opts.ownerIds)) {
    return { ok: false, error: "所属人无效" };
  }

  const ids = [
    ...new Set(
      opts.ownerIds
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];

  if (ids.length === 0) {
    return opts.required
      ? { ok: false, error: "请至少选择一名所属人" }
      : { ok: true, ownerIds: [] };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .in("id", ids);

  if (error && /is_active|column/i.test(error.message)) {
    const fallback = await supabase
      .from("profiles")
      .select("id, role")
      .in("id", ids);
    if (fallback.error) return { ok: false, error: fallback.error.message };
    const found = new Map(
      (fallback.data ?? []).map((p) => [p.id as string, p]),
    );
    for (const id of ids) {
      const row = found.get(id);
      if (!row) return { ok: false, error: "所属人不存在" };
      if (!normalizeUserRole(row.role)) {
        return { ok: false, error: "所属人账号无效" };
      }
      if (normalizeUserRole(row.role) !== "employee") {
        return { ok: false, error: "所属人只能选择员工" };
      }
    }
    return { ok: true, ownerIds: ids };
  }

  if (error) return { ok: false, error: error.message };
  const found = new Map((data ?? []).map((p) => [p.id as string, p]));
  for (const id of ids) {
    const row = found.get(id);
    if (!row) return { ok: false, error: "所属人不存在" };
    if (row.is_active === false) {
      return { ok: false, error: "所属人账号已停用" };
    }
    const role = normalizeUserRole(row.role);
    if (!role) return { ok: false, error: "所属人账号无效" };
    if (role !== "employee") {
      return { ok: false, error: "所属人只能选择员工" };
    }
  }
  return { ok: true, ownerIds: ids };
}

async function withProductExtras(
  supabase: ReturnType<typeof createServiceClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
) {
  const withActors = await attachActorsOne(supabase, row, [
    "created_by",
    "updated_by",
  ]);
  const withOwners = await attachProductOwnersOne(
    supabase,
    (withActors ?? row) as Record<string, unknown> & { id: string },
  );
  return withOwners
    ? coerceProductListFields(withOwners as Record<string, unknown>)
    : withOwners;
}

async function withProductExtrasList(
  supabase: ReturnType<typeof createServiceClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[],
) {
  const withActors = await attachActors(supabase, rows, [
    "created_by",
    "updated_by",
  ]);
  const withOwners = await attachProductOwners(
    supabase,
    withActors as Array<Record<string, unknown> & { id: string }>,
  );
  return withOwners.map((row) =>
    coerceProductListFields(row as Record<string, unknown>),
  );
}

export const productsRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

productsRoutes.get("/", async (c) => {
  const page = parsePage(c.req.query("page"));
  const pageSize = parsePageSize(c.req.query("pageSize"));
  const q = c.req.query("q")?.trim();
  const status = c.req.query("status");

  const supabase = createServiceClient(c.env);
  // status 字母序降序：on_sale → off_sale → draft，已上架优先
  let query = supabase
    .from("products")
    .select(PRODUCT_SELECT, { count: "exact" })
    .order("status", { ascending: false })
    .order("updated_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  let scoped;
  try {
    scoped = await scopeProductsByOwner(query, supabase, c);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  if (!scoped.ok) {
    return c.json({ data: [], total: 0, page, pageSize });
  }
  query = scoped.query;

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }
  if (status && isProductStatus(status)) {
    query = query.eq("status", status);
  } else {
    // 默认列表排除已删除（off_sale）
    query = query.neq("status", "off_sale");
  }

  const { data, error, count } = await query;
  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({
    data: await withProductExtrasList(supabase, data ?? []),
    total: count ?? 0,
    page,
    pageSize,
  });
});

productsRoutes.get("/:id/logs", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  try {
    const access = await assertProductAccess(supabase, id, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  const { data, error } = await listAuditLogs(supabase, "product", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
});

productsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  try {
    const access = await assertProductAccess(supabase, id, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "商品不存在" }, 404);
  return c.json(await withProductExtras(supabase, data));
});

/** 复制商品：基本信息 + 套餐；须提供全新唯一链接后缀；新商品为草稿 */
productsRoutes.post("/:id/copy", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { link_suffix?: string };
  const actor = actorFrom(c);
  const linkSuffix = body.link_suffix?.trim() || "";
  if (!linkSuffix) {
    return c.json({ error: "请填写新的链接后缀" }, 400);
  }

  const supabase = createServiceClient(c.env);
  try {
    const access = await assertProductAccess(supabase, id, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const { data: source, error: sourceError } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (sourceError) return c.json({ error: sourceError.message }, 500);
  if (!source) return c.json({ error: "商品不存在" }, 404);

  const { data: suffixTaken, error: suffixCheckError } = await supabase
    .from("products")
    .select("id")
    .eq("link_suffix", linkSuffix)
    .maybeSingle();
  if (suffixCheckError) {
    return c.json({ error: suffixCheckError.message }, 500);
  }
  if (suffixTaken) {
    return c.json({ error: "链接后缀已存在，请更换一个独一无二的后缀" }, 400);
  }

  const sourceWithOwners = await attachProductOwnersOne(
    supabase,
    source as Record<string, unknown> & { id: string },
  );
  const sourceOwnerIds = (sourceWithOwners?.owner_ids as string[] | undefined) ?? [];
  const ownerIds =
    c.get("userRole") === "super_admin"
      ? sourceOwnerIds
      : [actor.id];

  if (c.get("userRole") === "super_admin" && ownerIds.length > 0) {
    const ownerResolved = await resolveOwnerIds(supabase, {
      userId: c.get("userId"),
      userRole: c.get("userRole"),
      ownerIds,
      required: false,
      allowOmit: false,
    });
    if (!ownerResolved.ok) {
      return c.json({ error: ownerResolved.error }, 400);
    }
  }

  const insertRow = {
    name: String(source.name ?? linkSuffix),
    description: source.description ?? null,
    price: Number(source.price ?? 0),
    cover_url: source.cover_url ?? null,
    gallery_urls: Array.isArray(source.gallery_urls) ? source.gallery_urls : [],
    detail_image_urls: Array.isArray(source.detail_image_urls)
      ? source.detail_image_urls
      : [],
    status: "draft" as const,
    link_suffix: linkSuffix,
    title_external: source.title_external ?? null,
    facebook_pixel_id: source.facebook_pixel_id ?? null,
    google_conversion_id: source.google_conversion_id ?? null,
    google_label: source.google_label ?? null,
    extra_html: source.extra_html ?? [],
    description_entries:
      normalizeDescriptionEntries(source.description_entries) ?? [],
    sku_code: source.sku_code ?? null,
    sku_display: source.sku_display ?? null,
    packages_enabled: Boolean(source.packages_enabled),
    sales_count: Math.max(0, Math.floor(Number(source.sales_count ?? 0))),
    weight: Number(source.weight ?? 1),
    region_id: source.region_id ?? null,
    currency_id: source.currency_id ?? null,
    domain_id: source.domain_id ?? null,
    created_by: actor.id,
    updated_by: actor.id,
  };

  let { data: created, error: createError } = await supabase
    .from("products")
    .insert(insertRow)
    .select(PRODUCT_SELECT)
    .single();

  if (createError && isExtraHtmlTypeError(createError.message)) {
    const retry = await supabase
      .from("products")
      .insert({
        ...insertRow,
        extra_html: JSON.stringify(
          normalizeExtraHtml(source.extra_html) ?? [],
        ),
      })
      .select(PRODUCT_SELECT)
      .single();
    created = retry.data;
    createError = retry.error;
  }

  if (createError) {
    if (isLinkSuffixUniqueError(createError.message)) {
      return c.json(
        { error: "链接后缀已存在，请更换一个独一无二的后缀" },
        400,
      );
    }
    return c.json({ error: createError.message }, 500);
  }

  const synced = await syncProductOwners(
    supabase,
    created.id,
    ownerIds,
    actor.id,
  );
  if (!synced.ok) {
    return c.json({ error: synced.error }, 500);
  }

  // 复制套餐，并将指向原商品的明细改为新商品
  const { data: packages, error: packagesError } = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (packagesError) return c.json({ error: packagesError.message }, 500);

  if ((packages ?? []).length > 0) {
    const packageIds = packages!.map((p) => p.id as string);
    const { data: items, error: itemsError } = await supabase
      .from("product_package_items")
      .select("*")
      .in("package_id", packageIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (itemsError) return c.json({ error: itemsError.message }, 500);

    const packageRows = packages!.map((pkg, index) => ({
      product_id: created.id,
      name: pkg.name,
      name_external: pkg.name_external,
      original_price: pkg.original_price,
      discount_price: pkg.discount_price ?? null,
      summary: pkg.summary ?? null,
      image_url: pkg.image_url ?? null,
      is_visible: pkg.is_visible ?? true,
      sort_order: pkg.sort_order ?? index,
    }));

    const { data: insertedPackages, error: insertPkgError } = await supabase
      .from("product_packages")
      .insert(packageRows)
      .select("*");
    if (insertPkgError) {
      return c.json({ error: insertPkgError.message }, 500);
    }

    const oldToNewPkg = new Map<string, string>();
    const bySort = new Map(
      (insertedPackages ?? []).map((p) => [p.sort_order as number, p]),
    );
    for (const [i, oldPkg] of packages!.entries()) {
      const inserted = bySort.get((oldPkg.sort_order as number) ?? i);
      if (inserted) oldToNewPkg.set(oldPkg.id as string, inserted.id as string);
    }

    const itemRows = (items ?? [])
      .map((item) => {
        const newPkgId = oldToNewPkg.get(item.package_id as string);
        if (!newPkgId) return null;
        const refId = item.ref_product_id as string;
        return {
          package_id: newPkgId,
          ref_product_id: refId === id ? created.id : refId,
          quantity: item.quantity,
          independent_attrs: item.independent_attrs ?? false,
          sort_order: item.sort_order ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (itemRows.length > 0) {
      const { error: insertItemsError } = await supabase
        .from("product_package_items")
        .insert(itemRows);
      if (insertItemsError) {
        return c.json({ error: insertItemsError.message }, 500);
      }
    }
  }

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: created.id,
    action: "create",
    actor,
    toValue: "draft",
    changes: {
      name: created.name,
      copied_from: id,
      link_suffix: linkSuffix,
      owner_ids: ownerIds,
    },
  });

  return c.json(await withProductExtras(supabase, created), 201);
});

productsRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as CreateProductInput;
  const actor = actorFrom(c);

  const linkSuffix = body.link_suffix?.trim() || "";
  const status = body.status ?? "draft";
  // 草稿可用链接后缀作为名称；正式保存仍需名称（可回退到后缀）
  const name = body.name?.trim() || linkSuffix;
  if (!name) {
    return c.json({ error: "商品名称或链接后缀必填" }, 400);
  }
  if (status === "draft" && !linkSuffix) {
    return c.json({ error: "保存草稿前请填写链接后缀" }, 400);
  }
  if (status === "on_sale" && !linkSuffix) {
    return c.json({ error: "上架前请先填写链接后缀" }, 400);
  }
  if (typeof body.price !== "number" || body.price < 0) {
    return c.json({ error: "价格无效" }, 400);
  }
  if (body.status && !isProductStatus(body.status)) {
    return c.json({ error: "状态无效" }, 400);
  }

  if (body.weight !== undefined && (typeof body.weight !== "number" || body.weight < 0)) {
    return c.json({ error: "重量无效" }, 400);
  }
  if (
    body.sales_count !== undefined &&
    (typeof body.sales_count !== "number" ||
      !Number.isFinite(body.sales_count) ||
      body.sales_count < 0 ||
      !Number.isInteger(body.sales_count))
  ) {
    return c.json({ error: "销量无效" }, 400);
  }

  let galleryUrls: string[] = [];
  if (body.gallery_urls !== undefined) {
    const normalized = normalizeUrlList(body.gallery_urls, MAX_GALLERY);
    if (normalized === null) {
      return c.json({ error: `轮播图最多 ${MAX_GALLERY} 张` }, 400);
    }
    galleryUrls = normalized;
  }

  let detailImageUrls: string[] = [];
  if (body.detail_image_urls !== undefined) {
    const normalized = normalizeUrlList(
      body.detail_image_urls,
      MAX_DETAIL_IMAGES,
    );
    if (normalized === null) {
      return c.json({ error: `详情图最多 ${MAX_DETAIL_IMAGES} 张` }, 400);
    }
    detailImageUrls = normalized;
  }

  let extraHtml: string[] = [];
  if (body.extra_html !== undefined) {
    const normalized = normalizeExtraHtml(body.extra_html);
    if (normalized === null) {
      return c.json({ error: `附加HTML最多 ${MAX_EXTRA_HTML} 条` }, 400);
    }
    extraHtml = normalized;
  }

  let descriptionEntries: string[] = [];
  if (body.description_entries !== undefined) {
    const normalized = normalizeDescriptionEntries(body.description_entries);
    if (normalized === null) {
      return c.json(
        { error: `描述条目最多 ${MAX_DESCRIPTION_ENTRIES} 条` },
        400,
      );
    }
    descriptionEntries = normalized;
  }

  const supabase = createServiceClient(c.env);
  const regionResolved = await resolveRegionId(
    supabase,
    body.region_id,
    status === "on_sale",
  );
  if (!regionResolved.ok) {
    return c.json({ error: regionResolved.error }, 400);
  }
  const currencyResolved = await resolveCurrencyId(
    supabase,
    body.currency_id,
    status === "on_sale",
  );
  if (!currencyResolved.ok) {
    return c.json({ error: currencyResolved.error }, 400);
  }
  const domainResolved = await resolveDomainId(
    supabase,
    body.domain_id,
    status === "on_sale",
  );
  if (!domainResolved.ok) {
    return c.json({ error: domainResolved.error }, 400);
  }

  const ownerResolved = await resolveOwnerIds(supabase, {
    userId: c.get("userId"),
    userRole: c.get("userRole"),
    ownerIds: body.owner_ids,
    required: c.get("userRole") === "super_admin",
    allowOmit: false,
  });
  if (!ownerResolved.ok) {
    return c.json({ error: ownerResolved.error }, 400);
  }
  const ownerIds = ownerResolved.ownerIds ?? [actor.id];

  const insertRow = {
    name: status === "draft" ? linkSuffix || name : name,
    description: body.description ?? null,
    price: body.price,
    cover_url: body.cover_url ?? null,
    gallery_urls: galleryUrls,
    detail_image_urls: detailImageUrls,
    status,
    link_suffix: linkSuffix || null,
    title_external: body.title_external?.trim() || null,
    facebook_pixel_id: body.facebook_pixel_id?.trim() || null,
    google_conversion_id: body.google_conversion_id?.trim() || null,
    google_label: body.google_label?.trim() || null,
    extra_html: extraHtml as string[] | string,
    description_entries: descriptionEntries,
    sku_code: body.sku_code?.trim() || null,
    sku_display: body.sku_display?.trim() || null,
    packages_enabled: body.packages_enabled ?? false,
    sales_count: body.sales_count ?? 0,
    weight: body.weight ?? 1,
    region_id: regionResolved.regionId,
    currency_id: currencyResolved.currencyId,
    domain_id: domainResolved.domainId,
    created_by: actor.id,
    updated_by: actor.id,
  };

  let { data, error } = await supabase
    .from("products")
    .insert(insertRow)
    .select(PRODUCT_SELECT)
    .single();

  if (error && isExtraHtmlTypeError(error.message)) {
    const retry = await supabase
      .from("products")
      .insert({ ...insertRow, extra_html: JSON.stringify(extraHtml) })
      .select(PRODUCT_SELECT)
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (isLinkSuffixUniqueError(error.message)) {
      return c.json(
        { error: "链接后缀已存在，请更换一个独一无二的后缀" },
        400,
      );
    }
    return c.json({ error: error.message }, 500);
  }

  const synced = await syncProductOwners(supabase, data.id, ownerIds, actor.id);
  if (!synced.ok) {
    return c.json({ error: synced.error }, 500);
  }

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: data.id,
    action: "create",
    actor,
    toValue: data.status,
    changes: { name: data.name, owner_ids: ownerIds },
  });

  return c.json(await withProductExtras(supabase, data), 201);
});

productsRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as UpdateProductInput;
  const actor = actorFrom(c);

  const patch: Record<string, unknown> = {};
  if (body.link_suffix !== undefined) {
    patch.link_suffix = body.link_suffix?.trim() || null;
  }
  if (body.name !== undefined || body.status === "draft" || body.link_suffix !== undefined) {
    const nextStatus = body.status;
    const suffix =
      body.link_suffix !== undefined
        ? body.link_suffix?.trim() || ""
        : undefined;
    if (nextStatus === "draft") {
      const draftName =
        (suffix !== undefined ? suffix : body.name?.trim()) || "";
      if (!draftName && suffix === "") {
        return c.json({ error: "保存草稿前请填写链接后缀" }, 400);
      }
      if (suffix !== undefined && !suffix) {
        return c.json({ error: "保存草稿前请填写链接后缀" }, 400);
      }
      if (suffix) patch.name = suffix;
      else if (body.name !== undefined) {
        if (!body.name.trim()) return c.json({ error: "商品名称必填" }, 400);
        patch.name = body.name.trim();
      }
    } else if (body.name !== undefined) {
      if (!body.name.trim()) return c.json({ error: "商品名称必填" }, 400);
      patch.name = body.name.trim();
    }
  }
  if (body.description !== undefined) patch.description = body.description;
  if (body.price !== undefined) {
    if (typeof body.price !== "number" || body.price < 0) {
      return c.json({ error: "价格无效" }, 400);
    }
    patch.price = body.price;
  }
  if (body.cover_url !== undefined) patch.cover_url = body.cover_url;
  if (body.gallery_urls !== undefined) {
    const normalized = normalizeUrlList(body.gallery_urls, MAX_GALLERY);
    if (normalized === null) {
      return c.json({ error: `轮播图最多 ${MAX_GALLERY} 张` }, 400);
    }
    patch.gallery_urls = normalized;
  }
  if (body.detail_image_urls !== undefined) {
    const normalized = normalizeUrlList(
      body.detail_image_urls,
      MAX_DETAIL_IMAGES,
    );
    if (normalized === null) {
      return c.json({ error: `详情图最多 ${MAX_DETAIL_IMAGES} 张` }, 400);
    }
    patch.detail_image_urls = normalized;
  }
  if (body.status !== undefined) {
    if (!isProductStatus(body.status)) {
      return c.json({ error: "状态无效" }, 400);
    }
    patch.status = body.status;
  }
  if (body.link_suffix !== undefined) {
    patch.link_suffix = body.link_suffix?.trim() || null;
  }
  if (body.title_external !== undefined) {
    patch.title_external = body.title_external?.trim() || null;
  }
  if (body.facebook_pixel_id !== undefined) {
    patch.facebook_pixel_id = body.facebook_pixel_id?.trim() || null;
  }
  if (body.google_conversion_id !== undefined) {
    patch.google_conversion_id = body.google_conversion_id?.trim() || null;
  }
  if (body.google_label !== undefined) {
    patch.google_label = body.google_label?.trim() || null;
  }
  if (body.extra_html !== undefined) {
    const normalized = normalizeExtraHtml(body.extra_html);
    if (normalized === null) {
      return c.json({ error: `附加HTML最多 ${MAX_EXTRA_HTML} 条` }, 400);
    }
    patch.extra_html = normalized;
  }
  if (body.description_entries !== undefined) {
    const normalized = normalizeDescriptionEntries(body.description_entries);
    if (normalized === null) {
      return c.json(
        { error: `描述条目最多 ${MAX_DESCRIPTION_ENTRIES} 条` },
        400,
      );
    }
    patch.description_entries = normalized;
  }
  if (body.sku_code !== undefined) {
    patch.sku_code = body.sku_code?.trim() || null;
  }
  if (body.sku_display !== undefined) {
    patch.sku_display = body.sku_display?.trim() || null;
  }
  if (body.packages_enabled !== undefined) {
    patch.packages_enabled = Boolean(body.packages_enabled);
  }
  if (body.sales_count !== undefined) {
    if (
      typeof body.sales_count !== "number" ||
      !Number.isFinite(body.sales_count) ||
      body.sales_count < 0 ||
      !Number.isInteger(body.sales_count)
    ) {
      return c.json({ error: "销量无效" }, 400);
    }
    patch.sales_count = body.sales_count;
  }
  if (body.weight !== undefined) {
    if (typeof body.weight !== "number" || body.weight < 0) {
      return c.json({ error: "重量无效" }, 400);
    }
    patch.weight = body.weight;
  }
  if (body.region_id !== undefined) {
    patch.region_id = body.region_id;
  }
  if (body.currency_id !== undefined) {
    patch.currency_id = body.currency_id;
  }
  if (body.domain_id !== undefined) {
    patch.domain_id = body.domain_id;
  }

  const supabase = createServiceClient(c.env);
  try {
    const access = await assertProductAccess(supabase, id, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  let pendingOwnerIds: string[] | undefined;
  if (body.owner_ids !== undefined) {
    const ownerResolved = await resolveOwnerIds(supabase, {
      userId: c.get("userId"),
      userRole: c.get("userRole"),
      ownerIds: body.owner_ids,
      required: true,
      allowOmit: false,
    });
    if (!ownerResolved.ok) {
      return c.json({ error: ownerResolved.error }, 400);
    }
    // 仅超级管理员可变更所属人；员工传入会被 resolve 成自己，这里直接忽略
    if (c.get("userRole") === "super_admin" && ownerResolved.ownerIds) {
      pendingOwnerIds = ownerResolved.ownerIds;
    }
  }

  if (Object.keys(patch).length === 0 && pendingOwnerIds === undefined) {
    return c.json({ error: "没有可更新的字段" }, 400);
  }

  patch.updated_by = actor.id;

  if (body.region_id !== undefined) {
    const regionResolved = await resolveRegionId(
      supabase,
      body.region_id,
      false,
    );
    if (!regionResolved.ok) {
      return c.json({ error: regionResolved.error }, 400);
    }
    patch.region_id = regionResolved.regionId;
  }

  if (body.currency_id !== undefined) {
    const currencyResolved = await resolveCurrencyId(
      supabase,
      body.currency_id,
      false,
    );
    if (!currencyResolved.ok) {
      return c.json({ error: currencyResolved.error }, 400);
    }
    patch.currency_id = currencyResolved.currencyId;
  }

  if (body.domain_id !== undefined) {
    const domainResolved = await resolveDomainId(
      supabase,
      body.domain_id,
      false,
    );
    if (!domainResolved.ok) {
      return c.json({ error: domainResolved.error }, 400);
    }
    patch.domain_id = domainResolved.domainId;
  }

  const { data: before } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!before) return c.json({ error: "商品不存在" }, 404);

  const nextStatus = (patch.status as ProductStatus | undefined) ?? before.status;
  const nextSuffix =
    patch.link_suffix !== undefined
      ? (patch.link_suffix as string | null)
      : before.link_suffix;
  if (nextStatus === "on_sale" && !String(nextSuffix ?? "").trim()) {
    return c.json({ error: "上架前请先填写链接后缀" }, 400);
  }
  const nextRegionId =
    patch.region_id !== undefined
      ? (patch.region_id as string | null)
      : (before.region_id as string | null);
  if (nextStatus === "on_sale" && !nextRegionId) {
    return c.json({ error: "上架前请先选择地区" }, 400);
  }
  const nextCurrencyId =
    patch.currency_id !== undefined
      ? (patch.currency_id as string | null)
      : (before.currency_id as string | null);
  if (nextStatus === "on_sale" && !nextCurrencyId) {
    return c.json({ error: "上架前请先选择币种" }, 400);
  }
  const nextDomainId =
    patch.domain_id !== undefined
      ? (patch.domain_id as string | null)
      : (before.domain_id as string | null);
  if (nextStatus === "on_sale" && !nextDomainId) {
    return c.json({ error: "上架前请先选择域名" }, 400);
  }

  let { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .select(PRODUCT_SELECT)
    .maybeSingle();

  // extra_html 仍为 text 列时，数组写入可能失败，回退为 JSON 字符串
  if (
    error &&
    Array.isArray(patch.extra_html) &&
    isExtraHtmlTypeError(error.message)
  ) {
    const retry = await supabase
      .from("products")
      .update({
        ...patch,
        extra_html: JSON.stringify(patch.extra_html),
      })
      .eq("id", id)
      .select(PRODUCT_SELECT)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (isLinkSuffixUniqueError(error.message)) {
      return c.json(
        { error: "链接后缀已存在，请更换一个独一无二的后缀" },
        400,
      );
    }
    return c.json({ error: error.message }, 500);
  }
  if (!data) return c.json({ error: "商品不存在" }, 404);

  if (pendingOwnerIds) {
    const synced = await syncProductOwners(
      supabase,
      id,
      pendingOwnerIds,
      actor.id,
    );
    if (!synced.ok) {
      return c.json({ error: synced.error }, 500);
    }
  }

  const action =
    body.status !== undefined && before && body.status !== before.status
      ? "status_change"
      : "update";

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: id,
    action,
    actor,
    fromValue: before?.status ?? null,
    toValue: data.status,
    changes: {
      ...patch,
      ...(pendingOwnerIds ? { owner_ids: pendingOwnerIds } : {}),
    },
  });

  return c.json(await withProductExtras(supabase, data));
});

productsRoutes.patch("/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { status?: ProductStatus };
  const actor = actorFrom(c);

  if (!isProductStatus(body.status)) {
    return c.json({ error: "状态无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  try {
    const access = await assertProductAccess(supabase, id, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }
  const { data: before } = await supabase
    .from("products")
    .select("status, link_suffix, region_id, currency_id, domain_id")
    .eq("id", id)
    .maybeSingle();

  if (!before) return c.json({ error: "商品不存在" }, 404);
  if (body.status === "on_sale" && !String(before.link_suffix ?? "").trim()) {
    return c.json({ error: "上架前请先填写链接后缀" }, 400);
  }
  if (body.status === "on_sale" && !before.region_id) {
    return c.json({ error: "上架前请先选择地区" }, 400);
  }
  if (body.status === "on_sale" && !before.currency_id) {
    return c.json({ error: "上架前请先选择币种" }, 400);
  }
  if (body.status === "on_sale" && !before.domain_id) {
    return c.json({ error: "上架前请先选择域名" }, 400);
  }

  const { data, error } = await supabase
    .from("products")
    .update({ status: body.status, updated_by: actor.id })
    .eq("id", id)
    .select(PRODUCT_SELECT)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "商品不存在" }, 404);

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: id,
    action: "status_change",
    actor,
    fromValue: before.status ?? null,
    toValue: body.status,
  });

  return c.json(await withProductExtras(supabase, data));
});

productsRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const actor = actorFrom(c);
  const supabase = createServiceClient(c.env);

  try {
    const access = await assertProductAccess(supabase, id, c);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "权限校验失败" },
      500,
    );
  }

  const { data: before } = await supabase
    .from("products")
    .select("id, name, status")
    .eq("id", id)
    .maybeSingle();

  if (!before) return c.json({ error: "商品不存在" }, 404);
  if (before.status === "off_sale") {
    return c.json({ ok: true });
  }

  // 软删除：标记为 off_sale，可在已删除列表中恢复
  const { data, error } = await supabase
    .from("products")
    .update({ status: "off_sale", updated_by: actor.id })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "商品不存在" }, 404);

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: id,
    action: "delete",
    actor,
    fromValue: before.status,
    toValue: "off_sale",
    changes: { name: before.name },
  });

  return c.json({ ok: true });
});
