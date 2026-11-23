-- 默认套餐角标文案：仅默认选中套餐展示；为空则不展示
alter table public.product_packages
  add column if not exists badge_text text;

comment on column public.product_packages.badge_text is '默认选中的套餐角标文案；为空不显示';
