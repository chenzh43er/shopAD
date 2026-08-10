/** Minimal ImageData for jsquash under Workers (no DOM). */
export type WorkerImageData = {
  data: Uint8ClampedArray
  width: number
  height: number
}

declare global {
  interface ImageData {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
  }

  // eslint-disable-next-line no-var
  var ImageData: {
    new (
      data: Uint8ClampedArray,
      width: number,
      height: number,
    ): ImageData
  }
}

export {}

/** Workers 运行时无 DOM ImageData，jsquash 依赖它。 */
export function ensureImageDataPolyfill(): void {
  if (typeof globalThis.ImageData !== "undefined") return

  globalThis.ImageData = class ImageData {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number

    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data
      this.width = width
      this.height = height
    }
  }
}
