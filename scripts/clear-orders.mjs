/**
 * 清空全部订单及相关审计日志
 * 用法：node scripts/clear-orders.mjs
 */
import { config } from 'dotenv'
import pg from 'pg'

config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is missing.')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
})

await client.connect()
try {
  const before = await client.query('select count(*)::int as n from public.orders')
  console.log('orders before:', before.rows[0].n)

  await client.query(`delete from public.audit_logs where entity_type = 'order'`)
  await client.query('truncate table public.orders restart identity cascade')

  const after = await client.query('select count(*)::int as n from public.orders')
  console.log('orders after clear:', after.rows[0].n)
  console.log('OK: all orders cleared')
} finally {
  await client.end()
}
