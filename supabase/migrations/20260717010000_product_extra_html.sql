-- 商品附加 HTML 代码（落地页注入等）

alter table public.products
  add column if not exists extra_html text;

comment on column public.products.extra_html is '附加HTML代码（落地页可注入的自定义 HTML/脚本）';
