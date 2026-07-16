import { Hono } from "hono";
import { createServiceClient } from "../lib/supabase";
import type { Env, Variables } from "../types";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_SIZE = 5 * 1024 * 1024;

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

  const ext =
    fileType === "image/png"
      ? "png"
      : fileType === "image/webp"
        ? "webp"
        : fileType === "image/gif"
          ? "gif"
          : "jpg";

  const path = `products/${crypto.randomUUID()}.${ext}`;
  const buffer = await blob.arrayBuffer();
  const supabase = createServiceClient(c.env);

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, buffer, {
      contentType: fileType,
      upsert: false,
    });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);

  return c.json({
    path,
    url: data.publicUrl,
  });
});
