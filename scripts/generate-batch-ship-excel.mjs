import { config } from 'dotenv'
import pg from 'pg'
import * as XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

config()

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'scripts', 'fixtures')
const outPath = path.join(outDir, 'batch-ship-test.xlsx')

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
})

await client.connect()
try {
  const { rows } = await client.query(`
    select order_no
    from public.orders
    where payment_type = 'cod'
      and status = 'awaiting_shipment'
      and review_status = 'approved'
    order by updated_at desc
    limit 20
  `)

  if (rows.length === 0) {
    console.error('没有待发货 COD 订单，无法生成测试 Excel。')
    process.exit(1)
  }

  const stamp = Date.now().toString().slice(-8)
  const data = [
    ['订单号', '运单号'],
    ...rows.map((r, i) => [
      r.order_no,
      `WB${stamp}${String(i + 1).padStart(3, '0')}`,
    ]),
  ]

  const sheet = XLSX.utils.aoa_to_sheet(data)
  sheet['!cols'] = [{ wch: 28 }, { wch: 20 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, '批量发货')

  fs.mkdirSync(outDir, { recursive: true })
  XLSX.writeFile(wb, outPath)

  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
  console.table(
    data.slice(1).map(([order_no, shipping_order_no]) => ({
      order_no,
      shipping_order_no,
    })),
  )
} finally {
  await client.end()
}
