import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const line of fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const i = trimmed.indexOf('=')
  if (i < 0) continue
  const key = trimmed.slice(0, i).trim()
  const value = trimmed.slice(i + 1).trim()
  if (key && process.env[key] === undefined) process.env[key] = value
}

const sql = `
create index if not exists address_regions_library_tree_idx
  on public.address_regions (library_id, level, sort_order, name)
  where level between 1 and 3;

create index if not exists address_regions_library_level_name_idx
  on public.address_regions (library_id, level, name);

drop index if exists public.address_regions_library_level_idx;
`

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
})
await client.connect()
await client.query(sql)
const indexes = await client.query(`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'address_regions'
  ORDER BY indexname
`)
console.log(indexes.rows.map((r) => r.indexname).join('\n'))
await client.end()
