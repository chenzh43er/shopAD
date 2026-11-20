-- address_regions: 叶子节点实际运费（Excel「实际运费」列导入；缺省为 null）
-- 预留字段：当前前台/下单不计价；null 表示沿用现网免邮等既有逻辑。

alter table public.address_regions
  add column if not exists actual_shipping_fee numeric(12, 2)
    check (actual_shipping_fee is null or actual_shipping_fee >= 0);

comment on column public.address_regions.actual_shipping_fee is
  '实际运费（后台预留，未接入前台计价）；通常写在叶子。null=不覆盖现网免邮等逻辑';
