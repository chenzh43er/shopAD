-- 域名不再支持「默认」概念
drop index if exists public.domains_one_default_idx;

alter table public.domains
  drop column if exists is_default;
