-- 附加 HTML 代码支持多条：text → text[]
-- 兼容：纯文本、JSON 数组字符串（代码在 text 列上写入数组时的形态）

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'extra_html'
      and data_type = 'text'
  ) then
    alter table public.products
      alter column extra_html type text[]
      using case
        when extra_html is null or btrim(extra_html) = '' then '{}'::text[]
        when btrim(extra_html) = '[]' then '{}'::text[]
        when left(btrim(extra_html), 1) = '[' then
          coalesce(
            (
              select array_agg(elem order by ord)
              from jsonb_array_elements_text(extra_html::jsonb) with ordinality as t(elem, ord)
            ),
            '{}'::text[]
          )
        else array[extra_html]::text[]
      end;

    alter table public.products
      alter column extra_html set default '{}';

    alter table public.products
      alter column extra_html set not null;
  end if;
end $$;

comment on column public.products.extra_html is '附加HTML代码列表（落地页可按顺序注入的自定义 HTML/脚本）';
