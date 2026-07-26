import * as XLSX from "xlsx";
import dayjs from "dayjs";

export type LogisticsExportRow = {
  weight: number | "";
  shipper_name: string;
  shipper_phone: string;
  shipper_province: string;
  shipper_city: string;
  shipper_district: string;
  shipper_address: string;
  shipper_address_info: string;
  consignor_flag: string;
  consignor_name: string;
  consignor_phone: string;
  customer_name: string;
  customer_phone: string;
  shipping_province: string;
  shipping_city: string;
  shipping_district: string;
  shipping_detail: string;
  shipping_address_info: string;
  payment_method: string;
  sku_quantity: string;
  item_category: string;
  item_value: number | "";
  insurance_type: string;
  insurance_flag: string;
  package_count: number;
  item_type: string;
  remark: string;
  /** 系统订单号 → 模板「电商订单号」 */
  order_no: string;
  /** 运单号 / 物流订单号 */
  logistics_order_no: string;
  cod_amount: number | "";
  express_type: string;
  shipping_fee: number | "";
  other_fee: number | "";
};

/** 极兔物流导入模板列；订单号、物流订单号置于最前 */
const HEADERS = [
  "订单号",
  "物流订单号",
  "重量",
  "寄件人",
  "寄件人电话",
  "寄件省",
  "寄件城市",
  "寄件区域",
  "寄件地址",
  "寄件地址信息",
  "委托人标识",
  "委托人姓名",
  "委托人电话",
  "收件人",
  "收件人电话",
  "收件省",
  "收件城市",
  "收件地区",
  "收件地址",
  "收件地址信息",
  "支付方式",
  "中文属性*数量",
  "物品类别",
  "物品价值",
  "保价类型",
  "保价费标识",
  "件数",
  "物品类型",
  "备注",
  "电商订单号",
  "代收货款",
  "快件类型",
  "应收运费",
  "其它费",
] as const;

function displayWidth(value: string | number): number {
  const s = String(value ?? "");
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0xff ? 2 : 1;
  }
  return w;
}

function colWidth(values: (string | number)[], min = 8, max = 56): number {
  let widest = min;
  for (const v of values) {
    widest = Math.max(widest, displayWidth(v) + 2);
  }
  return Math.min(widest, max);
}

export function buildLogisticsExcel(rows: LogisticsExportRow[]): Blob {
  const dataRows = rows.map((r) => [
    r.order_no,
    r.logistics_order_no,
    r.weight,
    r.shipper_name,
    r.shipper_phone,
    r.shipper_province,
    r.shipper_city,
    r.shipper_district,
    r.shipper_address,
    r.shipper_address_info,
    r.consignor_flag,
    r.consignor_name,
    r.consignor_phone,
    r.customer_name,
    r.customer_phone,
    r.shipping_province,
    r.shipping_city,
    r.shipping_district,
    r.shipping_detail,
    r.shipping_address_info,
    r.payment_method,
    r.sku_quantity,
    r.item_category,
    r.item_value,
    r.insurance_type,
    r.insurance_flag,
    r.package_count,
    r.item_type,
    r.remark,
    r.order_no,
    r.cod_amount,
    r.express_type,
    r.shipping_fee,
    r.other_fee,
  ]);

  const sheetRows: (string | number)[][] = [[...HEADERS], ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  ws["!cols"] = Array.from({ length: HEADERS.length }, (_, col) => ({
    wch: colWidth(
      [HEADERS[col], ...dataRows.map((row) => row[col] ?? "")],
      col === 18 || col === 8 ? 24 : col <= 1 ? 16 : 8,
      col === 18 || col === 8 ? 64 : 40,
    ),
  }));
  ws["!rows"] = sheetRows.map((_, i) => ({ hpt: i === 0 ? 22 : 18 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "物流导出");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function logisticsExportFilename(
  from: dayjs.Dayjs,
  to: dayjs.Dayjs,
  statusLabel: string,
): string {
  const range = `${from.format("YYYYMMDD")}-${to.format("YYYYMMDD")}`;
  const stamp = dayjs().format("YYYYMMDD_HHmmss");
  return `物流导出_${statusLabel}_${range}_${stamp}.xlsx`;
}
