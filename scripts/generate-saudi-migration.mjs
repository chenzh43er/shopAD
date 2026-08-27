/**
 * 从 data/saudi-addresses.json 生成 Supabase 迁移 SQL
 * 用法：node scripts/generate-saudi-migration.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY_NAME = "沙特阿拉伯";
const DIAL_CODE = "966";
const REMARK = "Saudi Arabia / KSA";
const OUT_PATH = resolve(
  root,
  "supabase/migrations/20260827010000_saudi_address_library.sql",
);

const regions = JSON.parse(
  readFileSync(resolve(root, "data/saudi-addresses.json"), "utf8"),
);

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

/** @param {string} s */
const esc = (s) => s.replace(/'/g, "''");

const valueRows = paths
  .map((p) => `    ('${p.map(esc).join("','")}')`)
  .join(",\n");

const sql = `-- 沙特阿拉伯地区库（${paths.length} 条三级地址路径，区号 966）
-- 由 scripts/generate-saudi-migration.mjs 生成，源数据：data/saudi-addresses.json

do $$
declare
  v_library_id uuid;
  v_library_name constant text := '${esc(LIBRARY_NAME)}';
begin
  select id into v_library_id
  from public.address_libraries
  where lower(trim(name)) = lower(trim(v_library_name))
  limit 1;

  if v_library_id is null then
    insert into public.address_libraries (name, dial_code, remark)
    values (v_library_name, '${DIAL_CODE}', '${esc(REMARK)}')
    returning id into v_library_id;
  else
    update public.address_libraries
    set dial_code = '${DIAL_CODE}',
        remark = '${esc(REMARK)}',
        updated_at = now()
    where id = v_library_id;

    delete from public.address_regions where library_id = v_library_id;
  end if;

  create temp table _saudi_paths (
    l1 text not null,
    l2 text not null,
    l3 text not null
  ) on commit drop;

  insert into _saudi_paths (l1, l2, l3) values
${valueRows};

  insert into public.address_regions (library_id, parent_id, name, level, sort_order)
  select
    v_library_id,
    null,
    d.l1,
    1,
    (row_number() over (order by d.l1) - 1)::int
  from (select distinct l1 from _saudi_paths) d;

  insert into public.address_regions (library_id, parent_id, name, level, sort_order)
  select
    v_library_id,
    p.id,
    d.l2,
    2,
    (row_number() over (partition by d.l1 order by d.l2) - 1)::int
  from (select distinct l1, l2 from _saudi_paths) d
  join public.address_regions p
    on p.library_id = v_library_id
   and p.level = 1
   and p.name = d.l1;

  insert into public.address_regions (library_id, parent_id, name, level, sort_order)
  select
    v_library_id,
    p.id,
    sp.l3,
    3,
    (row_number() over (partition by sp.l1, sp.l2 order by sp.l3) - 1)::int
  from _saudi_paths sp
  join public.address_regions p
    on p.library_id = v_library_id
   and p.level = 2
   and p.name = sp.l2
  join public.address_regions p1
    on p1.id = p.parent_id
   and p1.level = 1
   and p1.name = sp.l1;
end $$;
`;

writeFileSync(OUT_PATH, sql, "utf8");
console.log(`已生成迁移：${OUT_PATH}`);
console.log(`- 路径行数：${paths.length}`);
