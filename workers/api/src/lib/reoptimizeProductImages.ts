import { createServiceClient } from "./supabase"
import { optimizeProductImage } from "./optimizeProductImage"
import type { Env } from "../types"

export type ReoptimizeImageResult = {
  from: string
  to: string | null
  status: "replaced" | "skipped" | "failed"
  reason?: string
  bytesIn?: number
  bytesOut?: number
}

export type ReoptimizeProductResult = {
  productId: string
  cover_url?: string | null
  gallery_urls?: string[]
  detail_image_urls?: string[]
  packageUpdates: Array<{ packageId: string; image_url: string | null }>
  images: ReoptimizeImageResult[]
}

function extOfUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase()
    const m = path.match(/\.([a-z0-9]+)$/)
    return m?.[1] ?? ""
  } catch {
    return ""
  }
}

function guessContentType(url: string, headerType: string | null): string | null {
  const header = (headerType ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
  if (
    header === "image/jpeg" ||
    header === "image/png" ||
    header === "image/webp" ||
    header === "image/gif"
  ) {
    return header
  }
  const ext = extOfUrl(url)
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  return null
}

function isAlreadyOptimizedWebp(url: string, byteLength: number): boolean {
  // 新上传路径：products/{uuid}.webp 且体积已较小，跳过避免反复重写
  try {
    const path = new URL(url).pathname
    if (!path.includes("/product-images/products/")) return false
    if (!path.toLowerCase().endsWith(".webp")) return false
    return byteLength > 0 && byteLength <= 350_000
  } catch {
    return false
  }
}

async function uploadOptimized(
  supabase: ReturnType<typeof createServiceClient>,
  bytes: ArrayBuffer,
  contentType: string,
  ext: string,
): Promise<{ path: string; url: string }> {
  const path = `products/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, bytes, {
      contentType,
      upsert: false,
      cacheControl: "31536000",
    })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from("product-images").getPublicUrl(path)
  return { path, url: data.publicUrl }
}

/**
 * 下载单张图 → 压缩转 WebP → 上传新对象。
 * GIF 跳过；已较小的本桶 WebP 跳过。
 */
export async function reoptimizeImageUrl(
  env: Env,
  url: string,
): Promise<ReoptimizeImageResult> {
  const supabase = createServiceClient(env)
  if (!/^https?:\/\//i.test(url)) {
    return { from: url, to: null, status: "skipped", reason: "not-http" }
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: "image/*,*/*" },
      redirect: "follow",
    })
  } catch (error) {
    return {
      from: url,
      to: null,
      status: "failed",
      reason: error instanceof Error ? error.message : "fetch-failed",
    }
  }

  if (!response.ok) {
    return {
      from: url,
      to: null,
      status: "failed",
      reason: `http-${response.status}`,
    }
  }

  const original = await response.arrayBuffer()
  const contentType = guessContentType(url, response.headers.get("content-type"))
  if (!contentType) {
    return { from: url, to: null, status: "skipped", reason: "unknown-type" }
  }
  if (contentType === "image/gif") {
    return { from: url, to: null, status: "skipped", reason: "gif" }
  }
  if (isAlreadyOptimizedWebp(url, original.byteLength)) {
    return {
      from: url,
      to: null,
      status: "skipped",
      reason: "already-optimized",
      bytesIn: original.byteLength,
    }
  }

  try {
    const optimized = await optimizeProductImage(original, contentType)
    if (!optimized) {
      return { from: url, to: null, status: "skipped", reason: "not-optimizable" }
    }
    // 没有明显收益则不替换，避免无意义换 URL
    if (optimized.bytes.byteLength >= original.byteLength * 0.95) {
      return {
        from: url,
        to: null,
        status: "skipped",
        reason: "no-savings",
        bytesIn: original.byteLength,
        bytesOut: optimized.bytes.byteLength,
      }
    }

    const uploaded = await uploadOptimized(
      supabase,
      optimized.bytes,
      optimized.contentType,
      optimized.ext,
    )
    return {
      from: url,
      to: uploaded.url,
      status: "replaced",
      bytesIn: original.byteLength,
      bytesOut: optimized.bytes.byteLength,
    }
  } catch (error) {
    return {
      from: url,
      to: null,
      status: "failed",
      reason: error instanceof Error ? error.message : "optimize-failed",
      bytesIn: original.byteLength,
    }
  }
}

function mapUrl(
  url: string | null | undefined,
  mapping: Map<string, string>,
): string | null {
  if (!url) return null
  return mapping.get(url) ?? url
}

function mapUrlList(urls: string[], mapping: Map<string, string>): string[] {
  return urls.map((u) => mapping.get(u) ?? u)
}

/**
 * 重编码单个商品的封面/轮播/详情/套餐图，并回写数据库。
 */
export async function reoptimizeProductImages(
  env: Env,
  productId: string,
): Promise<ReoptimizeProductResult> {
  const supabase = createServiceClient(env)

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, cover_url, gallery_urls, detail_image_urls")
    .eq("id", productId)
    .maybeSingle()

  if (productError) throw new Error(productError.message)
  if (!product) throw new Error("商品不存在")

  const { data: packages, error: pkgError } = await supabase
    .from("product_packages")
    .select("id, image_url")
    .eq("product_id", productId)

  if (pkgError) throw new Error(pkgError.message)

  const gallery = Array.isArray(product.gallery_urls)
    ? (product.gallery_urls as string[])
    : []
  const details = Array.isArray(product.detail_image_urls)
    ? (product.detail_image_urls as string[])
    : []

  const uniqueUrls = [
    ...new Set(
      [
        product.cover_url as string | null,
        ...gallery,
        ...details,
        ...(packages ?? []).map((p) => p.image_url as string | null),
      ].filter((u): u is string => Boolean(u && String(u).trim())),
    ),
  ]

  const images: ReoptimizeImageResult[] = []
  const mapping = new Map<string, string>()

  for (const url of uniqueUrls) {
    const result = await reoptimizeImageUrl(env, url)
    images.push(result)
    if (result.status === "replaced" && result.to) {
      mapping.set(url, result.to)
    }
  }

  const patch: Record<string, unknown> = {}
  const nextCover = mapUrl(product.cover_url, mapping)
  const nextGallery = mapUrlList(gallery, mapping)
  const nextDetails = mapUrlList(details, mapping)

  if (nextCover !== product.cover_url) patch.cover_url = nextCover
  if (JSON.stringify(nextGallery) !== JSON.stringify(gallery)) {
    patch.gallery_urls = nextGallery
  }
  if (JSON.stringify(nextDetails) !== JSON.stringify(details)) {
    patch.detail_image_urls = nextDetails
  }

  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await supabase
      .from("products")
      .update(patch)
      .eq("id", productId)
    if (updateError) throw new Error(updateError.message)
  }

  const packageUpdates: ReoptimizeProductResult["packageUpdates"] = []
  for (const pkg of packages ?? []) {
    const next = mapUrl(pkg.image_url, mapping)
    if (next !== pkg.image_url) {
      const { error } = await supabase
        .from("product_packages")
        .update({ image_url: next })
        .eq("id", pkg.id)
      if (error) throw new Error(error.message)
      packageUpdates.push({ packageId: pkg.id, image_url: next })
    }
  }

  return {
    productId,
    cover_url: nextCover,
    gallery_urls: nextGallery,
    detail_image_urls: nextDetails,
    packageUpdates,
    images,
  }
}
