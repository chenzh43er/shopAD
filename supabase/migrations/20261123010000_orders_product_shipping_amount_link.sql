-- orders: product_amount / shipping_amount / product_link
-- product_amount ↔ item_value、shipping_amount ↔ shipping_fee 双向快照别名，便于后台与导出统一命名。

alter table public.orders
  add column if not exists product_amount numeric(12, 2)
    check (product_amount is null or product_amount >= 0),
  add column if not exists shipping_amount numeric(12, 2)
    check (shipping_amount is null or shipping_amount >= 0),
  add column if not exists product_link text;

comment on column public.orders.product_amount is
  '商品金额（不含运费）；与 item_value 同步';
comment on column public.orders.shipping_amount is
  '运费金额；与 shipping_fee 同步';
comment on column public.orders.product_link is
  '商品链接（下单页/落地页 URL，可后台编辑）';

-- 历史数据回填
update public.orders
set product_amount = item_value
where product_amount is null
  and item_value is not null;

update public.orders
set shipping_amount = shipping_fee
where shipping_amount is null
  and shipping_fee is not null;

create or replace function public.orders_sync_amount_aliases()
returns trigger
language plpgsql
as $$
begin
  -- 商品金额：优先采纳显式变更的一侧
  if tg_op = 'INSERT' then
    if new.product_amount is not null and new.item_value is null then
      new.item_value := new.product_amount;
    elsif new.item_value is not null and new.product_amount is null then
      new.product_amount := new.item_value;
    elsif new.product_amount is not null
      and new.item_value is not null
      and new.product_amount is distinct from new.item_value then
      -- 两侧都传且不一致时，以 product_amount 为准
      new.item_value := new.product_amount;
    end if;

    if new.shipping_amount is not null and new.shipping_fee is null then
      new.shipping_fee := new.shipping_amount;
    elsif new.shipping_fee is not null and new.shipping_amount is null then
      new.shipping_amount := new.shipping_fee;
    elsif new.shipping_amount is not null
      and new.shipping_fee is not null
      and new.shipping_amount is distinct from new.shipping_fee then
      new.shipping_fee := new.shipping_amount;
    end if;

    return new;
  end if;

  -- UPDATE
  if new.product_amount is distinct from old.product_amount then
    new.item_value := new.product_amount;
  elsif new.item_value is distinct from old.item_value then
    new.product_amount := new.item_value;
  end if;

  if new.shipping_amount is distinct from old.shipping_amount then
    new.shipping_fee := new.shipping_amount;
  elsif new.shipping_fee is distinct from old.shipping_fee then
    new.shipping_amount := new.shipping_fee;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_sync_amount_aliases_trg on public.orders;
create trigger orders_sync_amount_aliases_trg
  before insert or update of item_value, product_amount, shipping_fee, shipping_amount
  on public.orders
  for each row
  execute function public.orders_sync_amount_aliases();

do $$
begin
  execute 'grant select (product_amount, shipping_amount, product_link) on table public.orders to storefront';
  execute 'grant insert (product_amount, shipping_amount, product_link) on table public.orders to storefront';
  execute 'grant update (product_amount, shipping_amount, product_link) on table public.orders to storefront';
exception
  when undefined_object then
    null; -- storefront 角色尚未创建时跳过
end;
$$;
