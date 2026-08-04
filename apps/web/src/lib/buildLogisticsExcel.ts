import ExcelJS from "exceljs";
import dayjs from "dayjs";

/**
 * 极兔物流导入模板：仅标红列取订单数据，其余列按模板固定文本填充。
 * 标红列：收件人 / 收件人电话 / 收件地区 / 收件地址 / 中文属性*数量 / 备注 / 电商订单号 / 代收货款
 */
export type LogisticsExportRow = {
  customer_name: string;
  customer_phone: string;
  shipping_district: string;
  /** 收件地址：省,市,区,明细（对齐模板样例） */
  shipping_address: string;
  sku_quantity: string;
  remark: string;
  order_no: string;
  cod_amount: number | "";
};

/** 与「物流导出模板.xlsx」表头严格一致（A–AF，共 32 列） */
const HEADERS = [
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

/** 模板中非标红列的固定填充（取自模板样例行） */
const FIXED = {
  weight: "1",
  shipper_name: "UBT",
  shipper_phone: "087893521997",
  shipper_province: "",
  shipper_city: "JAKARTA",
  shipper_district: "",
  shipper_address: "ruko Mutiara Palem  cengkareng Jakarta Barat.",
  shipper_address_info: "",
  consignor_flag: "0",
  consignor_name: "",
  consignor_phone: "",
  shipping_province: "",
  shipping_city: "",
  shipping_address_info: "",
  payment_method: "月结",
  item_category: "",
  item_value: "",
  insurance_type: "",
  insurance_flag: "0",
  package_count: "1",
  item_type: "BARANG",
  express_type: "EZ",
  shipping_fee: "",
  other_fee: "",
} as const;

/** 对齐模板黑字列：宋体 11（导出不标红） */
const FONT: Partial<ExcelJS.Font> = {
  name: "宋体",
  size: 11,
  color: { argb: "FF000000" },
  charset: 134,
};

/** 模板列宽均为 20.6；默认行高 13.5 */
const COL_WIDTH = 20.6;
const ROW_HEIGHT = 13.5;

function rowValues(r: LogisticsExportRow): (string | number)[] {
  return [
    FIXED.weight,
    FIXED.shipper_name,
    FIXED.shipper_phone,
    FIXED.shipper_province,
    FIXED.shipper_city,
    FIXED.shipper_district,
    FIXED.shipper_address,
    FIXED.shipper_address_info,
    FIXED.consignor_flag,
    FIXED.consignor_name,
    FIXED.consignor_phone,
    r.customer_name,
    r.customer_phone,
    FIXED.shipping_province,
    FIXED.shipping_city,
    r.shipping_district,
    r.shipping_address,
    FIXED.shipping_address_info,
    FIXED.payment_method,
    r.sku_quantity,
    FIXED.item_category,
    FIXED.item_value,
    FIXED.insurance_type,
    FIXED.insurance_flag,
    FIXED.package_count,
    FIXED.item_type,
    r.remark,
    r.order_no,
    r.cod_amount === "" ? "" : String(r.cod_amount),
    FIXED.express_type,
    FIXED.shipping_fee,
    FIXED.other_fee,
  ];
}

function applyCellStyle(cell: ExcelJS.Cell, opts: { header?: boolean }) {
  cell.font = { ...FONT };
  // 模板数据列使用文本格式 @（numFmtId 49）
  cell.numFmt = "@";
  cell.alignment = opts.header
    ? { horizontal: "center", vertical: "middle" }
    : { vertical: "middle", wrapText: false };
}

export async function buildLogisticsExcel(
  rows: LogisticsExportRow[],
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("物流导出", {
    properties: { defaultColWidth: 9, defaultRowHeight: ROW_HEIGHT },
    views: [{ state: "normal", showGridLines: true }],
  });

  for (let i = 1; i <= HEADERS.length; i++) {
    ws.getColumn(i).width = COL_WIDTH;
  }

  const headerRow = ws.addRow([...HEADERS]);
  headerRow.height = ROW_HEIGHT;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    applyCellStyle(cell, { header: true });
  });

  for (const r of rows) {
    const values = rowValues(r);
    const dataRow = ws.addRow(values);
    dataRow.height = ROW_HEIGHT;
    dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      applyCellStyle(cell, { header: false });
      // 强制按文本写入，避免电话/订单号被科学计数
      const v = values[colNumber - 1];
      cell.value = v === "" || v == null ? "" : String(v);
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function logisticsExportFilename(statusLabel: string): string {
  const stamp = dayjs().format("YYYYMMDD_HHmmss");
  return `物流导出_${statusLabel}_${stamp}.xlsx`;
}
