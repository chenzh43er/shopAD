import type { AddressLibrary } from "@shopad/shared";

/** 默认优先地区名称（印尼 ISO 代码） */
export const DEFAULT_REGION_NAME = "ID";

/** 无默认地区权限时的回退名称 */
export const FALLBACK_REGION_NAME = "其他";

function findByName(
  regions: AddressLibrary[],
  name: string,
): AddressLibrary | undefined {
  const target = name.trim().toLowerCase();
  return regions.find((r) => r.name.trim().toLowerCase() === target);
}

/**
 * 从当前账号可见的地区列表中选出默认筛选项：
 * 优先「ID」，无权限则「其他」，再否则取列表第一项。
 */
export function pickDefaultRegionId(
  regions: AddressLibrary[],
): string | undefined {
  if (regions.length === 0) return undefined;
  return (
    findByName(regions, DEFAULT_REGION_NAME)?.id ??
    findByName(regions, FALLBACK_REGION_NAME)?.id ??
    regions[0]?.id
  );
}
