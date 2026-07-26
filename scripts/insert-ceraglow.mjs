import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import pg from 'pg'

config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is missing.')
  process.exit(1)
}

const sql = readFileSync(resolve('scripts/insert-ceraglow.sql'), 'utf8')
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  await client.query(sql)
  const product = await client.query(`
    select id, name, link_suffix, price, status, packages_enabled, cover_url,
           cardinality(gallery_urls) as gallery_count,
           cardinality(detail_image_urls) as detail_count
    from public.products
    where link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
  `)
  const packages = await client.query(`
    select pp.name, pp.name_external, pp.original_price, pp.discount_price, i.quantity
    from public.product_packages pp
    join public.products p on p.id = pp.product_id
    left join public.product_package_items i on i.package_id = pp.id
    where p.link_suffix = 'ceraglow-youth-cream-bpom-bl62-65'
    order by pp.sort_order
  `)
  console.log('Product:', product.rows[0])
  console.log('Packages:', packages.rows)
} finally {
  await client.end()
}
