/**
 * 生成一批多状态测试订单（挂 Ceraglow 商品）
 * 用法：node scripts/insert-test-orders.mjs [数量，默认 40]
 */
import { config } from 'dotenv'
import pg from 'pg'

config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is missing.')
  process.exit(1)
}

const COUNT = Math.max(1, Number(process.argv[2] || 40))
const LINK_SUFFIX = 'ceraglow-youth-cream-bpom-bl62-65'
const ORDER_PREFIX = 'TEST'

const customers = [
  { name: 'Siti Nurhaliza', phone: '081234567801', province: 'Jawa Barat', city: 'Kota Bekasi', district: 'Bekasi Utara', detail: 'Jl. Pondok Ungu No. 12, Harapan Jaya' },
  { name: 'Rina Marlina', phone: '081234567802', province: 'Jawa Barat', city: 'Kota Bandung', district: 'Coblong', detail: 'Jl. Ir. H. Juanda No. 88' },
  { name: 'Dewi Lestari', phone: '081234567803', province: 'Jawa Timur', city: 'Kota Surabaya', district: 'Gubeng', detail: 'Jl. Dharmawangsa No. 45' },
  { name: 'Ayu Puspita', phone: '081234567804', province: 'DI Yogyakarta', city: 'Kota Yogyakarta', district: 'Gondokusuman', detail: 'Jl. Affandi No. 21' },
  { name: 'Fitri Handayani', phone: '081234567805', province: 'Jawa Barat', city: 'Kota Bekasi', district: 'Bekasi Selatan', detail: 'Jl. Ahmad Yani No. 7' },
  { name: 'Maya Sari', phone: '081234567806', province: 'DKI Jakarta', city: 'Jakarta Selatan', district: 'Kebayoran Baru', detail: 'Jl. Senopati No. 33' },
  { name: 'Indah Permata', phone: '081234567807', province: 'Jawa Tengah', city: 'Kota Semarang', district: 'Candisari', detail: 'Jl. Teuku Umar No. 19' },
  { name: 'Putri Amanda', phone: '081234567808', province: 'Banten', city: 'Kota Tangerang', district: 'Cipondoh', detail: 'Jl. KH Hasyim Ashari No. 56' },
  { name: 'Budi Santoso', phone: '081234567809', province: 'DKI Jakarta', city: 'Jakarta Timur', district: 'Cakung', detail: 'Jl. Raya Bekasi No. 101' },
  { name: 'Andi Wijaya', phone: '081234567810', province: 'Jawa Barat', city: 'Kota Depok', district: 'Beji', detail: 'Jl. Margonda Raya No. 55' },
  { name: 'Sri Wahyuni', phone: '081234567811', province: 'Sumatera Utara', city: 'Kota Medan', district: 'Medan Baru', detail: 'Jl. Gatot Subroto No. 77' },
  { name: 'Agus Pratama', phone: '081234567812', province: 'Bali', city: 'Kota Denpasar', district: 'Denpasar Selatan', detail: 'Jl. Bypass Ngurah Rai No. 9' },
  { name: 'Lina Kartika', phone: '081234567813', province: 'Jawa Timur', city: 'Kota Malang', district: 'Lowokwaru', detail: 'Jl. Soekarno Hatta No. 210' },
  { name: 'Hendra Gunawan', phone: '081234567814', province: 'Sulawesi Selatan', city: 'Kota Makassar', district: 'Panakkukang', detail: 'Jl. Boulevard No. 18' },
  { name: 'Nur Aini', phone: '081234567815', province: 'Jawa Barat', city: 'Kabupaten Bogor', district: 'Cibinong', detail: 'Jl. Raya Jakarta No. 42' },
]

/** 覆盖全部可测状态；权重偏向前端列表里更常测的 COD 流程 */
const SCENARIOS = [
  { status: 'awaiting_review', payment_type: 'cod', review_status: 'pending', payment_method: '货到付款', weight: 8 },
  { status: 'awaiting_shipment', payment_type: 'cod', review_status: 'approved', payment_method: '货到付款', weight: 6 },
  { status: 'cod_shipped', payment_type: 'cod', review_status: 'approved', payment_method: '货到付款', weight: 4, shipped: true },
  { status: 'cod_completed', payment_type: 'cod', review_status: 'approved', payment_method: '货到付款', weight: 3, shipped: true },
  { status: 'cod_refused', payment_type: 'cod', review_status: 'approved', payment_method: '货到付款', weight: 3, shipped: true },
  { status: 'cancelled', payment_type: 'cod', review_status: 'rejected', payment_method: '货到付款', weight: 3, reject: true },
  { status: 'pending', payment_type: 'non_cod', review_status: 'not_required', payment_method: '在线支付', weight: 2 },
  { status: 'paid', payment_type: 'non_cod', review_status: 'not_required', payment_method: '在线支付', weight: 2 },
  { status: 'shipped', payment_type: 'non_cod', review_status: 'not_required', payment_method: '月结', weight: 2, shipped: true },
  { status: 'completed', payment_type: 'non_cod', review_status: 'not_required', payment_method: '月结', weight: 2, shipped: true },
  { status: 'cancelled', payment_type: 'non_cod', review_status: 'not_required', payment_method: '在线支付', weight: 1, reject: true },
]

const REJECT_REASONS = [
  '电话无人接听',
  '地址不详无法派送',
  '客户取消订单',
  '重复下单',
  '虚假订单',
]

const OWNERS = ['测试员', '小李', '小王', '运营A', '运营B']

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pickWeighted(items) {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

function shippingFee() {
  return pick([0, 0, 10000, 12000, 15000, 18000])
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
})

await client.connect()
try {
  const productRes = await client.query(
    `
    select id, name, sku_code, price, weight
    from public.products
    where link_suffix = $1
    limit 1
    `,
    [LINK_SUFFIX],
  )
  const product = productRes.rows[0]
  if (!product) {
    throw new Error(`Product not found: ${LINK_SUFFIX}`)
  }

  const pkgRes = await client.query(
    `
    select id, name, name_external, original_price, discount_price
    from public.product_packages
    where product_id = $1 and is_visible = true
    order by sort_order
    `,
    [product.id],
  )
  if (pkgRes.rows.length === 0) {
    throw new Error('No packages found for product')
  }
  const packages = pkgRes.rows

  const stamp = Date.now().toString(36).toUpperCase()
  const inserted = []

  // 先保证每种状态至少 1 条，再按权重填满
  const scenarioQueue = []
  for (const s of SCENARIOS) scenarioQueue.push(s)
  while (scenarioQueue.length < COUNT) scenarioQueue.push(pickWeighted(SCENARIOS))
  // 打乱顺序，避免状态成块出现
  for (let i = scenarioQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[scenarioQueue[i], scenarioQueue[j]] = [scenarioQueue[j], scenarioQueue[i]]
  }

  await client.query('begin')

  for (let i = 0; i < COUNT; i++) {
    const c = customers[i % customers.length]
    const pkg = pick(packages)
    const scenario = scenarioQueue[i]
    const quantity = pick([1, 1, 1, 2])
    const unitPrice = Number(pkg.discount_price ?? pkg.original_price ?? product.price)
    const total = unitPrice * quantity
    const fee = shippingFee()
    const orderNo = `${ORDER_PREFIX}-${stamp}-${String(i + 1).padStart(3, '0')}`
    const address = `${c.detail}, ${c.district}, ${c.city}, ${c.province}`
    const owner = scenario.payment_type === 'cod' && scenario.review_status === 'pending'
      ? null
      : pick(OWNERS)
    const shippingOrderNo = scenario.shipped
      ? `26${stamp.slice(-8)}${String(i + 1).padStart(4, '0')}`
      : null
    const rejectReason = scenario.reject ? pick(REJECT_REASONS) : null
    const remark = [
      `批量测试单 #${i + 1}`,
      scenario.payment_type === 'cod' ? 'COD' : '非COD',
      scenario.status,
    ].join(' / ')

    const row = await client.query(
      `
      insert into public.orders (
        order_no,
        customer_name,
        customer_phone,
        shipping_address,
        shipping_province,
        shipping_city,
        shipping_district,
        shipping_detail,
        total_amount,
        status,
        remark,
        owner_member,
        shipping_order_no,
        payment_method,
        payment_type,
        review_status,
        reject_reason,
        cod_amount,
        express_type,
        shipping_fee,
        other_fee,
        package_count,
        weight,
        insurance_type,
        insurance_flag,
        item_value,
        item_category,
        item_type,
        product_id,
        product_name,
        package_id,
        package_name,
        package_name_external,
        unit_price,
        quantity,
        sku_code,
        created_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, 'EZ', $19, 0, 1, $20,
        case when $21 then 'BASIC' else null end,
        case when $21 then 'Y' else null end,
        $9, '美妆护肤', 'BARANG',
        $22, $23, $24, $25, $26, $27, $28, $29,
        now() - ($30 || ' hours')::interval
      )
      returning order_no, customer_name, status, payment_type, review_status, total_amount, package_name
      `,
      [
        orderNo,
        c.name,
        c.phone,
        address,
        c.province,
        c.city,
        c.district,
        c.detail,
        total,
        scenario.status,
        remark,
        owner,
        shippingOrderNo,
        scenario.payment_method,
        scenario.payment_type,
        scenario.review_status,
        rejectReason,
        scenario.payment_type === 'cod' ? total : null,
        fee,
        Number(product.weight ?? 0.3) * quantity,
        Boolean(scenario.shipped),
        product.id,
        product.name,
        pkg.id,
        pkg.name,
        pkg.name_external,
        unitPrice,
        quantity,
        product.sku_code,
        String(Math.floor(Math.random() * 72)),
      ],
    )
    inserted.push(row.rows[0])
  }

  await client.query('commit')

  const summary = {}
  for (const o of inserted) {
    const key = `${o.payment_type}/${o.status}/${o.review_status}`
    summary[key] = (summary[key] || 0) + 1
  }

  console.log(`Inserted ${inserted.length} test orders for ${product.name}`)
  console.log('=== by status ===')
  console.table(
    Object.entries(summary)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, n]) => {
        const [payment_type, status, review_status] = k.split('/')
        return { payment_type, status, review_status, n }
      }),
  )
  console.log('=== sample ===')
  console.table(
    inserted.slice(0, 12).map((o) => ({
      order_no: o.order_no,
      customer: o.customer_name,
      package: o.package_name,
      total: o.total_amount,
      status: o.status,
      payment: o.payment_type,
      review: o.review_status,
    })),
  )
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error(err)
  process.exit(1)
} finally {
  await client.end()
}
