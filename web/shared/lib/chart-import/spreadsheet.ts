import type { ImportedChart } from '@/types/chart-import';
import type { WorkBook } from 'xlsx';

export interface ChartWorkbook { book: WorkBook; fileName: string; sha256: string; importedAt: string }
export const MAX_CHART_FILE_BYTES = 10 * 1024 * 1024;

export async function fileDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function readChartWorkbook(file: File): Promise<ChartWorkbook> {
  if (file.size > MAX_CHART_FILE_BYTES) throw new Error('Use a file smaller than 10 MB.');
  const XLSX = await import('xlsx');
  const bytes = await file.arrayBuffer();
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true });
  if (!book.SheetNames.length) throw new Error('No worksheets found.');
  return { book, fileName: file.name, sha256: await fileDigest(bytes), importedAt: new Date().toISOString() };
}

export async function defaultChartRange(workbook: ChartWorkbook, sheetName: string): Promise<string> {
  const { utils } = await import('xlsx');
  const sheet = workbook.book.Sheets[sheetName];
  const range = utils.decode_range(sheet?.['!ref'] || 'A1:B2');
  range.e.r = Math.min(range.e.r, range.s.r + 12);
  range.e.c = Math.min(range.e.c, 127);
  return utils.encode_range(range);
}

export function parseChartNumber(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, '').replace(/^[$£€]/, '');
  if (!cleaned) return null;
  const normalized = /^\([\d.]+\)$/.test(cleaned) ? `-${cleaned.slice(1, -1)}` : cleaned;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(normalized)) return null;
  const number = Number(normalized.replace(/%$/, ''));
  return Number.isFinite(number) && Math.abs(number) <= 1e15 ? number : null;
}

/** Explicit header + category column: no heuristic skips, no missing-value zeroes. */
export async function chartFromRange(workbook: ChartWorkbook, sheetName: string, reference: string): Promise<ImportedChart> {
  const XLSX = await import('xlsx');
  const sheet = workbook.book.Sheets[sheetName];
  if (!sheet || !/^[A-Z]+[1-9]\d*:[A-Z]+[1-9]\d*$/i.test(reference.trim())) throw new Error('Enter a range such as A1:C8, including the header row.');
  const range = XLSX.utils.decode_range(reference.trim().toUpperCase());
  const rows = range.e.r - range.s.r; const cols = range.e.c - range.s.c;
  if (rows < 1 || cols < 1) {
    throw new Error('Choose a header row, at least one data row and numeric columns.');
  }
  const populated = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  if (range.s.r < populated.s.r || range.s.c < populated.s.c || range.e.r > populated.e.r || range.e.c > populated.e.c) {
    throw new Error('Selected range is outside the worksheet data.');
  }
  const cellAt = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })];
  const warnings: string[] = [];
  const labels = Array.from({ length: rows }, (_, i) => {
    const cell = cellAt(range.s.r + i + 1, range.s.c);
    return cell ? XLSX.utils.format_cell(cell) : '';
  });
  const formats = new Set<string>();
  const series = Array.from({ length: cols }, (_, c) => ({
    name: String(cellAt(range.s.r, range.s.c + c + 1)?.v ?? `Series ${c + 1}`),
    values: Array.from({ length: rows }, (_, r) => {
      const rr = range.s.r + r + 1; const cc = range.s.c + c + 1;
      const cell = cellAt(rr, cc);
      if (cell?.f) warnings.push(`Formula at ${XLSX.utils.encode_cell({ r: rr, c: cc })}: uses the workbook's saved value; formulas are not recalculated.`);
      if (!cell || cell.t === 'e' || cell.t === 'b' || cell.v === undefined || cell.v === null || cell.v === '') return null;
      const percent = typeof cell.z === 'string' && cell.z.includes('%');
      formats.add(percent ? 'percent' : 'number');
      const value = typeof cell.v === 'number' ? cell.v : parseChartNumber(String(cell.v));
      if (value === null || !Number.isFinite(value)) return null;
      const displayed = percent ? Number((value * 100).toPrecision(15)) : value;
      if (Math.abs(displayed) > 1e15) {
        warnings.push(`Value at ${XLSX.utils.encode_cell({ r: rr, c: cc })} exceeds the supported range and needs review.`);
        return null;
      }
      return displayed;
    }),
  }));
  if (formats.size > 1) warnings.push('Mixed percentage and numeric columns: split these into separate charts; this trial does not use a second axis.');
  return {
    version: 1, title: sheetName, kind: cols > 1 ? 'grouped-bar' : 'bar',
    unit: formats.size === 1 && formats.has('percent') ? '%' : '', labels, series,
    source: { kind: 'spreadsheet', fileName: workbook.fileName,
      locator: `${sheetName}!${XLSX.utils.encode_range(range)}`, sha256: workbook.sha256,
      importedAt: workbook.importedAt, asOf: '' },
    warnings: [...new Set(warnings)].slice(0, 25), annotations: [], allowGaps: false, reviewed: false, theme: 'light', userEdited: false,
    presentation: { valueAxis: true, grid: true, legend: true, trendArrow: false },
  };
}
