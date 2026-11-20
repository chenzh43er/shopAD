/**
 * 一次性把现有地址库压成 tree-fees-v3.json 上传到 product-locales，
 * 让店面地区下拉走 CDN 快照而不是冷扫 address_regions。
 *
 * Usage: node scripts/publish-region-tree-snapshots.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    const key = trimmed.slice(0, i).trim()
    const value = trimmed.slice(i + 1).trim()
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}
loadEnvFile(path.join(repoRoot, '.env'))
loadEnvFile(path.join(repoRoot, 'workers/api/.dev.vars'))
loadEnvFile(path.join(repoRoot, 'apps/web/.env'))

const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const BUCKET = 'product-locales'
const FILE = 'tree-fees-v3.json'

function parseTreeFee(raw) {
  if (raw == null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function buildCompactRegionTree(rows) {
  const districtsByCity = new Map()
  const citiesByProvince = new Map()
  const provinceOrder = []

  for (const row of rows) {
    if (row.level === 1 && row.parent_id == null) {
      provinceOrder.push({ id: row.id, name: row.name })
    } else if (row.level === 3 && row.parent_id) {
      const entry = {
        name: row.name,
        fee: parseTreeFee(row.actual_shipping_fee),
      }
      const list = districtsByCity.get(row.parent_id)
      if (list) list.push(entry)
      else districtsByCity.set(row.parent_id, [entry])
    }
  }

  for (const row of rows) {
    if (row.level === 2 && row.parent_id) {
      const entries = districtsByCity.get(row.id) ?? []
      const names = entries.map((e) => e.name)
      const fees = entries.map((e) => e.fee)
      const hasFee = fees.some((f) => f != null)
      const city = hasFee ? [row.name, names, fees] : [row.name, names]
      const list = citiesByProvince.get(row.parent_id)
      if (list) list.push(city)
      else citiesByProvince.set(row.parent_id, [city])
    }
  }

  return provinceOrder.map((p) => [p.name, citiesByProvince.get(p.id) ?? []])
}

async function fetchAllRows(supabase, libraryId) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('address_regions')
      .select('id, parent_id, name, level, actual_shipping_fee, sort_order')
      .eq('library_id', libraryId)
      .gte('level', 1)
      .lte('level', 3)
      .order('level', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .range(from, to)
    if (error) throw new Error(error.message)
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < pageSize) break
  }
  return rows
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: libs, error: libErr } = await supabase
  .from('address_libraries')
  .select('id, name')
  .order('name')
if (libErr) throw new Error(libErr.message)

for (const lib of libs ?? []) {
  const t0 = Date.now()
  const rows = await fetchAllRows(supabase, lib.id)
  const tree = buildCompactRegionTree(rows)
  const snapshot = {
    v: 3,
    libraryId: lib.id,
    updatedAt: new Date().toISOString(),
    tree,
  }
  const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8')
  const objectPath = `addresses/${lib.id}/${FILE}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, bytes, {
      contentType: 'application/json',
      upsert: true,
      cacheControl: '3600',
    })
  if (upErr) {
    console.error('FAIL', lib.name, lib.id, upErr.message)
    continue
  }
  console.log(
    JSON.stringify({
      name: lib.name,
      id: lib.id,
      rows: rows.length,
      provinces: tree.length,
      bytes: bytes.length,
      ms: Date.now() - t0,
      path: objectPath,
    }),
  )
}
