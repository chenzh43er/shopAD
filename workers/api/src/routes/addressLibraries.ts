import { Hono } from "hono";
import type {
  AddressLibrary,
  CreateAddressLibraryInput,
  ImportAddressLibraryInput,
  UpdateAddressLibraryInput,
} from "@shopad/shared";
import { createServiceClient } from "../lib/supabase";
import { requireSuperAdmin } from "../middleware/auth";
import type { Env, Variables } from "../types";

const MAX_LIBRARY_NAME = 120;
const MAX_REGION_NAME = 120;
const MAX_LEVELS = 12;
const MAX_PATHS = 50000;
const INSERT_CHUNK = 400;

type RegionRow = {
  id: string;
  library_id: string;
  parent_id: string | null;
  name: string;
  level: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type LibraryRow = {
  id: string;
  name: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

function trimName(value: unknown, field: string, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  if (t.length > max) {
    throw new Error(`${field}不能超过 ${max} 个字符`);
  }
  return t;
}

function normalizePaths(
  paths: unknown,
): { ok: true; paths: string[][]; maxLevel: number } | { ok: false; error: string } {
  if (!Array.isArray(paths)) {
    return { ok: false, error: "paths 必须是数组" };
  }
  if (paths.length === 0) {
    return { ok: false, error: "导入数据为空" };
  }
  if (paths.length > MAX_PATHS) {
    return { ok: false, error: `单次最多导入 ${MAX_PATHS} 条` };
  }

  const normalized: string[][] = [];
  let maxLevel = 0;

  for (let i = 0; i < paths.length; i++) {
    const row = paths[i];
    if (!Array.isArray(row)) {
      return { ok: false, error: `第 ${i + 1} 行格式无效` };
    }
    const parts: string[] = [];
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const name =
        typeof cell === "string"
          ? cell.trim()
          : typeof cell === "number"
            ? String(cell).trim()
            : "";
      if (!name) {
        // 允许尾部空列，中间空列则截断
        break;
      }
      if (name.length > MAX_REGION_NAME) {
        return {
          ok: false,
          error: `第 ${i + 1} 行地域名称过长（>${MAX_REGION_NAME}）`,
        };
      }
      parts.push(name);
    }
    if (parts.length === 0) continue;
    if (parts.length > MAX_LEVELS) {
      return {
        ok: false,
        error: `第 ${i + 1} 行超过最大支持级数 ${MAX_LEVELS}`,
      };
    }
    maxLevel = Math.max(maxLevel, parts.length);
    normalized.push(parts);
  }

  if (normalized.length === 0) {
    return { ok: false, error: "没有有效的地域行" };
  }

  return { ok: true, paths: normalized, maxLevel };
}

async function summarizeLibrary(
  supabase: ReturnType<typeof createServiceClient>,
  library: LibraryRow,
): Promise<AddressLibrary> {
  const { count, error: countError } = await supabase
    .from("address_regions")
    .select("id", { count: "exact", head: true })
    .eq("library_id", library.id);

  if (countError) throw new Error(countError.message);

  const { data: levelRows, error: levelError } = await supabase
    .from("address_regions")
    .select("level")
    .eq("library_id", library.id)
    .order("level", { ascending: false })
    .limit(1);

  if (levelError) throw new Error(levelError.message);

  return {
    id: library.id,
    name: library.name,
    remark: library.remark ?? null,
    max_level: levelRows?.[0]?.level ?? 0,
    region_count: count ?? 0,
    created_at: library.created_at,
    updated_at: library.updated_at,
  };
}

async function insertRegionsTree(
  supabase: ReturnType<typeof createServiceClient>,
  libraryId: string,
  paths: string[][],
  maxLevel: number,
): Promise<number> {
  // parentKey (joined path of ancestors) -> id
  let parentMap = new Map<string, string>();
  let inserted = 0;

  for (let level = 1; level <= maxLevel; level++) {
    const unique = new Map<
      string,
      { parentId: string | null; name: string; sortOrder: number }
    >();

    for (const path of paths) {
      if (path.length < level) continue;
      const name = path[level - 1]!;
      const parentKey = path.slice(0, level - 1).join("\0");
      const key = path.slice(0, level).join("\0");
      if (unique.has(key)) continue;

      const parentId =
        level === 1 ? null : (parentMap.get(parentKey) ?? null);
      if (level > 1 && !parentId) {
        throw new Error(`无法解析上级地域：${path.slice(0, level - 1).join(" / ")}`);
      }

      unique.set(key, {
        parentId,
        name,
        sortOrder: unique.size,
      });
    }

    const rows = [...unique.entries()].map(([key, v]) => ({
      key,
      library_id: libraryId,
      parent_id: v.parentId,
      name: v.name,
      level,
      sort_order: v.sortOrder,
    }));

    const nextMap = new Map<string, string>();

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const { data, error } = await supabase
        .from("address_regions")
        .insert(
          chunk.map(({ library_id, parent_id, name, level: lv, sort_order }) => ({
            library_id,
            parent_id,
            name,
            level: lv,
            sort_order,
          })),
        )
        .select("id");

      if (error) throw new Error(error.message);
      const ids = data ?? [];
      if (ids.length !== chunk.length) {
        throw new Error("写入地域节点数量不匹配");
      }
      for (let j = 0; j < chunk.length; j++) {
        nextMap.set(chunk[j]!.key, ids[j]!.id as string);
      }
      inserted += ids.length;
    }

    parentMap = nextMap;
  }

  return inserted;
}

function buildLeafPaths(regions: RegionRow[]): {
  id: string;
  path: string[];
  level: number;
}[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const children = new Map<string | null, RegionRow[]>();
  for (const r of regions) {
    const key = r.parent_id;
    const list = children.get(key) ?? [];
    list.push(r);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }

  const leaves: { id: string; path: string[]; level: number }[] = [];

  const walk = (node: RegionRow, prefix: string[]) => {
    const path = [...prefix, node.name];
    const kids = children.get(node.id) ?? [];
    if (kids.length === 0) {
      leaves.push({ id: node.id, path, level: node.level });
      return;
    }
    for (const kid of kids) walk(kid, path);
  };

  for (const root of children.get(null) ?? []) {
    walk(root, []);
  }

  // 防御节点若无子节点已作为叶子；保证与 byId 无悬空
  void byId;
  return leaves;
}

export const addressLibrariesRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

addressLibrariesRoutes.get("/", async (c) => {
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("address_libraries")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);

  const libraries: AddressLibrary[] = [];
  for (const row of (data ?? []) as LibraryRow[]) {
    libraries.push(await summarizeLibrary(supabase, row));
  }

  return c.json({ data: libraries, total: libraries.length });
});

addressLibrariesRoutes.post("/", requireSuperAdmin, async (c) => {
  let name: string;
  let remark: string | null = null;
  try {
    const body = (await c.req.json()) as CreateAddressLibraryInput;
    const parsed = trimName(body.name, "地区名称", MAX_LIBRARY_NAME);
    if (!parsed) return c.json({ error: "地区名称不能为空" }, 400);
    name = parsed;
    if (body.remark !== undefined && body.remark !== null) {
      if (typeof body.remark !== "string") {
        return c.json({ error: "备注格式无效" }, 400);
      }
      const t = body.remark.trim();
      if (t.length > 500) return c.json({ error: "备注不能超过 500 个字符" }, 400);
      remark = t || null;
    }
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "请求无效" },
      400,
    );
  }

  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("address_libraries")
    .insert({ name, remark })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "该地区名称已存在" }, 409);
    }
    return c.json({ error: error.message }, 500);
  }

  return c.json(await summarizeLibrary(supabase, data as LibraryRow), 201);
});

/** 向已有地区导入 / 覆盖地域树（须在 /:id 通配之前注册） */
addressLibrariesRoutes.post("/:id/import", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  let body: { paths?: unknown };
  try {
    body = (await c.req.json()) as { paths?: unknown };
  } catch {
    return c.json({ error: "请求体无效" }, 400);
  }

  const normalized = normalizePaths(body.paths);
  if (!normalized.ok) return c.json({ error: normalized.error }, 400);

  const supabase = createServiceClient(c.env);
  const { data: existing, error: findError } = await supabase
    .from("address_libraries")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (findError) return c.json({ error: findError.message }, 500);
  if (!existing) return c.json({ error: "地区不存在" }, 404);

  const { error: delError } = await supabase
    .from("address_regions")
    .delete()
    .eq("library_id", id);
  if (delError) return c.json({ error: delError.message }, 500);

  // 触碰 updated_at
  const { data: library, error: touchError } = await supabase
    .from("address_libraries")
    .update({ name: (existing as LibraryRow).name })
    .eq("id", id)
    .select("*")
    .single();
  if (touchError) return c.json({ error: touchError.message }, 500);

  try {
    const regionCount = await insertRegionsTree(
      supabase,
      id,
      normalized.paths,
      normalized.maxLevel,
    );
    const summary = await summarizeLibrary(supabase, library as LibraryRow);
    return c.json({
      library: summary,
      imported_paths: normalized.paths.length,
      region_count: regionCount,
      max_level: normalized.maxLevel,
    });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "导入失败" },
      500,
    );
  }
});

/** 全量导入：按地区名称 upsert，覆盖该库全部地域（须在 /:id 之前注册） */
addressLibrariesRoutes.post("/import", requireSuperAdmin, async (c) => {
  let body: ImportAddressLibraryInput;
  try {
    body = (await c.req.json()) as ImportAddressLibraryInput;
  } catch {
    return c.json({ error: "请求体无效" }, 400);
  }

  let name: string;
  try {
    const parsed = trimName(body.name, "地区名称", MAX_LIBRARY_NAME);
    if (!parsed) return c.json({ error: "请填写地区名称" }, 400);
    name = parsed;
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "请求无效" },
      400,
    );
  }

  const normalized = normalizePaths(body.paths);
  if (!normalized.ok) return c.json({ error: normalized.error }, 400);

  const supabase = createServiceClient(c.env);

  // 按名称查找（大小写不敏感）
  const { data: existingList, error: findError } = await supabase
    .from("address_libraries")
    .select("*");

  if (findError) return c.json({ error: findError.message }, 500);

  const existing = ((existingList ?? []) as LibraryRow[]).find(
    (row) => row.name.trim().toLowerCase() === name.toLowerCase(),
  );

  let library: LibraryRow;
  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("address_libraries")
      .update({ name })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updateError) return c.json({ error: updateError.message }, 500);
    library = updated as LibraryRow;

    const { error: delError } = await supabase
      .from("address_regions")
      .delete()
      .eq("library_id", library.id);
    if (delError) return c.json({ error: delError.message }, 500);
  } else {
    const { data: created, error: createError } = await supabase
      .from("address_libraries")
      .insert({ name })
      .select("*")
      .single();
    if (createError) {
      if (createError.code === "23505") {
        return c.json({ error: "该地区名称已存在，请重试" }, 409);
      }
      return c.json({ error: createError.message }, 500);
    }
    library = created as LibraryRow;
  }

  try {
    const regionCount = await insertRegionsTree(
      supabase,
      library.id,
      normalized.paths,
      normalized.maxLevel,
    );
    const summary = await summarizeLibrary(supabase, library);
    return c.json({
      library: summary,
      imported_paths: normalized.paths.length,
      region_count: regionCount,
      max_level: normalized.maxLevel,
    });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "导入失败" },
      500,
    );
  }
});

addressLibrariesRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("address_libraries")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "地区不存在" }, 404);
  return c.json(await summarizeLibrary(supabase, data as LibraryRow));
});

addressLibrariesRoutes.patch("/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const patch: Record<string, unknown> = {};
  try {
    const body = (await c.req.json()) as UpdateAddressLibraryInput;
    if (body.name !== undefined) {
      const parsed = trimName(body.name, "地区名称", MAX_LIBRARY_NAME);
      if (!parsed) return c.json({ error: "地区名称不能为空" }, 400);
      patch.name = parsed;
    }
    if (body.remark !== undefined) {
      if (body.remark === null) {
        patch.remark = null;
      } else if (typeof body.remark !== "string") {
        return c.json({ error: "备注格式无效" }, 400);
      } else {
        const t = body.remark.trim();
        if (t.length > 500) {
          return c.json({ error: "备注不能超过 500 个字符" }, 400);
        }
        patch.remark = t || null;
      }
    }
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "请求无效" },
      400,
    );
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "没有可更新的字段" }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("address_libraries")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "该地区名称已存在" }, 409);
    }
    return c.json({ error: error.message }, 500);
  }
  if (!data) return c.json({ error: "地区不存在" }, 404);
  return c.json(await summarizeLibrary(supabase, data as LibraryRow));
});

addressLibrariesRoutes.delete("/:id", requireSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from("address_libraries")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "地区不存在" }, 404);
  return c.json({ ok: true });
});

addressLibrariesRoutes.get("/:id/regions", async (c) => {
  const id = c.req.param("id");
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, Number(c.req.query("pageSize") ?? 50) || 50),
  );

  const supabase = createServiceClient(c.env);
  const { data: library, error: libError } = await supabase
    .from("address_libraries")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (libError) return c.json({ error: libError.message }, 500);
  if (!library) return c.json({ error: "地区不存在" }, 404);

  // PostgREST 默认有行数上限；分页拉取全部节点
  const all: RegionRow[] = [];
  const fetchSize = 1000;
  for (let from = 0; ; from += fetchSize) {
    const { data, error } = await supabase
      .from("address_regions")
      .select("*")
      .eq("library_id", id)
      .order("level", { ascending: true })
      .order("sort_order", { ascending: true })
      .range(from, from + fetchSize - 1);

    if (error) return c.json({ error: error.message }, 500);
    const chunk = (data ?? []) as RegionRow[];
    all.push(...chunk);
    if (chunk.length < fetchSize) break;
  }

  let leaves = buildLeafPaths(all);
  if (q) {
    const needle = q.toLowerCase();
    leaves = leaves.filter((leaf) =>
      leaf.path.some((part) => part.toLowerCase().includes(needle)),
    );
  }

  const total = leaves.length;
  const start = (page - 1) * pageSize;
  const pageRows = leaves.slice(start, start + pageSize);
  const maxLevel = all.reduce((m, r) => Math.max(m, r.level), 0);

  return c.json({
    data: pageRows,
    total,
    page,
    pageSize,
    max_level: maxLevel,
  });
});
