import * as XLSX from "xlsx";
import dayjs from "dayjs";

export type FinanceExportRow = {
  order_no: string;
  product_name: string;
  created_at: string;
  total_amount: number;
  owner_member: string;
  sku_quantity: string;
  quantity: number;
};

const HEADERS = [
  "订单号",
  "商品",
  "下单时间",
  "订单总金额",
  "归属成员",
  "中文属性*数量",
  "购买数量",
] as const;

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

function colWidth(values: (string | number)[], min = 10, max = 48): number {
  let widest = min;
  for (const v of values) {
    widest = Math.max(widest, displayWidth(v) + 2);
  }
  return Math.min(widest, max);
}

/** 生成对齐财务系统导出模板的 xlsx，返回可下载 Blob */
export function buildFinanceExcel(rows: FinanceExportRow[]): Blob {
  const dataRows = rows.map((r) => [
    r.order_no,
    r.product_name,
    r.created_at ? dayjs(r.created_at).format("YYYY-MM-DD HH:mm:ss") : "",
    r.total_amount,
    r.owner_member,
    r.sku_quantity,
    r.quantity,
  ]);

  const sheetRows: (string | number)[][] = [[...HEADERS], ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  const colCount = HEADERS.length;
  ws["!cols"] = Array.from({ length: colCount }, (_, col) => ({
    wch: colWidth(
      [HEADERS[col], ...dataRows.map((row) => row[col] ?? "")],
      col === 2 ? 20 : 10, // 下单时间列保底
      col === 1 || col === 5 ? 56 : 40,
    ),
  }));

  // 表头加粗不可用社区版样式；用行高保证可读
  ws["!rows"] = sheetRows.map((_, i) => ({ hpt: i === 0 ? 22 : 18 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "财务导出");
  const buffer = XLSX.write(wb, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
  });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** 按导出时刻生成唯一文件名 */
export function financeExportFilename(from: dayjs.Dayjs, to: dayjs.Dayjs): string {
  const range = `${from.format("YYYYMMDD")}-${to.format("YYYYMMDD")}`;
  const stamp = dayjs().format("YYYYMMDD_HHmmss");
  return `财务导出_${range}_${stamp}.xlsx`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
