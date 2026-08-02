-- 地区库国际电话区号（不含 +），如印尼 62
alter table public.address_libraries
  add column if not exists dial_code text;

comment on column public.address_libraries.dial_code is '国际电话区号（不含+），如印尼 62';

-- 已有「印尼」类地区库回填 62
update public.address_libraries
set dial_code = '62'
where dial_code is null
  and (
    name ilike '%indonesia%'
    or name like '%印尼%'
    or lower(trim(name)) in ('id', 'idn')
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'address_libraries_dial_code_format'
  ) then
    alter table public.address_libraries
      add constraint address_libraries_dial_code_format
      check (dial_code is null or dial_code ~ '^[1-9][0-9]{0,3}$');
  end if;
end $$;
