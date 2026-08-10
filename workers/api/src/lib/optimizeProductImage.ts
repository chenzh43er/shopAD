import decodeJpeg, { init as initJpegWasm } from "@jsquash/jpeg/decode"
import decodePng, { init as initPngWasm } from "@jsquash/png/decode"
import decodeWebp, { init as initWebpDecode } from "@jsquash/webp/decode"
import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode"
import resize, { initResize } from "@jsquash/resize"

import JPEG_DEC_WASM from "../assets/wasm/mozjpeg_dec.wasm"
import PNG_DEC_WASM from "../assets/wasm/squoosh_png_bg.wasm"
import WEBP_DEC_WASM from "../assets/wasm/webp_dec.wasm"
import WEBP_ENC_WASM from "../assets/wasm/webp_enc_simd.wasm"
import RESIZE_WASM from "../assets/wasm/squoosh_resize_bg.wasm"

import { ensureImageDataPolyfill } from "./imageDataPolyfill"

/** 商品图最长边（封面/轮播/详情均适用） */
export const PRODUCT_IMAGE_MAX_EDGE = 1600
/** WebP 质量：清晰度与体积折中 */
export const PRODUCT_IMAGE_WEBP_QUALITY = 78

export type OptimizedProductImage = {
  bytes: ArrayBuffer
  contentType: "image/webp"
  ext: "webp"
  width: number
  height: number
}

type DecodableType = "image/jpeg" | "image/png" | "image/webp"

let codecsReady: Promise<void> | null = null

async function initCodecs(): Promise<void> {
  if (!codecsReady) {
    codecsReady = (async () => {
      ensureImageDataPolyfill()
      await Promise.all([
        initJpegWasm(JPEG_DEC_WASM as never),
        initPngWasm(PNG_DEC_WASM as never),
        initWebpDecode(WEBP_DEC_WASM as never),
        initWebpEncode(WEBP_ENC_WASM as never),
        initResize(RESIZE_WASM as never),
      ])
    })()
  }
  await codecsReady
}

function canOptimize(contentType: string): contentType is DecodableType {
  return (
    contentType === "image/jpeg" ||
    contentType === "image/png" ||
    contentType === "image/webp"
  )
}

function scaleDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const edge = Math.max(width, height)
  if (edge <= maxEdge) return { width, height }
  const scale = maxEdge / edge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function decodeImage(
  buffer: ArrayBuffer,
  contentType: DecodableType,
): Promise<ImageData> {
  if (contentType === "image/jpeg") return decodeJpeg(buffer)
  if (contentType === "image/png") return decodePng(buffer)
  return decodeWebp(buffer)
}

/**
 * 将 JPEG/PNG/WebP 缩放并编码为 WebP。
 * GIF 不处理（保留动画），由调用方原样上传。
 */
export async function optimizeProductImage(
  buffer: ArrayBuffer,
  contentType: string,
  opts?: { maxEdge?: number; quality?: number },
): Promise<OptimizedProductImage | null> {
  if (!canOptimize(contentType)) return null

  const maxEdge = opts?.maxEdge ?? PRODUCT_IMAGE_MAX_EDGE
  const quality = opts?.quality ?? PRODUCT_IMAGE_WEBP_QUALITY

  await initCodecs()

  let image = await decodeImage(buffer, contentType)
  const target = scaleDimensions(image.width, image.height, maxEdge)
  if (target.width !== image.width || target.height !== image.height) {
    image = await resize(image, {
      width: target.width,
      height: target.height,
      method: "lanczos3",
      fitMethod: "stretch",
    })
  }

  const encoded = await encodeWebp(image, { quality })
  let bytes: ArrayBuffer
  if (encoded instanceof ArrayBuffer) {
    bytes = encoded
  } else {
    const view = encoded as Uint8Array
    bytes = view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    ) as ArrayBuffer
  }

  return {
    bytes,
    contentType: "image/webp",
    ext: "webp",
    width: image.width,
    height: image.height,
  }
}
