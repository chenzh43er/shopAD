import * as XLSX from "xlsx";
import {
  ORDER_NO_ALIASES,
  SHIPPING_NO_ALIASES,
  type ShipExcelRow,
} from "./parseShipText";

export type { ShipExcelRow, ParseShipTextResult } from "./parseShipText";
export { parseShipText } from "./parseShipText";

export type ParseShipExcelResult = {
  rows: ShipExcelRow[];
  sheetName: string;
};

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
