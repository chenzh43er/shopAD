-- 域名管理 + 商品关联域名

create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  /** 主机名，不含协议，如 shop.example.com */
  host text not null,
  /** 显示名称 */
  name text not null default '',
  /** 备注 */
  remark text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domains_host_unique unique (host),
  constraint domains_host_format check (
    host ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  )
);

create index if not exists domains_enabled_sort_idx
  on public.domains (enabled, sort_order, host);

drop trigger if exists domains_set_updated_at on public.domains;
create trigger domains_set_updated_at
  before update on public.domains
  for each row execute function public.set_updated_at();

comment on table public.domains is '落地页域名';
comment on column public.domains.host is '主机名（不含协议）';
comment on column public.domains.name is '显示名称';
comment on column public.domains.remark is '备注';

-- 商品关联域名
alter table public.products
  add column if not exists domain_id uuid
    references public.domains (id) on delete set null;

create index if not exists products_domain_id_idx
  on public.products (domain_id);

comment on column public.products.domain_id is '关联域名（域名管理）';
