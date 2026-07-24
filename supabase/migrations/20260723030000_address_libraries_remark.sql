-- 地区备注
alter table public.address_libraries
  add column if not exists remark text;

comment on column public.address_libraries.remark is '备注';
