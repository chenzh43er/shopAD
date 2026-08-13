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

const HEADERS = [
  "订单号",
  "运单号",
  "订单状态",
  "审核状态",
  "支付类别",
  "支付方式",
  "客户姓名",
  "客户电话",
  "收件省",
  "收件市",
  "收件区",
  "收件明细",
  "收件地址信息",
  "收件完整地址",
  "商品",
  "套餐",
  "套餐外文名",
  "中文属性码",
  "中文属性*数量",
  "单价",
  "购买数量",
  "套餐内件数",
  "订单总金额",
  "代收货款",
  "运费",
  "其它费",
  "币种",
  "币种符号",
  "归属成员",
  "备注",
  "拒绝理由",
  "重量",
  "快件类型",
  "保价类型",
  "保价费标识",
  "物品价值",
  "物品类别",
  "物品类型",
  "委托人标识",
  "委托人姓名",
  "委托人电话",
  "寄件人",
  "寄件人电话",
  "寄件省",
  "寄件市",
  "寄件区",
  "寄件地址",
  "寄件地址信息",
  "审核时间",
  "下单时间",
  "最近更新时间",
] as const;

function formatDateTime(value: string): string {
  if (!value) return "";
  const d = dayjs(value);
  return d.isValid() ? d.format("YYYY-MM-DD HH:mm:ss") : value;
}

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

/** 生成全部订单导出 xlsx */
export function buildOrdersExcel(rows: OrdersExportRow[]): Blob {
  const dataRows = rows.map((r) => [
    r.order_no,
    r.shipping_order_no,
    r.status_label,
    r.review_status_label,
    r.payment_type_label,
    r.payment_method,
    r.customer_name,
    r.customer_phone,
    r.shipping_province,
    r.shipping_city,
    r.shipping_district,
    r.shipping_detail,
    r.shipping_address,
    r.shipping_full,
    r.product_name,
    r.package_name,
    r.package_name_external,
    r.sku_code,
    r.sku_quantity,
    r.unit_price,
    r.quantity,
    r.package_count,
    r.total_amount,
    r.cod_amount,
    r.shipping_fee,
    r.other_fee,
    r.currency_code,
    r.currency_symbol,
    r.owner_member,
    r.remark,
    r.reject_reason,
    r.weight,
    r.express_type,
    r.insurance_type,
    r.insurance_flag,
    r.item_value,
    r.item_category,
    r.item_type,
    r.consignor_flag,
    r.consignor_name,
    r.consignor_phone,
    r.shipper_name,
    r.shipper_phone,
    r.shipper_province,
    r.shipper_city,
    r.shipper_district,
    r.shipper_address,
    r.shipper_address_info,
    formatDateTime(r.reviewed_at),
    formatDateTime(r.created_at),
    formatDateTime(r.updated_at),
  ]);

  const sheetRows: (string | number)[][] = [[...HEADERS], ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  const colCount = HEADERS.length;
  ws["!cols"] = Array.from({ length: colCount }, (_, col) => ({
    wch: colWidth(
      [HEADERS[col], ...dataRows.map((row) => row[col] ?? "")],
      8,
      col === 13 || col === 29 ? 48 : 36,
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
