-- 商品赠品区块总标题（落地页「Free Gift / Bonus Gratis / هدية مجانية」可自定义）
-- 留空时店面使用各市场默认文案；多语言标题存于 Storage gifts/{productId}.json 的 _section。

alter table public.products
  add column if not exists gifts_title text;

comment on column public.products.gifts_title is
  '赠品区块总标题（可空）；为空时店面使用默认文案（如 Free Gift / Bonus Gratis）';
