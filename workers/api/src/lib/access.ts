import type { Context } from "hono";
import type { ActorRef, UserRole } from "@shopad/shared";
import { isSuperAdmin as checkSuper } from "@shopad/shared";
import type { Env, Variables } from "../types";
import { createServiceClient } from "./supabase";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
type ServiceClient = ReturnType<typeof createServiceClient>;

export function getUserRole(c: AppContext): UserRole {
  return c.get("userRole");
}

export function isSuperAdmin(c: AppContext): boolean {
  return checkSuper(c.get("userRole"));
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
 * Scope a products list query to the current employee's owned products.
 * Returns null when the employee owns nothing (caller should return empty list).
 */
export async function scopeProductsByOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  supabase: ServiceClient,
  c: AppContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ ok: true; query: any } | { ok: false; empty: true }> {
  const owned = await listOwnedProductIds(supabase, c);
  if (owned === "all") return { ok: true, query };
  if (owned.length === 0) return { ok: false, empty: true };
  return { ok: true, query: query.in("id", owned) };
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
    .select("id, created_by")
    .eq("id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { ok: false, status: 404, error: "商品不存在" };
  if (isSuperAdmin(c)) return { ok: true, created_by: data.created_by };

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

/** Filter orders query to those whose product is owned by the employee. */
export async function applyOrderOwnerScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  supabase: ServiceClient,
  c: AppContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ ok: true; query: any } | { ok: false; empty: true }> {
  const owned = await listOwnedProductIds(supabase, c);
  if (owned === "all") return { ok: true, query };
  if (owned.length === 0) return { ok: false, empty: true };
  return { ok: true, query: query.in("product_id", owned) };
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
