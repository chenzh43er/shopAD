-- 赠品唯一性改为「商品 + 套餐 + 数量」组合唯一
-- 同一个赠品商品可以重复添加（不同套餐 / 不同数量），仅完全相同的组合不允许重复。
-- package_id 可空，Postgres 唯一约束中 NULL 互不相等，故用 coalesce 生成哨兵值。

alter table public.product_gifts
  drop constraint if exists product_gifts_unique;

drop index if exists product_gifts_unique_combo_idx;

create unique index if not exists product_gifts_unique_combo_idx
  on public.product_gifts (
    product_id,
    gift_product_id,
    coalesce(package_id, '00000000-0000-0000-0000-000000000000'::uuid),
    quantity
  );

comment on index public.product_gifts_unique_combo_idx is
  '同一商品的赠品「商品+套餐+数量」组合唯一；同一赠品商品可重复添加不同套餐/数量';
