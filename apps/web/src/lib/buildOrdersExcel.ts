import * as XLSX from "xlsx";
import dayjs from "dayjs";

export type OrdersExportRow = {
  order_no: string;
  shipping_order_no: string;
  status_label: string;
  review_status_label: string;
  payment_type_label: string;
  payment_method: string;
  customer_name: string;
  customer_phone: string;
  shipping_province: string;
  shipping_city: string;
  shipping_district: string;
  shipping_detail: string;
  shipping_address: string;
  shipping_full: string;
  product_name: string;
  package_name: string;
  package_name_external: string;
  sku_code: string;
  sku_quantity: string;
  unit_price: number | "";
  quantity: number;
  package_count: number | "";
  total_amount: number | "";
  cod_amount: number | "";
  shipping_fee: number | "";
  other_fee: number | "";
  currency_code: string;
  currency_symbol: string;
  owner_member: string;
  remark: string;
  reject_reason: string;
  weight: number | "";
  express_type: string;
  insurance_type: string;
  insurance_flag: string;
  item_value: number | "";
  item_category: string;
  item_type: string;
  consignor_flag: string;
  consignor_name: string;
  consignor_phone: string;
  shipper_name: string;
  shipper_phone: string;
  shipper_province: string;
  shipper_city: string;
  shipper_district: string;
  shipper_address: string;
  shipper_address_info: string;
  reviewed_at: string;
  created_at: string;
  updated_at: string;
};

export type OrderExportColumnKey = keyof OrdersExportRow;

export type OrderExportColumn = {
  key: OrderExportColumnKey;
  header: string;
  getValue: (row: OrdersExportRow) => string | number;
  /** 地址/备注等长文本列加宽 */
  wide?: boolean;
};

function formatDateTime(value: string): string {
  if (!value) return "";
  const d = dayjs(value);
  return d.isValid() ? d.format("YYYY-MM-DD HH:mm:ss") : value;
}

export const ORDER_EXPORT_COLUMNS: OrderExportColumn[] = [
  { key: "order_no", header: "订单号", getValue: (r) => r.order_no },
  { key: "shipping_order_no", header: "运单号", getValue: (r) => r.shipping_order_no },
  { key: "status_label", header: "订单状态", getValue: (r) => r.status_label },
  { key: "review_status_label", header: "审核状态", getValue: (r) => r.review_status_label },
  { key: "payment_type_label", header: "支付类别", getValue: (r) => r.payment_type_label },
  { key: "payment_method", header: "支付方式", getValue: (r) => r.payment_method },
  { key: "customer_name", header: "客户姓名", getValue: (r) => r.customer_name },
  { key: "customer_phone", header: "客户电话", getValue: (r) => r.customer_phone },
  { key: "shipping_province", header: "收件省", getValue: (r) => r.shipping_province },
  { key: "shipping_city", header: "收件市", getValue: (r) => r.shipping_city },
  { key: "shipping_district", header: "收件区", getValue: (r) => r.shipping_district },
  { key: "shipping_detail", header: "收件明细", getValue: (r) => r.shipping_detail },
  { key: "shipping_address", header: "收件地址信息", getValue: (r) => r.shipping_address },
  { key: "shipping_full", header: "收件完整地址", getValue: (r) => r.shipping_full, wide: true },
  { key: "product_name", header: "商品", getValue: (r) => r.product_name },
  { key: "package_name", header: "套餐", getValue: (r) => r.package_name },
  { key: "package_name_external", header: "套餐外文名", getValue: (r) => r.package_name_external },
  { key: "sku_code", header: "中文属性码", getValue: (r) => r.sku_code },
  { key: "sku_quantity", header: "中文属性*数量", getValue: (r) => r.sku_quantity },
  { key: "unit_price", header: "单价", getValue: (r) => r.unit_price },
  { key: "quantity", header: "购买数量", getValue: (r) => r.quantity },
  { key: "package_count", header: "套餐内件数", getValue: (r) => r.package_count },
  { key: "total_amount", header: "订单总金额", getValue: (r) => r.total_amount },
  { key: "cod_amount", header: "代收货款", getValue: (r) => r.cod_amount },
  { key: "shipping_fee", header: "运费", getValue: (r) => r.shipping_fee },
  { key: "other_fee", header: "其它费", getValue: (r) => r.other_fee },
  { key: "currency_code", header: "币种", getValue: (r) => r.currency_code },
  { key: "currency_symbol", header: "币种符号", getValue: (r) => r.currency_symbol },
  { key: "owner_member", header: "归属成员", getValue: (r) => r.owner_member },
  { key: "remark", header: "备注", getValue: (r) => r.remark, wide: true },
  { key: "reject_reason", header: "拒绝理由", getValue: (r) => r.reject_reason },
  { key: "weight", header: "重量", getValue: (r) => r.weight },
  { key: "express_type", header: "快件类型", getValue: (r) => r.express_type },
  { key: "insurance_type", header: "保价类型", getValue: (r) => r.insurance_type },
  { key: "insurance_flag", header: "保价费标识", getValue: (r) => r.insurance_flag },
  { key: "item_value", header: "物品价值", getValue: (r) => r.item_value },
  { key: "item_category", header: "物品类别", getValue: (r) => r.item_category },
  { key: "item_type", header: "物品类型", getValue: (r) => r.item_type },
  { key: "consignor_flag", header: "委托人标识", getValue: (r) => r.consignor_flag },
  { key: "consignor_name", header: "委托人姓名", getValue: (r) => r.consignor_name },
  { key: "consignor_phone", header: "委托人电话", getValue: (r) => r.consignor_phone },
  { key: "shipper_name", header: "寄件人", getValue: (r) => r.shipper_name },
  { key: "shipper_phone", header: "寄件人电话", getValue: (r) => r.shipper_phone },
  { key: "shipper_province", header: "寄件省", getValue: (r) => r.shipper_province },
  { key: "shipper_city", header: "寄件市", getValue: (r) => r.shipper_city },
  { key: "shipper_district", header: "寄件区", getValue: (r) => r.shipper_district },
  { key: "shipper_address", header: "寄件地址", getValue: (r) => r.shipper_address },
  { key: "shipper_address_info", header: "寄件地址信息", getValue: (r) => r.shipper_address_info },
  {
    key: "reviewed_at",
    header: "审核时间",
    getValue: (r) => formatDateTime(r.reviewed_at),
  },
  {
    key: "created_at",
    header: "下单时间",
    getValue: (r) => formatDateTime(r.created_at),
  },
  {
    key: "updated_at",
    header: "最近更新时间",
    getValue: (r) => formatDateTime(r.updated_at),
  },
];

export const ALL_ORDER_EXPORT_COLUMN_KEYS: OrderExportColumnKey[] =
  ORDER_EXPORT_COLUMNS.map((c) => c.key);

/** 显示宽度：中日韩等全角按 2，其余按 1 */
function displayWidth(value: string | number): number {
  const s = String(value ?? "");
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0xff ? 2 : 1;
  }
  return w;
}

function colWidth(values: (string | number)[], min = 10, max = 40): number {
  let widest = min;
  for (const v of values) {
    widest = Math.max(widest, displayWidth(v) + 2);
  }
  return Math.min(widest, max);
}

function resolveExportColumns(columnKeys?: OrderExportColumnKey[]): OrderExportColumn[] {
  if (!columnKeys?.length) return ORDER_EXPORT_COLUMNS;
  const keySet = new Set(columnKeys);
  return ORDER_EXPORT_COLUMNS.filter((c) => keySet.has(c.key));
}

/** 生成全部订单导出 xlsx；仅包含 columnKeys 中指定的列（未传则导出全部列） */
export function buildOrdersExcel(
  rows: OrdersExportRow[],
  columnKeys?: OrderExportColumnKey[],
): Blob {
  const cols = resolveExportColumns(columnKeys);
  if (!cols.length) {
    throw new Error("请至少选择一列导出");
  }

  const headers = cols.map((c) => c.header);
  const dataRows = rows.map((r) => cols.map((c) => c.getValue(r)));

  const sheetRows: (string | number)[][] = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  ws["!cols"] = cols.map((col, colIndex) => ({
    wch: colWidth(
      [col.header, ...dataRows.map((row) => row[colIndex] ?? "")],
      8,
      col.wide ? 48 : 36,
    ),
  }));
  ws["!rows"] = sheetRows.map((_, i) => ({ hpt: i === 0 ? 22 : 18 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "全部订单");
  const buffer = XLSX.write(wb, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
  });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function ordersExportFilename(): string {
  const stamp = dayjs().format("YYYYMMDD_HHmmss");
  return `全部订单导出_${stamp}.xlsx`;
}
