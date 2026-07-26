/**
 * 从库中取待发货 COD 订单，生成批量发货测试 txt（订单号 + 运单号）
 * 用法：node scripts/generate-batch-ship-txt.mjs [数量，默认 20]
 */
import { config } from 'dotenv'
import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

config()

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'scripts', 'fixtures')
const outPath = path.join(outDir, 'batch-ship-test.txt')
const limit = Math.max(1, Math.min(200, Number(process.argv[2] || 20)))

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
})

await client.connect()
try {
  const { rows } = await client.query(
    `
    select order_no
    from public.orders
    where payment_type = 'cod'
      and status = 'awaiting_shipment'
      and review_status = 'approved'
    order by updated_at desc
    limit $1
  `,
    [limit],
  )

  if (rows.length === 0) {
    console.error('没有待发货 COD 订单，无法生成测试 txt。')
    console.error('可先运行：node scripts/insert-test-orders.mjs')
    process.exit(1)
  }

  const stamp = Date.now().toString().slice(-8)
  const lines = [
    '订单号\t运单号',
    ...rows.map(
      (r, i) =>
        `${r.order_no}\tWB${stamp}${String(i + 1).padStart(3, '0')}`,
    ),
  ]

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8')

  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
  console.table(
    rows.map((r, i) => ({
      order_no: r.order_no,
      shipping_order_no: `WB${stamp}${String(i + 1).padStart(3, '0')}`,
    })),
  )
} finally {
  await client.end()
}
