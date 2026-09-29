/**
 * 导入沙特阿拉伯双语地区库
 * - 默认主表（/sa）：阿拉伯语
 * - 覆盖语言 en（/sa_en）：英语 → Storage product-locales/addresses/{id}/en.json
 *
 * 用法：node scripts/seed-saudi-region.mjs
 *
 * 凭证（二选一写入地区树）：
 * - DATABASE_URL（.env）
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（.env 或 workers/api/.dev.vars）
 *
 * 英语覆盖写入 Storage 必须有 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
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
config({ path: resolve(root, "../product-1/.env.local") });

const LIBRARY_NAME = "沙特阿拉伯";
/** 线上可能已用「SA」作库名；按区号 966 优先匹配，避免新建重复库 */
const LIBRARY_NAME_ALIASES = ["沙特阿拉伯", "SA", "Saudi Arabia", "Saudi", "KSA"];
const DIAL_CODE = "966";
const REMARK = "Saudi Arabia / KSA · 默认阿语 + en 英语覆盖";
const INSERT_CHUNK = 400;
const LOCALE_BUCKET = "product-locales";
const EN_LOCALE = "en";
const EN_LABEL = "英语";

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!databaseUrl && !(supabaseUrl && supabaseServiceKey)) {
  console.error(
    "缺少数据库凭证：请设置 DATABASE_URL，或 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。",
  );
  process.exit(1);
}

if (!(supabaseUrl && supabaseServiceKey)) {
  console.error(
    "英语覆盖需要 Storage：请设置 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。",
  );
  process.exit(1);
}

function districtPair(district) {
  if (typeof district === "string") {
    return { ar: district, en: district };
  }
  const ar = String(district?.name ?? "").trim();
  const en = String(district?.name_en ?? district?.name ?? "").trim();
  if (!ar || !en) {
    throw new Error(`地区条目缺少 name/name_en：${JSON.stringify(district)}`);
  }
  return { ar, en };
}

function loadBilingualPaths() {
  const raw = readFileSync(resolve(root, "data/saudi-addresses.json"), "utf8");
  const regions = JSON.parse(raw);
  const arPaths = [];
  const enPaths = [];

  for (const region of regions) {
    const regionAr = String(region.name ?? "").trim();
    const regionEn = String(region.name_en ?? "").trim();
    if (!regionAr || !regionEn) {
      throw new Error(`区域缺少 name/name_en：${JSON.stringify(region)}`);
    }
    for (const city of region.cities ?? []) {
      const cityAr = String(city.name ?? "").trim();
      const cityEn = String(city.name_en ?? "").trim();
      if (!cityAr || !cityEn) {
        throw new Error(`城市缺少 name/name_en：${JSON.stringify(city)}`);
      }
      for (const district of city.districts ?? []) {
        const { ar, en } = districtPair(district);
        arPaths.push([regionAr, cityAr, ar]);
        enPaths.push([regionEn, cityEn, en]);
      }
    }
  }

  if (arPaths.length === 0) {
    throw new Error("saudi-addresses.json 没有可导入的路径");
  }
  if (arPaths.length !== enPaths.length) {
    throw new Error("阿语/英语路径行数不一致");
  }

  return { arPaths, enPaths, maxLevel: 3 };
}

/** 默认阿语路径 key → 英语节点名 */
function buildEnNames(arLeaves, enLeaves) {
  const names = {};
  for (let i = 0; i < arLeaves.length; i++) {
    const d = arLeaves[i];
    const t = enLeaves[i];
    if (t.length !== d.length) {
      throw new Error(
        `第 ${i + 1} 行级数不一致：阿语 ${d.length} / 英语 ${t.length}`,
      );
    }
    for (let j = 0; j < d.length; j++) {
      const key = d.slice(0, j + 1).join("\0");
      names[key] = t[j];
    }
  }
  return names;
}

async function uploadEnglishLocale(supabase, libraryId, names) {
  const path = `addresses/${libraryId}/${EN_LOCALE}.json`;
  const body = {
    label: EN_LABEL,
    names,
    updated_at: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const { error } = await supabase.storage
    .from(LOCALE_BUCKET)
    .upload(path, bytes, {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`上传英语覆盖失败：${error.message}`);
  return { path, nameKeys: Object.keys(names).length };
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
      const payload = chunk.map(({ key: _k, ...row }) => row);
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

async function upsertLibraryPg(client) {
  let libraryId;
  const byDial = await client.query(
    `select id, name from public.address_libraries
     where dial_code = $1
     order by updated_at asc
     limit 1`,
    [DIAL_CODE],
  );

  const byName = await client.query(
    `select id, name from public.address_libraries
     where lower(trim(name)) = any($1::text[])
     order by updated_at asc
     limit 1`,
    [LIBRARY_NAME_ALIASES.map((n) => n.toLowerCase())],
  );

  const existing = byDial.rows[0] ?? byName.rows[0];

  if (existing) {
    libraryId = existing.id;
    await client.query(
      `update public.address_libraries
       set remark = $2, updated_at = now()
       where id = $1`,
      [libraryId, REMARK],
    );
    await client.query(
      `delete from public.address_regions where library_id = $1`,
      [libraryId],
    );
    console.log(
      `更新已有地区库「${existing.name}」(${libraryId})，重新导入阿语区域…`,
    );
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
  return libraryId;
}

async function upsertLibrarySupabase(supabase) {
  const { data: libraries, error: listError } = await supabase
    .from("address_libraries")
    .select("id, name, dial_code, updated_at")
    .order("updated_at", { ascending: true });

  if (listError) throw new Error(listError.message);

  const aliasSet = new Set(
    LIBRARY_NAME_ALIASES.map((n) => n.trim().toLowerCase()),
  );
  const byDial = (libraries ?? []).find((row) => row.dial_code === DIAL_CODE);
  const byName = (libraries ?? []).find((row) =>
    aliasSet.has(String(row.name ?? "").trim().toLowerCase()),
  );
  const existing = byDial ?? byName;

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

    console.log(
      `更新已有地区库「${existing.name}」(${libraryId})，重新导入阿语区域…`,
    );
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
  return libraryId;
}

async function runWithPg(supabase) {
  const { arPaths, enPaths, maxLevel } = loadBilingualPaths();
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query("begin");
    const libraryId = await upsertLibraryPg(client);
    const regionCount = await insertRegionsTreePg(
      client,
      libraryId,
      arPaths,
      maxLevel,
    );
    await client.query("commit");

    const names = buildEnNames(arPaths, enPaths);
    const uploaded = await uploadEnglishLocale(supabase, libraryId, names);

    const summary = await client.query(
      `select name, dial_code, remark,
              (select count(*)::int from public.address_regions r where r.library_id = l.id) as region_count,
              (select max(level)::int from public.address_regions r where r.library_id = l.id) as max_level
       from public.address_libraries l
       where l.id = $1`,
      [libraryId],
    );

    printSummary(arPaths.length, regionCount, summary.rows[0], uploaded);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function runWithSupabase(supabase) {
  const { arPaths, enPaths, maxLevel } = loadBilingualPaths();
  const libraryId = await upsertLibrarySupabase(supabase);

  const regionCount = await insertRegionsTreeSupabase(
    supabase,
    libraryId,
    arPaths,
    maxLevel,
  );

  const names = buildEnNames(arPaths, enPaths);
  const uploaded = await uploadEnglishLocale(supabase, libraryId, names);

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

  printSummary(arPaths.length, regionCount, {
    ...library,
    region_count: count ?? regionCount,
    max_level: maxLevelRow?.level ?? maxLevel,
  }, uploaded);
}

function printSummary(pathCount, regionCount, summary, uploaded) {
  console.log("沙特阿拉伯双语地区导入完成：");
  console.log(`- 默认语言：阿拉伯语（主表）`);
  console.log(`- 覆盖语言：英语 en → ${uploaded.path}`);
  console.log(`- 路径行数：${pathCount}`);
  console.log(`- 节点数：${regionCount}`);
  console.log(`- 英语译名 key 数：${uploaded.nameKeys}`);
  console.log(summary);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  if (databaseUrl) {
    await runWithPg(supabase);
  } else {
    await runWithSupabase(supabase);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
