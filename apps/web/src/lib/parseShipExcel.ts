import * as XLSX from "xlsx";

export type ShipExcelRow = {
  /** 行号（从 1 起；Excel 含表头，文本为物理行号） */
  row: number;
  order_no: string;
  shipping_order_no: string;
};

export type ParseShipExcelResult = {
  rows: ShipExcelRow[];
  sheetName: string;
};

export type ParseShipTextResult = {
  rows: ShipExcelRow[];
};

const ORDER_NO_ALIASES = [
  "订单号",
  "电商订单号",
  "ORDER_NO",
  "ORDER NO",
  "ORDERNO",
  "ORDER NUMBER",
];

const SHIPPING_NO_ALIASES = [
  "运单号",
  "物流单号",
  "快递单号",
  "发货订单号",
  "SHIPPING_ORDER_NO",
  "WAYBILL",
  "WAYBILL_NO",
  "TRACKING",
  "TRACKING_NO",
  "TRACKING NUMBER",
];

function isHeaderPair(orderNo: string, shippingNo: string): boolean {
  const o = orderNo.toUpperCase();
  const s = shippingNo.toUpperCase();
  return (
    ORDER_NO_ALIASES.some((a) => a.toUpperCase() === o) &&
    SHIPPING_NO_ALIASES.some((a) => a.toUpperCase() === s)
  );
}

/**
 * 解析粘贴文本：每行「订单号 + 运单号」，支持 Tab / 多空格 / 逗号分隔。
 * 例：
 * TEST-MRXUV4DL-030\tWB37081261001
 * COD-TEST-001 WB37081261007
 */
export function parseShipText(raw: string): ParseShipTextResult {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: ShipExcelRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const parts = line.split(/[\t,，;；]+|\s{2,}|\s+/).filter(Boolean);
    if (parts.length < 2) {
      throw new Error(
        `第 ${i + 1} 行格式无效，请使用「订单号 + 运单号」（可用 Tab / 空格 / 逗号分隔）`,
      );
    }
    if (parts.length > 2) {
      throw new Error(
        `第 ${i + 1} 行有过多列（${parts.length}），每行只需订单号与运单号`,
      );
    }

    const orderNo = parts[0]!.trim();
    const shippingNo = parts[1]!.trim();
    if (rows.length === 0 && isHeaderPair(orderNo, shippingNo)) {
      continue;
    }
    if (!orderNo) {
      throw new Error(`第 ${i + 1} 行缺少订单号`);
    }
    if (!shippingNo) {
      throw new Error(`第 ${i + 1} 行（订单号 ${orderNo}）缺少运单号`);
    }
    if (seen.has(orderNo)) {
      throw new Error(`订单号重复：${orderNo}`);
    }
    seen.add(orderNo);
    rows.push({
      row: i + 1,
      order_no: orderNo,
      shipping_order_no: shippingNo,
    });
  }

  if (rows.length === 0) {
    throw new Error("没有有效的发货数据行");
  }
  return { rows };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    // 避免科学计数法；大整数 Excel 可能以 number 读入
    return Number.isInteger(value)
      ? String(Math.trunc(value))
      : String(value).trim();
  }
  return String(value).trim();
}

function normalizeHeader(value: unknown): string {
  return cellText(value).replace(/\s+/g, " ").trim();
}

function findColumn(headers: string[], aliases: string[]): number {
  const upperAliases = aliases.map((a) => a.toUpperCase());
  return headers.findIndex((h) => upperAliases.includes(h.toUpperCase()));
}

/**
 * 解析批量发货 Excel：表头需含「订单号」「运单号」（列位置不限）。
 */
export function parseShipExcel(data: ArrayBuffer): ParseShipExcelResult {
  const workbook = XLSX.read(data, { type: "array" });
  if (workbook.SheetNames.length === 0) {
    throw new Error("Excel 中没有工作表");
  }

  let chosen: { sheet: XLSX.WorkSheet; name: string; headers: string[] } | null =
    null;

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]!;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    if (matrix.length < 1) continue;
    const headers = (matrix[0] ?? []).map(normalizeHeader);
    const orderCol = findColumn(headers, ORDER_NO_ALIASES);
    const shipCol = findColumn(headers, SHIPPING_NO_ALIASES);
    if (orderCol >= 0 && shipCol >= 0 && orderCol !== shipCol) {
      chosen = { sheet, name, headers };
      break;
    }
  }

  if (!chosen) {
    throw new Error(
      "未识别到「订单号」「运单号」列，请使用包含这两列表头的 Excel",
    );
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(chosen.sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const headers = (matrix[0] ?? []).map(normalizeHeader);
  const orderCol = findColumn(headers, ORDER_NO_ALIASES);
  const shipCol = findColumn(headers, SHIPPING_NO_ALIASES);

  const rows: ShipExcelRow[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const orderNo = cellText(row[orderCol]);
    const shippingNo = cellText(row[shipCol]);
    if (!orderNo && !shippingNo) continue;
    if (!orderNo) {
      throw new Error(`第 ${i + 1} 行缺少订单号`);
    }
    if (!shippingNo) {
      throw new Error(`第 ${i + 1} 行（订单号 ${orderNo}）缺少运单号`);
    }
    if (seen.has(orderNo)) {
      throw new Error(`订单号重复：${orderNo}`);
    }
    seen.add(orderNo);
    rows.push({
      row: i + 1,
      order_no: orderNo,
      shipping_order_no: shippingNo,
    });
  }

  if (rows.length === 0) {
    throw new Error("没有有效的发货数据行");
  }

  return { rows, sheetName: chosen.name };
}
