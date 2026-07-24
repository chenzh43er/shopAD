/** 按币种格式化金额展示 */
export function formatMoney(
  amount: number,
  currency?: {
    code?: string | null;
    symbol?: string | null;
    symbol_suffix?: boolean | null;
  } | null,
): string {
  const value = Number(amount);
  const text = Number.isFinite(value) ? value.toFixed(2) : "0.00";
  const symbol = currency?.symbol?.trim() || "¥";
  const code = currency?.code?.trim();
  const withSymbol = currency?.symbol_suffix
    ? `${text}${symbol}`
    : `${symbol}${text}`;
  if (code && code !== "CNY") {
    return `${code} ${withSymbol}`;
  }
  return withSymbol;
}
