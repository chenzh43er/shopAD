-- 现有商品按现网口径标为包邮；新建商品仍默认 free_shipping=false。
-- 历史订单 free_shipping 为 null 的补为 true（不覆盖已有显式值）。
-- 注意：禁用 user trigger，避免误改 updated_at。

alter table public.products disable trigger user;
update public.products
set free_shipping = true
where free_shipping is distinct from true;
alter table public.products enable trigger user;

alter table public.orders disable trigger user;
update public.orders
set free_shipping = true
where free_shipping is null;
alter table public.orders enable trigger user;
