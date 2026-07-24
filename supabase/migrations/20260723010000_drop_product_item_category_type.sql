-- 商品不再维护物品类别 / 物品类型（订单运单级字段保留）

alter table public.products
  drop column if exists item_category,
  drop column if exists item_type;
