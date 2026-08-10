import { Hono } from "hono";
import { createServiceClient } from "../lib/supabase";
import { optimizeProductImage } from "../lib/optimizeProductImage";
import { reoptimizeProductImages } from "../lib/reoptimizeProductImages";
import { requireSuperAdmin } from "../middleware/auth";
import type { Env, Variables } from "../types";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_SIZE = 5 * 1024 * 1024;
/** GIF 无法在 Worker 内有效压缩，限制体积以免拖垮落地页 */
const MAX_GIF_SIZE = 500 * 1024;

export const uploadsRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

uploadsRoutes.post("/product-image", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "请使用 multipart/form-data 上传" }, 400);
  }

  const form = await c.req.formData();
  const file = form.get("file");

  if (
    !file ||
    typeof file === "string" ||
    typeof (file as Blob).arrayBuffer !== "function"
  ) {
    return c.json({ error: "缺少文件字段 file" }, 400);
  }

  const blob = file as File;
  const fileType = blob.type;
  const fileSize = blob.size;

  if (!ALLOWED_TYPES.has(fileType)) {
    return c.json({ error: "仅支持 JPEG/PNG/WebP/GIF" }, 400);
  }

  if (fileSize > MAX_SIZE) {
    return c.json({ error: "图片不能超过 5MB" }, 400);
  }

  if (fileType === "image/gif" && fileSize > MAX_GIF_SIZE) {
    return c.json(
      {
        error:
          "GIF 不能超过 500KB（动画无法压缩）。请改用短视频，或导出为 WebP/JPEG 静图后再上传。",
      },
      400,
    );
  }

  const original = await blob.arrayBuffer();
  let uploadBytes: ArrayBuffer = original;
  let uploadType = fileType;
  let ext =
    fileType === "image/png"
      ? "png"
      : fileType === "image/webp"
        ? "webp"
        : fileType === "image/gif"
          ? "gif"
          : "jpg";

  // GIF 保留动画；其余统一压缩并转 WebP
  if (fileType !== "image/gif") {
    try {
      const optimized = await optimizeProductImage(original, fileType);
      if (optimized) {
        uploadBytes = optimized.bytes;
        uploadType = optimized.contentType;
        ext = optimized.ext;
      }
    } catch (error) {
      console.error("optimizeProductImage failed, uploading original:", error);
    }
  }

  const path = `products/${crypto.randomUUID()}.${ext}`;
  const supabase = createServiceClient(c.env);

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, uploadBytes, {
      contentType: uploadType,
      upsert: false,
      cacheControl: "31536000",
    });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);

  return c.json({
    path,
    url: data.publicUrl,
    contentType: uploadType,
  });
});

/**
 * 将单个商品的存量图片重编码为 WebP 并回写 URL（超级管理员）。
 * POST /api/uploads/reoptimize-product/:productId
 */
uploadsRoutes.post(
  "/reoptimize-product/:productId",
  requireSuperAdmin,
  async (c) => {
    const productId = c.req.param("productId");
    if (!productId) {
      return c.json({ error: "缺少 productId" }, 400);
    }
    try {
      const result = await reoptimizeProductImages(c.env, productId);
      const replaced = result.images.filter(
        (i) => i.status === "replaced",
      ).length;
      const failed = result.images.filter((i) => i.status === "failed").length;
      return c.json({
        ok: true,
        replaced,
        failed,
        total: result.images.length,
        ...result,
      });
    } catch (error) {
      console.error("reoptimize-product failed:", error);
      return c.json(
        {
          error: error instanceof Error ? error.message : "重编码失败",
        },
        500,
      );
    }
  },
);

/**
 * 批量重编码存量商品图（超级管理员）。
 * POST /api/uploads/reoptimize-existing
 * body: { limit?: number, offset?: number }
 */
uploadsRoutes.post("/reoptimize-existing", requireSuperAdmin, async (c) => {
  let limit = 5;
  let offset = 0;
  try {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(20, Math.floor(body.limit));
    }
    if (typeof body?.offset === "number" && body.offset >= 0) {
      offset = Math.floor(body.offset);
    }
  } catch {
    // ignore body parse
  }

  const supabase = createServiceClient(c.env);
  const { data: products, error } = await supabase
    .from("products")
    .select("id")
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const results = [];
  for (const row of products ?? []) {
    try {
      const result = await reoptimizeProductImages(c.env, row.id as string);
      results.push({
        productId: row.id,
        ok: true,
        replaced: result.images.filter((i) => i.status === "replaced").length,
        failed: result.images.filter((i) => i.status === "failed").length,
        total: result.images.length,
      });
    } catch (err) {
      results.push({
        productId: row.id,
        ok: false,
        error: err instanceof Error ? err.message : "failed",
      });
    }
  }

  return c.json({
    ok: true,
    offset,
    limit,
    count: results.length,
    nextOffset: (products?.length ?? 0) < limit ? null : offset + limit,
    results,
  });
});
