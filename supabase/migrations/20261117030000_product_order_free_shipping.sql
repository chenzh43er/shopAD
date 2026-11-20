-- 商品「是否包邮」+ 订单下单快照
-- 默认不包邮；旧订单 free_shipping 为 null，不改写既有计价逻辑。

alter table public.products
  add column if not exists free_shipping boolean not null default false;

comment on column public.products.free_shipping is
  '是否包邮；默认 false（不包邮）。仅商品配置；下单写入 orders.free_shipping 快照';

alter table public.orders
  add column if not exists free_shipping boolean;

comment on column public.orders.free_shipping is
  '下单时商品是否包邮快照；null=历史订单未记录（展示侧按不包邮处理，不改总价逻辑）';

-- storefront 下单路径可能显式列插入；补列级授权兜底
do $$
begin
  execute 'grant select (free_shipping) on table public.products to storefront';
exception
  when undefined_object then null;
  when invalid_grant_operation then null;
end $$;

do $$
begin
  execute 'grant insert (free_shipping), select (free_shipping), update (free_shipping) on table public.orders to storefront';
exception
  when undefined_object then null;
  when invalid_grant_operation then null;
end $$;

-- 下单未传 free_shipping 时，从商品自动快照（不覆盖显式传入值）
create or replace function public.orders_set_free_shipping_from_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free boolean;
begin
  if new.product_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.free_shipping is not null then
      return new;
    end if;
    select p.free_shipping into v_free
    from public.products p
    where p.id = new.product_id;
    if found then
      new.free_shipping := coalesce(v_free, false);
    end if;
    return new;
  end if;

  -- UPDATE：仅 product_id 变更且未显式带 free_shipping 时重快照
  if new.product_id is distinct from old.product_id
     and new.free_shipping is not distinct from old.free_shipping then
    select p.free_shipping into v_free
    from public.products p
    where p.id = new.product_id;
    if found then
      new.free_shipping := coalesce(v_free, false);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_set_free_shipping_from_product_trg on public.orders;
create trigger orders_set_free_shipping_from_product_trg
  before insert or update of product_id, free_shipping
  on public.orders
  for each row
  execute function public.orders_set_free_shipping_from_product();
