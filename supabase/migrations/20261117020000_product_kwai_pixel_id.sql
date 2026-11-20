-- Kwai Pixel ID（多个用 # 分隔，与 Facebook 像素字段约定一致）
alter table public.products
  add column if not exists kwai_pixel_id text;

comment on column public.products.kwai_pixel_id is 'Kwai像素id，多个用#分隔';

-- product_locales 仅在已建表的环境存在
do $$
begin
  if to_regclass('public.product_locales') is not null then
    alter table public.product_locales
      add column if not exists kwai_pixel_id text;
    comment on column public.product_locales.kwai_pixel_id is 'Kwai像素id（语言覆盖），多个用#分隔';
  end if;
end $$;
