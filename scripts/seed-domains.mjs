import { config } from "dotenv";
import pg from "pg";

config({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const rows = [
  { host: "nusasnack.shop", name: "NusaSnack", sort_order: 10 },
  { host: "nusamunch.store", name: "NusaMunch", sort_order: 20 },
  { host: "indocrunch.store", name: "IndoCrunch", sort_order: 30 },
];

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

await client.connect();

for (const r of rows) {
  const res = await client.query(
    `
    insert into public.domains (host, name, enabled, sort_order)
    values ($1, $2, true, $3)
    on conflict (host) do update set
      name = excluded.name,
      enabled = true,
      sort_order = excluded.sort_order
    returning host, name, enabled, sort_order
    `,
    [r.host, r.name, r.sort_order],
  );
  console.log("upserted:", res.rows[0]);
}

const all = await client.query(
  `select host, name, enabled, sort_order from public.domains order by sort_order, host`,
);
console.log("all domains:");
for (const row of all.rows) {
  console.log(
    `  ${row.host}  name=${row.name}  enabled=${row.enabled}  sort=${row.sort_order}`,
  );
}

await client.end();
