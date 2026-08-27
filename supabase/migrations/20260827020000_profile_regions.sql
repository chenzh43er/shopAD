-- 可选：关系型存储员工地区权限（当前应用改用 auth.users.user_metadata.region_ids，无需执行本迁移）
-- 若将来需要 SQL 层联查/约束，可再启用此表并同步数据。
create table if not exists public.profile_regions (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  region_id uuid not null references public.address_libraries (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  primary key (profile_id, region_id)
);

comment on table public.profile_regions is '（可选）员工可操作的地区；当前运行时存储于 auth user_metadata.region_ids';

create index if not exists profile_regions_region_id_idx
  on public.profile_regions (region_id);

alter table public.profile_regions enable row level security;
