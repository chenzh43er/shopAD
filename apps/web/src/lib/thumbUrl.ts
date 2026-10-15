/** R2 自定义图片域（与落地页共用同一个桶） */
const R2_IMAGE_HOSTS = ["img.acomedia.work"];

/**
 * 列表缩略图：R2 图按约定 products[/...]/thumbs/{uuid}.webp 取小图，
 * 不存在时调用方 onError 回退原图；非 R2 / GIF 直接返回原图。
 */
export function thumbUrlFor(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!R2_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return url;
    }
    if (/\.gif(\?|#|$)/i.test(u.pathname)) return url;
    const m = u.pathname.match(/^(.*\/products)\/([^/]+)\.(webp|jpg|jpeg|png)$/i);
    if (!m) return url;
    return `${u.origin}${m[1]}/thumbs/${m[2]}.webp`;
  } catch {
    return url;
  }
}
