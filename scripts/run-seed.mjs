import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import pg from 'pg'

config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is missing. Set it in .env before seeding.')
  process.exit(1)
}

const sqlPath = resolve('supabase/seed.sql')
const sql = readFileSync(sqlPath, 'utf8')

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  await client.query(sql)
  const summary = await client.query(`
    select 'products' as t, count(*)::int as n from public.products
    union all select 'packages', count(*)::int from public.product_packages
    union all select 'package_items', count(*)::int from public.product_package_items
    union all select 'orders', count(*)::int from public.orders
    union all select 'demo_orders', count(*)::int from public.orders where order_no like 'DEMO-%'
    union all select 'shippers', count(*)::int from public.logistics_shipper
    union all select 'audit_logs', count(*)::int from public.audit_logs
    order by t
  `)
  console.log('Seed completed.')
  for (const row of summary.rows) {
    console.log(`- ${row.t}: ${row.n}`)
  }
} finally {
  await client.end()
}
