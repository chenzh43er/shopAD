import { Hono } from "hono";
import type {
  CreateProductInput,
  ProductStatus,
  UpdateProductInput,
} from "@shopad/shared";
import { PRODUCT_STATUSES } from "@shopad/shared";
import {
  attachActors,
  attachActorsOne,
  listAuditLogs,
  writeAuditLog,
} from "../lib/audit";
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

function actorFrom(c: { get: (k: keyof Variables) => string }) {
  return {
    id: c.get("userId"),
    email: c.get("userEmail"),
    name: c.get("userName"),
  };
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
  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }
  if (status && isProductStatus(status)) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;
  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const withActors = await attachActors(supabase, data ?? [], [
    "created_by",
    "updated_by",
  ]);

  return c.json({
    data: withActors,
    total: count ?? 0,
    page,
    pageSize,
  });
});

productsRoutes.get("/:id/logs", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  const { data, error } = await listAuditLogs(supabase, "product", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: data ?? [] });
});

productsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "商品不存在" }, 404);
  const withActors = await attachActorsOne(supabase, data, [
    "created_by",
    "updated_by",
  ]);
  return c.json(withActors);
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
  if (typeof body.price !== "number" || body.price < 0) {
    return c.json({ error: "价格无效" }, 400);
  }
  if (body.status && !isProductStatus(body.status)) {
    return c.json({ error: "状态无效" }, 400);
  }

  if (body.weight !== undefined && (typeof body.weight !== "number" || body.weight < 0)) {
    return c.json({ error: "重量无效" }, 400);
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

  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("products")
    .insert({
      name: status === "draft" ? linkSuffix || name : name,
      description: body.description ?? null,
      price: body.price,
      stock: body.stock ?? 0,
      cover_url: body.cover_url ?? null,
      gallery_urls: galleryUrls,
      detail_image_urls: detailImageUrls,
      status,
      link_suffix: linkSuffix || null,
      title_external: body.title_external?.trim() || null,
      facebook_pixel_id: body.facebook_pixel_id?.trim() || null,
      google_conversion_id: body.google_conversion_id?.trim() || null,
      extra_html: body.extra_html?.trim() || null,
      sku_code: body.sku_code?.trim() || null,
      sku_display: body.sku_display?.trim() || null,
      packages_enabled: body.packages_enabled ?? false,
      weight: body.weight ?? 1,
      item_category: body.item_category?.trim() || null,
      item_type: body.item_type?.trim() || "BARANG",
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: data.id,
    action: "create",
    actor,
    toValue: data.status,
    changes: { name: data.name },
  });

  const withActors = await attachActorsOne(supabase, data, [
    "created_by",
    "updated_by",
  ]);
  return c.json(withActors, 201);
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
  if (body.stock !== undefined) {
    if (typeof body.stock !== "number" || body.stock < 0) {
      return c.json({ error: "库存无效" }, 400);
    }
    patch.stock = body.stock;
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
  if (body.extra_html !== undefined) {
    patch.extra_html =
      typeof body.extra_html === "string" && body.extra_html.trim()
        ? body.extra_html
        : null;
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
  if (body.weight !== undefined) {
    if (typeof body.weight !== "number" || body.weight < 0) {
      return c.json({ error: "重量无效" }, 400);
    }
    patch.weight = body.weight;
  }
  if (body.item_category !== undefined) {
    patch.item_category = body.item_category?.trim() || null;
  }
  if (body.item_type !== undefined) {
    patch.item_type = body.item_type?.trim() || "BARANG";
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "没有可更新的字段" }, 400);
  }

  patch.updated_by = actor.id;

  const supabase = createServiceClient(c.env);
  const { data: before } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "商品不存在" }, 404);

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
    changes: patch,
  });

  const withActors = await attachActorsOne(supabase, data, [
    "created_by",
    "updated_by",
  ]);
  return c.json(withActors);
});

productsRoutes.patch("/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { status?: ProductStatus };
  const actor = actorFrom(c);

  if (!isProductStatus(body.status)) {
    return c.json({ error: "状态无效" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data: before } = await supabase
    .from("products")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("products")
    .update({ status: body.status, updated_by: actor.id })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "商品不存在" }, 404);

  await writeAuditLog(supabase, {
    entityType: "product",
    entityId: id,
    action: "status_change",
    actor,
    fromValue: before?.status ?? null,
    toValue: body.status,
  });

  const withActors = await attachActorsOne(supabase, data, [
    "created_by",
    "updated_by",
  ]);
  return c.json(withActors);
});

productsRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const actor = actorFrom(c);
  const supabase = createServiceClient(c.env);

  const { data: before } = await supabase
    .from("products")
    .select("id, name, status")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("products")
    .delete()
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
    fromValue: before?.status ?? null,
    changes: { name: before?.name ?? null },
  });

  return c.json({ ok: true });
});
