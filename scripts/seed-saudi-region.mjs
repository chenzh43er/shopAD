/**
 * 导入沙特阿拉伯地区库（address_libraries + address_regions）
 * 用法：node scripts/seed-saudi-region.mjs
 *
 * 凭证（二选一）：
 * - DATABASE_URL（.env）
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（.env 或 workers/api/.dev.vars）
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env") });
config({ path: resolve(root, "workers/api/.dev.vars") });

const LIBRARY_NAME = "沙特阿拉伯";
const DIAL_CODE = "966";
const REMARK = "Saudi Arabia / KSA";
const INSERT_CHUNK = 400;

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!databaseUrl && !(supabaseUrl && supabaseServiceKey)) {
  console.error(
    "缺少数据库凭证：请设置 DATABASE_URL，或 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。",
  );
  process.exit(1);
}

function loadPaths() {
  const raw = readFileSync(resolve(root, "data/saudi-addresses.json"), "utf8");
  const regions = JSON.parse(raw);
  const paths = [];

  for (const region of regions) {
    for (const city of region.cities ?? []) {
      for (const district of city.districts ?? []) {
        paths.push([region.name, city.name, district]);
      }
    }
  }

  if (paths.length === 0) {
    throw new Error("saudi-addresses.json 没有可导入的路径");
  }

  return { paths, maxLevel: 3 };
}

async function insertRegionsTreePg(client, libraryId, paths, maxLevel) {
  let parentMap = new Map();
  let inserted = 0;

  for (let level = 1; level <= maxLevel; level++) {
    const unique = new Map();

    for (const path of paths) {
      if (path.length < level) continue;
      const name = path[level - 1];
      const parentKey = path.slice(0, level - 1).join("\0");
      const key = path.slice(0, level).join("\0");
      if (unique.has(key)) continue;

      const parentId = level === 1 ? null : (parentMap.get(parentKey) ?? null);
      if (level > 1 && !parentId) {
        throw new Error(
          `无法解析上级地域：${path.slice(0, level - 1).join(" / ")}`,
        );
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

    const nextMap = new Map();

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const values = [];
      const params = [];
      let paramIndex = 1;

      for (const row of chunk) {
        values.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
        );
        params.push(
          row.library_id,
          row.parent_id,
          row.name,
          row.level,
          row.sort_order,
        );
      }

      const { rows: insertedRows } = await client.query(
        `insert into public.address_regions (library_id, parent_id, name, level, sort_order)
         values ${values.join(", ")}
         returning id`,
        params,
      );

      if (insertedRows.length !== chunk.length) {
        throw new Error("写入地域节点数量不匹配");
      }

      for (let j = 0; j < chunk.length; j++) {
        nextMap.set(chunk[j].key, insertedRows[j].id);
      }
      inserted += insertedRows.length;
    }

    parentMap = nextMap;
  }

  return inserted;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function insertRegionsTreeSupabase(supabase, libraryId, paths, maxLevel) {
  let parentMap = new Map();
  let inserted = 0;

  for (let level = 1; level <= maxLevel; level++) {
    const unique = new Map();

    for (const path of paths) {
      if (path.length < level) continue;
      const name = path[level - 1];
      const parentKey = path.slice(0, level - 1).join("\0");
      const key = path.slice(0, level).join("\0");
      if (unique.has(key)) continue;

      const parentId = level === 1 ? null : (parentMap.get(parentKey) ?? null);
      if (level > 1 && !parentId) {
        throw new Error(
          `无法解析上级地域：${path.slice(0, level - 1).join(" / ")}`,
        );
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

    const nextMap = new Map();

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const payload = chunk.map(({ key, ...row }) => row);
      const { data: insertedRows, error } = await supabase
        .from("address_regions")
        .insert(payload)
        .select("id");

      if (error) throw new Error(error.message);
      if (!insertedRows || insertedRows.length !== chunk.length) {
        throw new Error("写入地域节点数量不匹配");
      }

      for (let j = 0; j < chunk.length; j++) {
        nextMap.set(chunk[j].key, insertedRows[j].id);
      }
      inserted += insertedRows.length;
    }

    parentMap = nextMap;
  }

  return inserted;
}

async function runWithPg() {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const { paths, maxLevel } = loadPaths();
    await client.query("begin");

    let libraryId;
    const existing = await client.query(
      `select id from public.address_libraries
       where lower(trim(name)) = lower(trim($1))
       limit 1`,
      [LIBRARY_NAME],
    );

    if (existing.rows[0]) {
      libraryId = existing.rows[0].id;
      await client.query(
        `update public.address_libraries
         set dial_code = $2, remark = $3, updated_at = now()
         where id = $1`,
        [libraryId, DIAL_CODE, REMARK],
      );
      await client.query(
        `delete from public.address_regions where library_id = $1`,
        [libraryId],
      );
      console.log(`更新已有地区库「${LIBRARY_NAME}」，重新导入区域…`);
    } else {
      const inserted = await client.query(
        `insert into public.address_libraries (name, dial_code, remark)
         values ($1, $2, $3)
         returning id`,
        [LIBRARY_NAME, DIAL_CODE, REMARK],
      );
      libraryId = inserted.rows[0].id;
      console.log(`已创建地区库「${LIBRARY_NAME}」`);
    }

    const regionCount = await insertRegionsTreePg(
      client,
      libraryId,
      paths,
      maxLevel,
    );

    await client.query("commit");

    const summary = await client.query(
      `select name, dial_code, remark,
              (select count(*)::int from public.address_regions r where r.library_id = l.id) as region_count,
              (select max(level)::int from public.address_regions r where r.library_id = l.id) as max_level
       from public.address_libraries l
       where l.id = $1`,
      [libraryId],
    );

    printSummary(paths.length, regionCount, summary.rows[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function runWithSupabase() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { paths, maxLevel } = loadPaths();

  const { data: libraries, error: listError } = await supabase
    .from("address_libraries")
    .select("id, name");

  if (listError) throw new Error(listError.message);

  const existing = (libraries ?? []).find(
    (row) => row.name.trim().toLowerCase() === LIBRARY_NAME.toLowerCase(),
  );

  let libraryId;
  if (existing) {
    libraryId = existing.id;
    const { error: updateError } = await supabase
      .from("address_libraries")
      .update({ dial_code: DIAL_CODE, remark: REMARK })
      .eq("id", libraryId);
    if (updateError) throw new Error(updateError.message);

    const { error: deleteError } = await supabase
      .from("address_regions")
      .delete()
      .eq("library_id", libraryId);
    if (deleteError) throw new Error(deleteError.message);

    console.log(`更新已有地区库「${LIBRARY_NAME}」，重新导入区域…`);
  } else {
    const { data: created, error: createError } = await supabase
      .from("address_libraries")
      .insert({
        name: LIBRARY_NAME,
        dial_code: DIAL_CODE,
        remark: REMARK,
      })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    libraryId = created.id;
    console.log(`已创建地区库「${LIBRARY_NAME}」`);
  }

  const regionCount = await insertRegionsTreeSupabase(
    supabase,
    libraryId,
    paths,
    maxLevel,
  );

  const { data: library, error: summaryError } = await supabase
    .from("address_libraries")
    .select("name, dial_code, remark")
    .eq("id", libraryId)
    .single();
  if (summaryError) throw new Error(summaryError.message);

  const { count, error: countError } = await supabase
    .from("address_regions")
    .select("id", { count: "exact", head: true })
    .eq("library_id", libraryId);
  if (countError) throw new Error(countError.message);

  const { data: maxLevelRow, error: maxLevelError } = await supabase
    .from("address_regions")
    .select("level")
    .eq("library_id", libraryId)
    .order("level", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxLevelError) throw new Error(maxLevelError.message);

  printSummary(paths.length, regionCount, {
    ...library,
    region_count: count ?? regionCount,
    max_level: maxLevelRow?.level ?? maxLevel,
  });
}

function printSummary(pathCount, regionCount, summary) {
  console.log("沙特阿拉伯地区导入完成：");
  console.log(`- 路径行数：${pathCount}`);
  console.log(`- 节点数：${regionCount}`);
  console.log(summary);
}

try {
  if (databaseUrl) {
    await runWithPg();
  } else {
    await runWithSupabase();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
