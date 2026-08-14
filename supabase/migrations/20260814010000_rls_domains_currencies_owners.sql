-- 补齐此前未启用 RLS 的表：默认拒绝直连，仅 service_role / 绕过 RLS 的后端可写
alter table public.domains enable row level security;
alter table public.currencies enable row level security;
alter table public.product_owners enable row level security;
