-- 地区库列表汇总：一次聚合 count + max(level)，避免 N+1
create or replace function public.address_library_stats(p_library_ids uuid[])
returns table (
  library_id uuid,
  region_count bigint,
  max_level integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.library_id,
    count(*)::bigint as region_count,
    coalesce(max(r.level), 0)::integer as max_level
  from public.address_regions r
  where r.library_id = any (p_library_ids)
  group by r.library_id;
$$;

comment on function public.address_library_stats(uuid[]) is
  'Batch region_count + max_level for address library list APIs';

grant execute on function public.address_library_stats(uuid[]) to service_role;
grant execute on function public.address_library_stats(uuid[]) to authenticated;

-- 财务导出筛选项：去重归属成员
create or replace function public.distinct_order_owner_members(p_status text)
returns table (owner_member text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct trim(o.owner_member) as owner_member
  from public.orders o
  where o.payment_type = 'cod'
    and o.status = p_status
    and o.owner_member is not null
    and trim(o.owner_member) <> ''
  order by 1
  limit 500;
$$;

comment on function public.distinct_order_owner_members(text) is
  'Distinct owner_member values for finance-export meta filters';

grant execute on function public.distinct_order_owner_members(text) to service_role;
grant execute on function public.distinct_order_owner_members(text) to authenticated;
