import type { ActorRef, AuditEntityType } from "@shopad/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditActor = {
  id: string;
  email?: string;
  name?: string | null;
};

export type WriteAuditInput = {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actor: AuditActor;
  fromValue?: string | null;
  toValue?: string | null;
  changes?: Record<string, unknown> | null;
  remark?: string | null;
};

export async function writeAuditLog(
  supabase: SupabaseClient,
  input: WriteAuditInput,
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    actor_id: input.actor.id,
    actor_name: input.actor.name ?? null,
    actor_email: input.actor.email ?? null,
    from_value: input.fromValue ?? null,
    to_value: input.toValue ?? null,
    changes: input.changes ?? null,
    remark: input.remark ?? null,
  });

  if (error) {
    console.error("writeAuditLog failed:", error.message);
  }
}

export async function listAuditLogs(
  supabase: SupabaseClient,
  entityType: AuditEntityType,
  entityId: string,
) {
  return supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(100);
}

type RowWithActors = Record<string, unknown> & {
  created_by?: string | null;
  updated_by?: string | null;
  reviewed_by?: string | null;
  creator?: ActorRef | null;
  updater?: ActorRef | null;
  reviewer?: ActorRef | null;
};

/**
 * Manually join profiles onto rows.
 * Avoids PostgREST embed which requires FKs in schema cache.
 */
export async function attachActors<T extends RowWithActors>(
  supabase: SupabaseClient,
  rows: T[],
  fields: Array<"created_by" | "updated_by" | "reviewed_by"> = [
    "created_by",
    "updated_by",
    "reviewed_by",
  ],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const ids = new Set<string>();
  for (const row of rows) {
    for (const field of fields) {
      const id = row[field];
      if (typeof id === "string" && id) ids.add(id);
    }
  }

  const profileMap = new Map<string, ActorRef>();
  if (ids.size > 0) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", [...ids]);
    if (error) {
      console.error("attachActors profiles lookup failed:", error.message);
    } else {
      for (const p of data ?? []) {
        profileMap.set(p.id, {
          id: p.id,
          display_name: p.display_name ?? null,
        });
      }
    }
  }

  return rows.map((row) => {
    const next: RowWithActors = { ...row };
    if (fields.includes("created_by")) {
      next.creator = row.created_by
        ? (profileMap.get(row.created_by) ?? null)
        : null;
    }
    if (fields.includes("updated_by")) {
      next.updater = row.updated_by
        ? (profileMap.get(row.updated_by) ?? null)
        : null;
    }
    if (fields.includes("reviewed_by")) {
      next.reviewer = row.reviewed_by
        ? (profileMap.get(row.reviewed_by) ?? null)
        : null;
    }
    return next as T;
  });
}

export async function attachActorsOne<T extends RowWithActors>(
  supabase: SupabaseClient,
  row: T | null,
  fields?: Array<"created_by" | "updated_by" | "reviewed_by">,
): Promise<T | null> {
  if (!row) return null;
  const [withActors] = await attachActors(supabase, [row], fields);
  return withActors ?? row;
}
