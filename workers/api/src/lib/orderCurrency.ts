import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderCurrency = {
  id: string;
  code: string;
  name: string;
  name_zh: string;
  symbol: string;
  symbol_suffix: boolean;
};

type RowWithProduct = {
  product_id?: string | null;
  currency?: OrderCurrency | null;
};

/**
 * 按订单关联商品挂上币种，供前端 formatMoney 使用。
 */
export async function attachOrderCurrency<T extends RowWithProduct>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<(T & { currency: OrderCurrency | null })[]> {
  if (rows.length === 0) return [];

  const productIds = [
    ...new Set(
      rows
        .map((r) => r.product_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (productIds.length === 0) {
    return rows.map((r) => ({ ...r, currency: null }));
  }

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, currency:currencies!products_currency_id_fkey(id, code, name, name_zh, symbol, symbol_suffix)",
    )
    .in("id", productIds);

  if (error) {
    console.error("attachOrderCurrency failed:", error.message);
    return rows.map((r) => ({ ...r, currency: null }));
  }

  const byProduct = new Map<string, OrderCurrency | null>();
  for (const row of data ?? []) {
    const raw = (row as { id: string; currency: OrderCurrency | OrderCurrency[] | null })
      .currency;
    const currency = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
    byProduct.set(row.id as string, currency);
  }

  return rows.map((r) => ({
    ...r,
    currency: r.product_id ? (byProduct.get(r.product_id) ?? null) : null,
  }));
}

export async function attachOrderCurrencyOne<T extends RowWithProduct>(
  supabase: SupabaseClient,
  row: T,
): Promise<T & { currency: OrderCurrency | null }> {
  const [withCurrency] = await attachOrderCurrency(supabase, [row]);
  return withCurrency;
}
