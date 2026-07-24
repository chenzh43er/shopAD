-- 商品附加 HTML 代码（落地页注入等，支持多条）

alter table public.products
  add column if not exists extra_html text[] not null default '{}';

comment on column public.products.extra_html is '附加HTML代码列表（落地页可按顺序注入的自定义 HTML/脚本）';
