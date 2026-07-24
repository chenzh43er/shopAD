-- 币种管理 + 商品关联币种
-- 常用币种初始数据来自 data.gov.my ISO 4217 目录（code / name / symbol）

create table if not exists public.currencies (
  id uuid primary key default gen_random_uuid(),
  /** ISO 4217 字母代码 */
  code text not null,
  /** 英文名称 */
  name text not null,
  /** 中文名称 */
  name_zh text not null,
  /** 常用符号 */
  symbol text not null,
  /** ISO 4217 数字代码 */
  numeric_code integer,
  /** 符号是否后缀（1=后缀，0=前缀） */
  symbol_suffix boolean not null default false,
  is_default boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint currencies_code_unique unique (code),
  constraint currencies_code_format check (code ~ '^[A-Z]{3}$')
);

create index if not exists currencies_enabled_sort_idx
  on public.currencies (enabled, sort_order, code);

create unique index if not exists currencies_one_default_idx
  on public.currencies (is_default)
  where is_default = true;

drop trigger if exists currencies_set_updated_at on public.currencies;
create trigger currencies_set_updated_at
  before update on public.currencies
  for each row execute function public.set_updated_at();

comment on table public.currencies is '币种（ISO 4217）';
comment on column public.currencies.code is 'ISO 4217 字母代码';
comment on column public.currencies.name is '英文名称';
comment on column public.currencies.name_zh is '中文名称';
comment on column public.currencies.symbol is '常用货币符号';
comment on column public.currencies.numeric_code is 'ISO 4217 数字代码';
comment on column public.currencies.symbol_suffix is '符号是否显示在金额之后';
comment on column public.currencies.is_default is '是否默认币种（全局唯一）';

-- 常用币种种子（来源：https://api.data.gov.my/data-catalogue?id=currency_codes）
insert into public.currencies (
  code, name, name_zh, symbol, numeric_code, symbol_suffix, is_default, sort_order
)
values
  ('CNY', 'Yuan Renminbi', '人民币', '¥', 156, false, true, 10),
  ('USD', 'US Dollar', '美元', '$', 840, false, false, 20),
  ('EUR', 'Euro', '欧元', '€', 978, false, false, 30),
  ('GBP', 'Pound Sterling', '英镑', '£', 826, false, false, 40),
  ('JPY', 'Yen', '日元', '¥', 392, true, false, 50),
  ('HKD', 'Hong Kong Dollar', '港元', 'HK$', 344, false, false, 60),
  ('TWD', 'New Taiwan Dollar', '新台币', 'NT$', 901, false, false, 70),
  ('SGD', 'Singapore Dollar', '新加坡元', 'S$', 702, false, false, 80),
  ('MYR', 'Malaysian Ringgit', '马来西亚林吉特', 'RM', 458, false, false, 90),
  ('THB', 'Baht', '泰铢', '฿', 764, false, false, 100),
  ('IDR', 'Rupiah', '印尼盾', 'Rp', 360, false, false, 110),
  ('PHP', 'Philippine Peso', '菲律宾比索', '₱', 608, false, false, 120),
  ('VND', 'Dong', '越南盾', '₫', 704, true, false, 130),
  ('KRW', 'Won', '韩元', '₩', 410, true, false, 140),
  ('AUD', 'Australian Dollar', '澳元', 'A$', 36, false, false, 150),
  ('CAD', 'Canadian Dollar', '加元', 'C$', 124, false, false, 160),
  ('CHF', 'Swiss Franc', '瑞士法郎', 'Fr', 756, false, false, 170),
  ('NZD', 'New Zealand Dollar', '新西兰元', 'NZ$', 554, false, false, 180),
  ('INR', 'Indian Rupee', '印度卢比', '₹', 356, false, false, 190),
  ('AED', 'UAE Dirham', '阿联酋迪拉姆', 'د.إ', 784, true, false, 200),
  ('SAR', 'Saudi Riyal', '沙特里亚尔', 'ر.س', 682, true, false, 210),
  ('RUB', 'Russian Ruble', '俄罗斯卢布', '₽', 643, true, false, 220),
  ('BRL', 'Brazilian Real', '巴西雷亚尔', 'R$', 986, false, false, 230),
  ('MXN', 'Mexican Peso', '墨西哥比索', 'MX$', 484, false, false, 240)
on conflict (code) do update set
  name = excluded.name,
  name_zh = excluded.name_zh,
  symbol = excluded.symbol,
  numeric_code = excluded.numeric_code,
  symbol_suffix = excluded.symbol_suffix,
  sort_order = excluded.sort_order;

-- 商品关联币种
alter table public.products
  add column if not exists currency_id uuid
    references public.currencies (id) on delete set null;

create index if not exists products_currency_id_idx
  on public.products (currency_id);

comment on column public.products.currency_id is '关联币种（币种管理）';

-- 已有商品回填默认币种（CNY）
update public.products p
set currency_id = c.id
from public.currencies c
where c.code = 'CNY'
  and p.currency_id is null;
