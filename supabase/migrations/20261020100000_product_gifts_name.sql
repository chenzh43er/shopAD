-- 赠品自定义显示名称
-- 留空时，赠品展示名回退为赠品商品的「商品标题(外部)」(products.title_external)。

alter table public.product_gifts
  add column if not exists gift_name text;

comment on column public.product_gifts.gift_name is
  '赠品自定义显示名称（可空）；为空时使用赠品商品的商品标题(外部)';
