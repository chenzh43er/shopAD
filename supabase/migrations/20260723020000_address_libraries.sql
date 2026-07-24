-- ---------------------------------------------------------------------------
-- address_libraries: 命名地址库（地区名称）
-- address_regions: 多级地域节点（邻接表，级数可扩展）
-- ---------------------------------------------------------------------------

create table if not exists public.address_libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint address_libraries_name_nonempty check (char_length(trim(name)) > 0)
);

create unique index if not exists address_libraries_name_uidx
  on public.address_libraries (lower(trim(name)));

comment on table public.address_libraries is '地址库（按地区名称区分，如极兔地址库）';
comment on column public.address_libraries.name is '地区名称 / 地址库名称';

drop trigger if exists address_libraries_set_updated_at on public.address_libraries;
create trigger address_libraries_set_updated_at
  before update on public.address_libraries
  for each row execute function public.set_updated_at();

alter table public.address_libraries enable row level security;

create table if not exists public.address_regions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.address_libraries (id) on delete cascade,
  parent_id uuid references public.address_regions (id) on delete cascade,
  name text not null,
  level integer not null check (level >= 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint address_regions_name_nonempty check (char_length(trim(name)) > 0)
);

create index if not exists address_regions_library_id_idx
  on public.address_regions (library_id);

create index if not exists address_regions_parent_id_idx
  on public.address_regions (parent_id);

create index if not exists address_regions_library_level_idx
  on public.address_regions (library_id, level);

-- 同库同父下名称唯一（根节点 parent_id 为 null 需单独唯一索引）
create unique index if not exists address_regions_root_name_uidx
  on public.address_regions (library_id, lower(name))
  where parent_id is null;

create unique index if not exists address_regions_parent_name_uidx
  on public.address_regions (library_id, parent_id, lower(name))
  where parent_id is not null;

comment on table public.address_regions is '地址库地域节点（支持任意级数）';
comment on column public.address_regions.level is '层级，从 1 开始（一级/二级/三级…）';
comment on column public.address_regions.parent_id is '上级地域，一级为 null';

drop trigger if exists address_regions_set_updated_at on public.address_regions;
create trigger address_regions_set_updated_at
  before update on public.address_regions
  for each row execute function public.set_updated_at();

alter table public.address_regions enable row level security;
