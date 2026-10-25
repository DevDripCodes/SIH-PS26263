import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
  /** 1-based line/row number of each data row in the source file, so errors can point back at it */
  rowNumbers: number[];
}

export class ParseError extends Error {}

export function parseCsv(buffer: Buffer): ParsedSheet {
  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parse(buffer, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      info: true,
    }) as unknown as typeof records;
  } catch (err) {
    throw new ParseError(`Could not read CSV: ${(err as Error).message}`);
  }
  const [header, ...body] = records;
  if (!header) throw new ParseError("The CSV file is empty.");
  return toSheet(
    header.record,
    body.map((r) => r.record),
    body.map((r) => r.info.lines),
  );
}

export async function parseExcel(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ParseError("Could not read the Excel file. Save it as .xlsx (Excel 2007+) and try again.");
  }
  const sheet = workbook.worksheets.find((ws) => ws.state === "visible") ?? workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) throw new ParseError("The Excel file has no data.");

  const width = sheet.columnCount;
  const matrix: string[][] = [];
  const numbers: number[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= width; c++) values.push(cellToString(row.getCell(c).value));
    if (values.some((v) => v !== "")) {
      matrix.push(values);
      numbers.push(row.number);
    }
  });

  const [headerRow, ...body] = matrix;
  if (!headerRow) throw new ParseError("The Excel file has no header row.");
  return toSheet(headerRow, body, numbers.slice(1));
}

function toSheet(headerRow: string[], body: string[][], rowNumbers: number[]): ParsedSheet {
  const headers = headerRow.map((h, i) => (h.trim() ? h.trim() : `column_${i + 1}`));
  const rows = body.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
  return { headers, rows, rowNumbers };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
    if ("error" in value) return "";
  }
  return String(value).trim();
}
