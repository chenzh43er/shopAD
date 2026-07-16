import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const email = process.env.ADMIN_EMAIL ?? "admin@shopad.local";
const password = process.env.ADMIN_PASSWORD ?? "Admin@888897";

function sqlLiteral(value) {
  return value.replace(/'/g, "''");
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const existing = await client.query(
  "select id, email from auth.users where email = $1",
  [email],
);

if (existing.rows.length) {
  console.log("Admin already exists:", existing.rows[0]);
  const profile = await client.query(
    "select * from public.profiles where id = $1",
    [existing.rows[0].id],
  );
  if (!profile.rows[0]) {
    await client.query(
      `insert into public.profiles (id, role, display_name)
       values ($1, 'admin', 'Admin')
       on conflict (id) do update set role = 'admin'`,
      [existing.rows[0].id],
    );
    console.log("profile created");
  } else {
    console.log("profile:", profile.rows[0]);
  }
  console.log(`\nLogin: ${email} / (existing password)`);
  await client.end();
  process.exit(0);
}

await client.query(`
  do $do$
  declare
    v_user_id uuid := gen_random_uuid();
    v_encrypted_pw text := crypt('${sqlLiteral(password)}', gen_salt('bf'));
    v_email text := '${sqlLiteral(email)}';
  begin
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pw,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Admin"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true
      ),
      'email',
      v_user_id::text,
      now(),
      now(),
      now()
    );
  end
  $do$;
`);

const user = await client.query(
  "select id, email, email_confirmed_at from auth.users where email = $1",
  [email],
);
console.log("user:", user.rows[0]);

let profile = await client.query(
  "select * from public.profiles where id = $1",
  [user.rows[0].id],
);

if (!profile.rows[0]) {
  await client.query(
    `insert into public.profiles (id, role, display_name)
     values ($1, 'admin', 'Admin')
     on conflict (id) do update set role = 'admin'`,
    [user.rows[0].id],
  );
  profile = await client.query(
    "select * from public.profiles where id = $1",
    [user.rows[0].id],
  );
}

console.log("profile:", profile.rows[0]);
console.log("\nLogin credentials:");
console.log(`  email: ${email}`);
console.log(`  password: ${password}`);

await client.end();
