/**
 * 生成 Ceraglow 待审核 COD 测试订单
 * 用法：node scripts/insert-ceraglow-pending-orders.mjs
 */
import { config } from 'dotenv'
import pg from 'pg'

config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is missing.')
  process.exit(1)
}

const LINK_SUFFIX = 'ceraglow-youth-cream-bpom-bl62-65'
const ORDER_PREFIX = 'CGLOW-PENDING'

const customers = [
  {
    name: 'Siti Nurhaliza',
    phone: '081234567801',
    province: 'Jawa Barat',
    city: 'Kota Bekasi',
    district: 'Bekasi Utara',
    detail: 'Jl. Pondok Ungu No. 12, Harapan Jaya',
  },
  {
    name: 'Rina Marlina',
    phone: '081234567802',
    province: 'Jawa Barat',
    city: 'Kota Bandung',
    district: 'Coblong',
    detail: 'Jl. Ir. H. Juanda No. 88',
  },
  {
    name: 'Dewi Lestari',
    phone: '081234567803',
    province: 'Jawa Timur',
    city: 'Kota Surabaya',
    district: 'Gubeng',
    detail: 'Jl. Dharmawangsa No. 45',
  },
  {
    name: 'Ayu Puspita',
    phone: '081234567804',
    province: 'DI Yogyakarta',
    city: 'Kota Yogyakarta',
    district: 'Gondokusuman',
    detail: 'Jl. Affandi No. 21',
  },
  {
    name: 'Fitri Handayani',
    phone: '081234567805',
    province: 'Jawa Barat',
    city: 'Kota Bekasi',
    district: 'Bekasi Selatan',
    detail: 'Jl. Ahmad Yani No. 7',
  },
  {
    name: 'Maya Sari',
    phone: '081234567806',
    province: 'DKI Jakarta',
    city: 'Jakarta Selatan',
    district: 'Kebayoran Baru',
    detail: 'Jl. Senopati No. 33',
  },
  {
    name: 'Indah Permata',
    phone: '081234567807',
    province: 'Jawa Tengah',
    city: 'Kota Semarang',
    district: 'Candisari',
    detail: 'Jl. Teuku Umar No. 19',
  },
  {
    name: 'Putri Amanda',
    phone: '081234567808',
    province: 'Banten',
    city: 'Kota Tangerang',
    district: 'Cipondoh',
    detail: 'Jl. KH Hasyim Ashari No. 56',
  },
]

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
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
    throw new Error('No packages found for Ceraglow product')
  }

  const packages = pkgRes.rows
  const stamp = Date.now().toString(36).toUpperCase()
  const inserted = []

  await client.query('begin')

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]
    const pkg = pick(packages)
    const quantity = 1
    const unitPrice = Number(pkg.discount_price ?? pkg.original_price ?? product.price)
    const total = unitPrice * quantity
    const shippingFee = [0, 0, 10000, 12000, 15000][Math.floor(Math.random() * 5)]
    const orderNo = `${ORDER_PREFIX}-${stamp}-${String(i + 1).padStart(2, '0')}`
    const address = `${c.detail}, ${c.district}, ${c.city}, ${c.province}`

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
        payment_method,
        payment_type,
        review_status,
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
        sku_code
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, 'awaiting_review', $10, '测试员', '货到付款', 'cod', 'pending',
        $9, 'EZ', $11, 0, 1, $12,
        null, null, $9, '美妆护肤', 'BARANG',
        $13, $14, $15, $16, $17, $18, $19, $20
      )
      returning order_no, customer_name, package_name, unit_price, total_amount, status, review_status
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
        `Ceraglow 待审核测试单 #${i + 1}`,
        shippingFee,
        Number(product.weight ?? 0.3),
        product.id,
        product.name,
        pkg.id,
        pkg.name,
        pkg.name_external,
        unitPrice,
        quantity,
        product.sku_code,
      ],
    )
    inserted.push(row.rows[0])
  }

  await client.query('commit')
  console.log(`Inserted ${inserted.length} pending-review orders for ${product.name}`)
  console.table(
    inserted.map((o) => ({
      order_no: o.order_no,
      customer: o.customer_name,
      package: o.package_name,
      unit_price: o.unit_price,
      total: o.total_amount,
      status: o.status,
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
