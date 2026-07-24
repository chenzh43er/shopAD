import * as XLSX from "xlsx";

const LEVEL_HEADER_RE = /^(\d+)\s*级区域$/;
const PREFERRED_SHEET_HINTS = ["导入", "地址库", "后台"];

/** 极兔 Sheet1 列名兜底映射 */
const LEGACY_LEVEL_HEADERS = [
  ["PROVINSI", "一级区域", "省", "PROVINCE"],
  ["KABUPATEN", "二级区域", "市", "KOTA", "CITY"],
  ["DESTINASI KECAMATAN", "三级区域", "区", "KECAMATAN", "DISTRICT"],
];

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim();
  }
  return String(value).trim();
}

function normalizeHeader(value: unknown): string {
  return cellText(value).replace(/\s+/g, " ").trim();
}

function detectLevelColumns(headers: string[]): number[] | null {
  const indexed: { level: number; col: number }[] = [];
  for (let col = 0; col < headers.length; col++) {
    const h = headers[col] ?? "";
    const m = h.match(LEVEL_HEADER_RE);
    if (m) {
      indexed.push({ level: Number(m[1]), col });
    }
  }
  if (indexed.length > 0) {
    indexed.sort((a, b) => a.level - b.level);
    // 要求从 1 连续
    for (let i = 0; i < indexed.length; i++) {
      if (indexed[i]!.level !== i + 1) return null;
    }
    return indexed.map((x) => x.col);
  }

  // 兼容 PROVINSI / KABUPATEN / DESTINASI KECAMATAN
  const cols: number[] = [];
  for (const aliases of LEGACY_LEVEL_HEADERS) {
    const upperAliases = aliases.map((a) => a.toUpperCase());
    const col = headers.findIndex((h) =>
      upperAliases.includes(h.toUpperCase()),
    );
    if (col < 0) break;
    cols.push(col);
  }
  return cols.length >= 1 ? cols : null;
}

function pickSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  const names = workbook.SheetNames;
  if (names.length === 0) {
    throw new Error("Excel 中没有工作表");
  }

  const preferred = names.find((name) =>
    PREFERRED_SHEET_HINTS.some((hint) => name.includes(hint)),
  );
  if (preferred) return workbook.Sheets[preferred]!;

  // 优先选能识别表头的 sheet
  for (const name of names) {
    const sheet = workbook.Sheets[name]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    const header = (rows[0] ?? []).map(normalizeHeader);
    if (detectLevelColumns(header)) return sheet;
  }

  return workbook.Sheets[names[0]!]!;
}

export type ParseAddressRegionExcelResult = {
  paths: string[][];
  maxLevel: number;
  sheetName: string;
};

/**
 * 解析地区区域 Excel。
 * 支持表头「一级区域 / 二级区域 / 三级区域 / 四级区域…」（二级及以上均可），
 * 以及 PROVINSI / KABUPATEN / DESTINASI KECAMATAN。
 */
export function parseAddressRegionExcel(
  data: ArrayBuffer,
): ParseAddressRegionExcelResult {
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName =
    workbook.SheetNames.find((name) =>
      PREFERRED_SHEET_HINTS.some((hint) => name.includes(hint)),
    ) ??
    workbook.SheetNames[0] ??
    "";
  const sheet = pickSheet(workbook);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (rows.length < 2) {
    throw new Error("文件没有可导入的数据行");
  }

  const headers = (rows[0] ?? []).map(normalizeHeader);
  const levelCols = detectLevelColumns(headers);
  if (!levelCols) {
    throw new Error(
      "未识别到区域列，请使用「一级区域 / 二级区域 / …」表头（支持二级、三级、四级等）",
    );
  }

  const paths: string[][] = [];
  let maxLevel = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const parts: string[] = [];
    for (const col of levelCols) {
      const text = cellText(row[col]);
      if (!text) break;
      parts.push(text);
    }
    if (parts.length === 0) continue;
    maxLevel = Math.max(maxLevel, parts.length);
    paths.push(parts);
  }

  if (paths.length === 0) {
    throw new Error("没有有效的地域数据");
  }

  return {
    paths,
    maxLevel,
    sheetName:
      workbook.SheetNames.find((n) => workbook.Sheets[n] === sheet) ?? sheetName,
  };
}
