/** 商品列表路径；带 region_id 以便返回时保持地区筛选 */
export function productsListPath(regionId?: string | null): string {
  if (!regionId) return "/products";
  const params = new URLSearchParams({ region_id: regionId });
  return `/products?${params.toString()}`;
}

/** 新建商品路径；可预填列表当前地区 */
export function productNewPath(regionId?: string | null): string {
  if (!regionId) return "/products/new";
  const params = new URLSearchParams({ region_id: regionId });
  return `/products/new?${params.toString()}`;
}
