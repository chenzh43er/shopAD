/**
 * 导入阿拉伯语测试商品到 shopAD（Supabase）
 * 用法：pnpm insert:garden-hose-ar
 *
 * 凭证（二选一）：
 * - DATABASE_URL（shopAD/.env 或 product-2/.env.local）
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（workers/api/.dev.vars）
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env") });
config({ path: resolve(root, "workers/api/.dev.vars") });
config({ path: resolve(root, "../product-2/.env.local") });

const LINK_SUFFIX = "anbob-ry-alhdyk-alkabl-lltmdd";
const IMG =
  "https://cdn.youcan.shop/stores/ce723d2c520c644d8521d2d165afc79e";

const PRODUCT = {
  name: "أنبوب ري الحديقة القابل للتمدد",
  title_external: "أنبوب ري الحديقة القابل للتمدد",
  description:
    "أنبوب ري الحديقة القابل للتمدد\n\nExpandable Garden Hose Pipe",
  price: 99,
  cover_url: `${IMG}/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png`,
  status: "on_sale",
  sku_code: "DJ-0592",
  sku_display: "Garden Hose Expandable",
  weight: 0.8,
  link_suffix: LINK_SUFFIX,
  packages_enabled: true,
  sales_count: 0,
  gallery_urls: [
    `${IMG}/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png`,
    `${IMG}/products/OrzuMQE0snxbNdx4UYHvSee9rsCcMZL8V277vfEn.webp`,
    `${IMG}/products/MzzzV65FyNoMfnaQsGBCuBCsY6oTAu4XEmxtYJ0F.jpg`,
    `${IMG}/products/OvI8UTcD9xSGWeqbKLXI835NAeyB8xxkh4CxQ3DS.webp`,
    `${IMG}/products/zCKob1hn2pC1rr4u2wP3EhDACQ7eEutYMgGTtCml.webp`,
  ],
  detail_image_urls: [
    `${IMG}/others/Mir2pGCAbl8N5NNCaRSj47zcbPlK87NcDO5ejEUO.png`,
    `${IMG}/others/GN9TpiCPdVWgoRn7l3hAM8PAgQDXUurZrZapNufJ.png`,
    `${IMG}/others/ZkQPUiuWCw6Cx7uxdJ7ZFwGpo7Z0JOOGkekfB11L.gif`,
    `${IMG}/others/q5MZhP7nlsrdPcPNez90xrGvrRt57EgJe2b72qf6.png`,
    `${IMG}/others/o7JXHiY5e88ceQQVyX0mRwuia26DP4rlh2uS8ATB.gif`,
    `${IMG}/others/YcJZVAtA7LQdFCaMWjN8WYDxPMsEe5H8SeCCjkP5.png`,
    `${IMG}/others/EXjZYEf0NOqhBaFjP3Xp8pcqJjgc62CrRxwzjycX.png`,
  ],
  description_entries: [
    "خرطوم قابل للتمدد حتى 3 أضعاف طوله الأصلي",
    "رأس رش متعدد الأنماط للري والتنظيف",
    "خفيف الوزن وسهل التخزين",
    "توصيل مجاني — الدفع عند الاستلام",
  ],
};

const PACKAGES = [
  {
    name: "خرطوم 30 متر",
    name_external: "خرطوم حديقة قابل للتمدد (30 مترًا)",
    original_price: 219,
    discount_price: 99,
    sort_order: 0,
    image_url: `${IMG}/products/NQNBxPmRNMbXHRnoEaC8X8VMlkqrHUT6BzO5g36B.png`,
    sku: "DJ-0592",
  },
  {
    name: "خرطوم 15 متر",
    name_external: "خرطوم حديقة قابل للتمدd (15 مترًا)".replace(
      "للتمدd",
      "للتمدد",
    ),
    original_price: 219,
    discount_price: 99,
    sort_order: 1,
    image_url: `${IMG}/products/51GNWUbvzNPmixmkXYDCvT10wNaRMZwThkc5JJCJ.png`,
    sku: "DJ-0074",
  },
];

PACKAGES[1].name_external = "خرطوم حديقة قابل للتمدد (15 مترًا)";

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function resolveForeignKeysPg(client) {
  const { rows: currencies } = await client.query(
    `select id from public.currencies where code = 'SAR' limit 1`,
  );
  const { rows: libraries } = await client.query(
    `select id from public.address_libraries where dial_code = '966' order by created_at asc limit 1`,
  );
  if (!currencies[0]) throw new Error("未找到 SAR 币种，请先执行 currencies 迁移");
  if (!libraries[0]) {
    throw new Error(
      "未找到沙特地区库（dial_code=966）。请先运行：pnpm seed:saudi",
    );
  }
  return {
    currency_id: currencies[0].id,
    region_id: libraries[0].id,
  };
}

async function resolveForeignKeysSupabase(supabase) {
  const { data: currency, error: cErr } = await supabase
    .from("currencies")
    .select("id")
    .eq("code", "SAR")
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!currency) throw new Error("未找到 SAR 币种");

  const { data: libraries, error: lErr } = await supabase
    .from("address_libraries")
    .select("id")
    .eq("dial_code", "966")
    .order("created_at", { ascending: true })
    .limit(1);
  if (lErr) throw new Error(lErr.message);
  if (!libraries?.[0]) {
    throw new Error(
      "未找到沙特地区库。请先运行：cd shopAD && pnpm seed:saudi",
    );
  }
  return {
    currency_id: currency.id,
    region_id: libraries[0].id,
  };
}

/** 关联所有后台账号，否则员工账号在商品列表中看不到该商品 */
async function syncProductOwnersPg(client, productId) {
  const { rows: profiles } = await client.query(
    `select id from public.profiles`,
  );
  if (profiles.length === 0) {
    console.warn("⚠ 无 profiles 记录，商品仅超级管理员可见");
    return;
  }
  const ownerId = profiles[0].id;
  await client.query(
    `update public.products set created_by = coalesce(created_by, $2) where id = $1`,
    [productId, ownerId],
  );
  let linked = 0;
  for (const { id } of profiles) {
    const res = await client.query(
      `insert into public.product_owners (product_id, profile_id, created_by)
       values ($1, $2, $2)
       on conflict (product_id, profile_id) do nothing`,
      [productId, id],
    );
    linked += res.rowCount ?? 0;
  }
  console.log(
    `✓ 已关联 ${linked} 条 product_owners（共 ${profiles.length} 个账号）`,
  );
  console.log(
    "  提示：员工账号还需在「员工管理」中分配沙特地区（dial_code=966）才能看到该商品",
  );
}

async function syncProductOwnersSupabase(supabase, productId) {
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id");
  if (pErr) throw new Error(pErr.message);
  if (!profiles?.length) {
    console.warn("⚠ 无 profiles 记录，商品仅超级管理员可见");
    return;
  }
  const ownerId = profiles[0].id;
  await supabase
    .from("products")
    .update({ created_by: ownerId })
    .eq("id", productId)
    .is("created_by", null);

  const rows = profiles.map(({ id }) => ({
    product_id: productId,
    profile_id: id,
    created_by: id,
  }));
  const { error: insErr } = await supabase
    .from("product_owners")
    .upsert(rows, { onConflict: "product_id,profile_id", ignoreDuplicates: true });
  if (insErr) throw new Error(insErr.message);

  console.log(`✓ 已关联 product_owners（共 ${profiles.length} 个账号）`);
  console.log(
    "  提示：员工账号还需在「员工管理」中分配沙特地区（dial_code=966）才能看到该商品",
  );
}

async function upsertPackagesPg(client, productId) {
  await client.query(
    `delete from public.product_packages pp
     where pp.product_id = $1
       and pp.name not in ('خرطوم 30 متر', 'خرطوم 15 متر')`,
    [productId],
  );

  for (const pkg of PACKAGES) {
    const existing = await client.query(
      `select id from public.product_packages where product_id = $1 and name = $2 limit 1`,
      [productId, pkg.name],
    );
    let packageId = existing.rows[0]?.id;
    if (packageId) {
      await client.query(
        `update public.product_packages set
          name_external = $2, original_price = $3, discount_price = $4,
          sort_order = $5, image_url = $6, is_visible = true, updated_at = now()
         where id = $1`,
        [
          packageId,
          pkg.name_external,
          pkg.original_price,
          pkg.discount_price,
          pkg.sort_order,
          pkg.image_url,
        ],
      );
    } else {
      const ins = await client.query(
        `insert into public.product_packages (
          product_id, name, name_external, original_price, discount_price,
          sort_order, summary, is_visible, image_url
        ) values ($1,$2,$3,$4,$5,$6,$7,true,$8) returning id`,
        [
          productId,
          pkg.name,
          pkg.name_external,
          pkg.original_price,
          pkg.discount_price,
          pkg.sort_order,
          `SKU ${pkg.sku}`,
          pkg.image_url,
        ],
      );
      packageId = ins.rows[0].id;
    }

    await client.query(
      `insert into public.product_package_items (
        package_id, quantity, independent_attrs, sort_order, ref_product_id
      ) select $1, 1, false, 0, $2
       where not exists (select 1 from public.product_package_items where package_id = $1)`,
      [packageId, productId],
    );
  }
}

async function upsertPackagesSupabase(supabase, productId) {
  const { data: existingPkgs } = await supabase
    .from("product_packages")
    .select("id, name")
    .eq("product_id", productId);

  const keep = new Set(PACKAGES.map((p) => p.name));
  for (const row of existingPkgs ?? []) {
    if (!keep.has(row.name)) {
      await supabase.from("product_packages").delete().eq("id", row.id);
    }
  }

  for (const pkg of PACKAGES) {
    const found = (existingPkgs ?? []).find((r) => r.name === pkg.name);
    let packageId = found?.id;
    const payload = {
      product_id: productId,
      name: pkg.name,
      name_external: pkg.name_external,
      original_price: pkg.original_price,
      discount_price: pkg.discount_price,
      sort_order: pkg.sort_order,
      summary: `SKU ${pkg.sku}`,
      is_visible: true,
      image_url: pkg.image_url,
    };

    if (packageId) {
      const { error } = await supabase
        .from("product_packages")
        .update(payload)
        .eq("id", packageId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase
        .from("product_packages")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      packageId = data.id;
    }

    const { data: items } = await supabase
      .from("product_package_items")
      .select("id")
      .eq("package_id", packageId)
      .limit(1);
    if (!items?.length) {
      const { error } = await supabase.from("product_package_items").insert({
        package_id: packageId,
        quantity: 1,
        independent_attrs: false,
        sort_order: 0,
        ref_product_id: productId,
      });
      if (error) throw new Error(error.message);
    }
  }
}

async function runWithSqlFile() {
  const sql = readFileSync(
    resolve(root, "scripts/insert-garden-hose-ar.sql"),
    "utf8",
  );
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const product = await client.query(
      `select id, name, link_suffix, status from public.products where link_suffix = $1`,
      [LINK_SUFFIX],
    );
    console.log("✓ SQL 导入完成:", product.rows[0]);
  } finally {
    await client.end();
  }
}

async function runWithPgUpsert() {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const fk = await resolveForeignKeysPg(client);
    const payload = { ...PRODUCT, ...fk, updated_at: new Date().toISOString() };

    const existing = await client.query(
      `select id from public.products where link_suffix = $1 limit 1`,
      [LINK_SUFFIX],
    );

    let productId;
    if (existing.rows[0]) {
      productId = existing.rows[0].id;
      const cols = Object.keys(payload);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await client.query(
        `update public.products set ${sets} where id = $1`,
        [productId, ...cols.map((c) => payload[c])],
      );
      console.log("✓ 已更新商品");
    } else {
      const cols = Object.keys(payload);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const ins = await client.query(
        `insert into public.products (${cols.join(", ")}) values (${placeholders}) returning id`,
        cols.map((c) => payload[c]),
      );
      productId = ins.rows[0].id;
      console.log("✓ 已创建商品");
    }

    await upsertPackagesPg(client, productId);
    await syncProductOwnersPg(client, productId);
    const summary = await client.query(
      `select p.id, p.name, p.link_suffix, p.status, c.code as currency, al.dial_code
       from public.products p
       left join public.currencies c on c.id = p.currency_id
       left join public.address_libraries al on al.id = p.region_id
       where p.id = $1`,
      [productId],
    );
    console.log(summary.rows[0]);
  } finally {
    await client.end();
  }
}

async function runWithSupabase() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fk = await resolveForeignKeysSupabase(supabase);
  const payload = { ...PRODUCT, ...fk };

  const { data: existing, error: findErr } = await supabase
    .from("products")
    .select("id")
    .eq("link_suffix", LINK_SUFFIX)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);

  let productId;
  if (existing) {
    const { error } = await supabase
      .from("products")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    productId = existing.id;
    console.log("✓ 已更新商品");
  } else {
    const { data, error } = await supabase
      .from("products")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    productId = data.id;
    console.log("✓ 已创建商品");
  }

  await upsertPackagesSupabase(supabase, productId);
  await syncProductOwnersSupabase(supabase, productId);

  const { data: summary, error: sErr } = await supabase
    .from("products")
    .select(
      "id, name, link_suffix, status, currency_id, region_id, packages_enabled",
    )
    .eq("id", productId)
    .single();
  if (sErr) throw new Error(sErr.message);
  console.log("shopAD 后台可见商品：", summary);
  console.log(`落地页：http://localhost:3000/${LINK_SUFFIX}`);
}

if (!databaseUrl && !(supabaseUrl && supabaseServiceKey)) {
  console.error(
    "缺少凭证：设置 DATABASE_URL，或 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

try {
  if (databaseUrl?.includes("storefront") || process.env.USE_SQL_FILE === "1") {
    await runWithSqlFile();
  } else if (databaseUrl) {
    await runWithPgUpsert();
  } else {
    await runWithSupabase();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
