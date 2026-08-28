import type { Context } from "hono";

import type { ActorRef, UserRole } from "@shopad/shared";

import { isSuperAdmin as checkSuper } from "@shopad/shared";

import type { Env, Variables } from "../types";

import { createServiceClient } from "./supabase";



type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Worker isolate 内短时缓存，减轻员工列表重复的 Auth / 权限查询 */
const SCOPE_CACHE_TTL_MS = 60_000;

type ScopeCacheEntry<T> = { value: T; expiresAt: number };

const regionIdsCache = new Map<string, ScopeCacheEntry<string[] | "all">>();
const accessibleProductsCache = new Map<string, ScopeCacheEntry<string[] | "all">>();

function readScopeCache<T>(
  cache: Map<string, ScopeCacheEntry<T>>,
  key: string,
): T | null {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.value;
}

function writeScopeCache<T>(
  cache: Map<string, ScopeCacheEntry<T>>,
  key: string,
  value: T,
): void {
  cache.set(key, { value, expiresAt: Date.now() + SCOPE_CACHE_TTL_MS });
}

export function parseRegionIdsFromMetadata(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as Record<string, unknown>).region_ids;
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}


export function getUserRole(c: AppContext): UserRole {

  return c.get("userRole");

}



export function isSuperAdmin(c: AppContext): boolean {

  return checkSuper(c.get("userRole"));

}



/** Load region ids assigned to current employee (empty => no regions). */

export async function listAllowedRegionIds(

  supabase: ServiceClient,

  c: AppContext,

): Promise<string[] | "all"> {

  if (isSuperAdmin(c)) return "all";

  const userId = c.get("userId");
  const cached = readScopeCache(regionIdsCache, userId);
  if (cached !== null) return cached;

  const { data, error } = await supabase.auth.admin.getUserById(userId);

  if (error) throw new Error(error.message);

  const regions = parseRegionIdsFromMetadata(data.user?.user_metadata);
  writeScopeCache(regionIdsCache, userId, regions);
  return regions;

}



export async function assertRegionAccess(

  supabase: ServiceClient,

  regionId: string | null,

  c: AppContext,

): Promise<{ ok: true } | { ok: false; error: string }> {

  if (isSuperAdmin(c)) return { ok: true };

  if (!regionId) {

    return { ok: false, error: "无权操作未分配地区的商品" };

  }

  const allowed = await listAllowedRegionIds(supabase, c);

  if (allowed === "all") return { ok: true };

  if (!allowed.includes(regionId)) {

    return { ok: false, error: "无权操作该地区的商品" };

  }

  return { ok: true };

}



/** Load product ids owned by current employee (empty => no owned products). */

export async function listOwnedProductIds(

  supabase: ServiceClient,

  c: AppContext,

): Promise<string[] | "all"> {

  if (isSuperAdmin(c)) return "all";

  const { data, error } = await supabase

    .from("product_owners")

    .select("product_id")

    .eq("profile_id", c.get("userId"));

  if (error) throw new Error(error.message);

  return [...new Set((data ?? []).map((row) => row.product_id as string))];

}



/**

 * Owned products intersected with allowed regions.

 * Employees with no region or no owned products get [].

 */

export async function listAccessibleProductIds(

  supabase: ServiceClient,

  c: AppContext,

): Promise<string[] | "all"> {

  if (isSuperAdmin(c)) return "all";



  const userId = c.get("userId");

  const cached = readScopeCache(accessibleProductsCache, userId);

  if (cached !== null) return cached;



  const [allowedRegions, owned] = await Promise.all([

    listAllowedRegionIds(supabase, c),

    listOwnedProductIds(supabase, c),

  ]);



  if (allowedRegions === "all") {

    writeScopeCache(accessibleProductsCache, userId, owned);

    return owned;

  }

  if (allowedRegions.length === 0) {

    writeScopeCache(accessibleProductsCache, userId, []);

    return [];

  }

  if (owned === "all") {

    writeScopeCache(accessibleProductsCache, userId, "all");

    return "all";

  }

  if (owned.length === 0) {

    writeScopeCache(accessibleProductsCache, userId, []);

    return [];

  }



  const { data, error } = await supabase

    .from("products")

    .select("id")

    .in("id", owned)

    .in("region_id", allowedRegions);

  if (error) throw new Error(error.message);



  const accessible = [

    ...new Set((data ?? []).map((row) => row.id as string)),

  ];

  writeScopeCache(accessibleProductsCache, userId, accessible);

  return accessible;

}



/**

 * Scope a products list query to the current employee's accessible products.

 * Returns null when the employee has nothing accessible (caller should return empty list).

 */

export async function scopeProductsByOwner(

  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  query: any,

  supabase: ServiceClient,

  c: AppContext,

  // eslint-disable-next-line @typescript-eslint/no-explicit-any

): Promise<{ ok: true; query: any } | { ok: false; empty: true }> {

  const accessible = await listAccessibleProductIds(supabase, c);

  if (accessible === "all") return { ok: true, query };

  if (accessible.length === 0) return { ok: false, empty: true };

  return { ok: true, query: query.in("id", accessible) };

}



export async function assertProductAccess(

  supabase: ServiceClient,

  productId: string,

  c: AppContext,

): Promise<

  | { ok: true; created_by: string | null }

  | { ok: false; status: 403 | 404; error: string }

> {

  const { data, error } = await supabase

    .from("products")

    .select("id, created_by, region_id")

    .eq("id", productId)

    .maybeSingle();



  if (error) throw new Error(error.message);

  if (!data) return { ok: false, status: 404, error: "商品不存在" };

  if (isSuperAdmin(c)) return { ok: true, created_by: data.created_by };



  const regionAccess = await assertRegionAccess(

    supabase,

    data.region_id as string | null,

    c,

  );

  if (!regionAccess.ok) {

    return { ok: false, status: 403, error: regionAccess.error };

  }



  const { data: ownership, error: ownErr } = await supabase

    .from("product_owners")

    .select("product_id")

    .eq("product_id", productId)

    .eq("profile_id", c.get("userId"))

    .maybeSingle();

  if (ownErr) throw new Error(ownErr.message);

  if (!ownership) {

    return { ok: false, status: 403, error: "无权操作该商品" };

  }

  return { ok: true, created_by: data.created_by };

}



export async function assertOrderAccess(

  supabase: ServiceClient,

  order: { id: string; product_id: string | null },

  c: AppContext,

): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {

  if (isSuperAdmin(c)) return { ok: true };

  if (!order.product_id) {

    return { ok: false, status: 403, error: "无权操作该订单" };

  }

  const access = await assertProductAccess(supabase, order.product_id, c);

  if (!access.ok) {

    return { ok: false, status: 403, error: "无权操作该订单" };

  }

  return { ok: true };

}



/** Pre-load employee product accessibility once for batch order operations. */

export type OrderAccessChecker = {

  check: (

    order: { id: string; product_id: string | null },

  ) => { ok: true } | { ok: false; error: string };

};



export async function createOrderAccessChecker(

  supabase: ServiceClient,

  c: AppContext,

): Promise<OrderAccessChecker> {

  if (isSuperAdmin(c)) {

    return { check: () => ({ ok: true }) };

  }

  const accessible = await listAccessibleProductIds(supabase, c);

  if (accessible === "all") {

    return { check: () => ({ ok: true }) };

  }

  const accessibleSet = new Set(accessible);

  return {

    check(order) {

      if (!order.product_id) {

        return { ok: false, error: "无权操作该订单" };

      }

      if (!accessibleSet.has(order.product_id)) {

        return { ok: false, error: "无权操作该订单" };

      }

      return { ok: true };

    },

  };

}



/** Filter orders query to those whose product is accessible by the employee. */

export async function applyOrderOwnerScope(

  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  query: any,

  supabase: ServiceClient,

  c: AppContext,

  // eslint-disable-next-line @typescript-eslint/no-explicit-any

): Promise<{ ok: true; query: any } | { ok: false; empty: true }> {

  const accessible = await listAccessibleProductIds(supabase, c);

  if (accessible === "all") return { ok: true, query };

  if (accessible.length === 0) return { ok: false, empty: true };

  return { ok: true, query: query.in("product_id", accessible) };

}



type RowWithOwners = Record<string, unknown> & {

  id: string;

  owner_ids?: string[];

  owners?: ActorRef[];

};



/** Attach owner_ids + owners (ActorRef[]) onto product rows. */

export async function attachProductOwners<T extends RowWithOwners>(

  supabase: ServiceClient,

  rows: T[],

): Promise<T[]> {

  if (rows.length === 0) return rows;



  const productIds = rows.map((r) => r.id);

  const { data: links, error } = await supabase

    .from("product_owners")

    .select("product_id, profile_id")

    .in("product_id", productIds);

  if (error) {

    console.error("attachProductOwners failed:", error.message);

    return rows.map((row) => ({

      ...row,

      owner_ids: row.owner_ids ?? [],

      owners: row.owners ?? [],

    }));

  }



  const byProduct = new Map<string, string[]>();

  const profileIds = new Set<string>();

  for (const link of links ?? []) {

    const pid = link.product_id as string;

    const uid = link.profile_id as string;

    if (!byProduct.has(pid)) byProduct.set(pid, []);

    byProduct.get(pid)!.push(uid);

    profileIds.add(uid);

  }



  const profileMap = new Map<string, ActorRef>();

  if (profileIds.size > 0) {

    const { data: profiles, error: pErr } = await supabase

      .from("profiles")

      .select("id, display_name")

      .in("id", [...profileIds]);

    if (pErr) {

      console.error("attachProductOwners profiles failed:", pErr.message);

    } else {

      for (const p of profiles ?? []) {

        profileMap.set(p.id, {

          id: p.id,

          display_name: p.display_name ?? null,

        });

      }

    }

  }



  return rows.map((row) => {

    const ownerIds = byProduct.get(row.id) ?? [];

    return {

      ...row,

      owner_ids: ownerIds,

      owners: ownerIds.map(

        (id) => profileMap.get(id) ?? { id, display_name: null },

      ),

    };

  });

}



export async function attachProductOwnersOne<T extends RowWithOwners>(

  supabase: ServiceClient,

  row: T | null,

): Promise<T | null> {

  if (!row) return null;

  const [next] = await attachProductOwners(supabase, [row]);

  return next ?? null;

}



/** Replace all owners for a product. */

export async function syncProductOwners(

  supabase: ServiceClient,

  productId: string,

  ownerIds: string[],

  actorId: string,

): Promise<{ ok: true } | { ok: false; error: string }> {

  const unique = [...new Set(ownerIds.filter(Boolean))];

  const { error: delErr } = await supabase

    .from("product_owners")

    .delete()

    .eq("product_id", productId);

  if (delErr) return { ok: false, error: delErr.message };



  if (unique.length === 0) return { ok: true };



  const { error: insErr } = await supabase.from("product_owners").insert(

    unique.map((profile_id) => ({

      product_id: productId,

      profile_id,

      created_by: actorId,

    })),

  );

  if (insErr) return { ok: false, error: insErr.message };

  return { ok: true };

}



/** Load region ids for multiple profiles (from auth user_metadata). */
export async function loadProfileRegionIds(
  supabase: ServiceClient,
  profileIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (profileIds.length === 0) return result;

  for (const profileId of profileIds) {
    const { data, error } = await supabase.auth.admin.getUserById(profileId);
    if (error) throw new Error(error.message);
    result.set(profileId, parseRegionIdsFromMetadata(data.user?.user_metadata));
  }

  return result;
}

/** Replace all region permissions for a profile (stored in auth user_metadata). */
export async function syncProfileRegions(
  supabase: ServiceClient,
  profileId: string,
  regionIds: string[],
  _actorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unique = [...new Set(regionIds.filter(Boolean))];

  if (unique.length > 0) {
    const { data: libs, error: libErr } = await supabase
      .from("address_libraries")
      .select("id")
      .in("id", unique);
    if (libErr) return { ok: false, error: libErr.message };
    const found = new Set((libs ?? []).map((row) => row.id as string));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) {
      return { ok: false, error: "所选地区不存在" };
    }
  }

  const { data: existing, error: getErr } =
    await supabase.auth.admin.getUserById(profileId);
  if (getErr || !existing.user) {
    return { ok: false, error: getErr?.message ?? "用户不存在" };
  }

  const currentMeta =
    (existing.user.user_metadata as Record<string, unknown> | undefined) ?? {};
  const { error: updErr } = await supabase.auth.admin.updateUserById(
    profileId,
    {
      user_metadata: {
        ...currentMeta,
        region_ids: unique,
      },
    },
  );
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}


