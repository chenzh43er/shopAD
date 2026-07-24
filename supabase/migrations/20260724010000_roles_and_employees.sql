-- Roles: super_admin (full access + employee management) | employee (own products/orders)
-- Keep legacy 'admin' temporarily only during migrate; all admins become super_admin.

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add column if not exists is_active boolean not null default true;

alter table public.profiles
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

update public.profiles
set role = 'super_admin'
where role = 'admin';

alter table public.profiles
  alter column role set default 'employee';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'employee'));

comment on column public.profiles.role is 'super_admin=全量管理+员工; employee=仅自己的商品与订单';
comment on column public.profiles.is_active is 'false 时禁止登录后台 API';
comment on column public.profiles.created_by is '邀请/创建该账号的超级管理员';

-- New Auth signups default to employee (invite via admin API sets role explicitly)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text;
  next_role text;
begin
  meta_role := coalesce(new.raw_user_meta_data->>'role', '');
  if meta_role = 'super_admin' then
    next_role := 'super_admin';
  else
    next_role := 'employee';
  end if;

  insert into public.profiles (id, role, display_name, is_active)
  values (
    new.id,
    next_role,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
