import { figureTables, updateFigureCells, type FigureCell } from './figure-tables';
import { parseChartNumber, type ChartWorkbook } from './spreadsheet';
import { validateImportedChart, type ImportedChart } from '@/types/chart-import';
import type { WorkBook } from 'xlsx';

export async function appendFigureSheets(book: WorkBook, chart: ImportedChart) {
  const { utils } = await import('xlsx');
  for (const table of figureTables(chart.referenceFigure!)) {
    const sheet = utils.aoa_to_sheet([table.headers, ...table.rows]);
    sheet['!cols'] = table.headers.map((_, i) => ({ wch: i === 0 ? 36 : 25 }));
    sheet['!autofilter'] = { ref: sheet['!ref']! }; utils.book_append_sheet(book, sheet, table.name);
  }
}

export async function figureFromWorkbook(workbook: ChartWorkbook, template: ImportedChart): Promise<ImportedChart> {
  const { utils } = await import('xlsx');
  const changes = figureTables(template.referenceFigure!).flatMap(table => {
    const sheet = workbook.book.Sheets[table.name];
    if (!sheet) throw new Error(`Missing sheet "${table.name}". Use this figure's exported Excel workbook.`);
    return table.rows.flatMap((row, r) => row.map((old, c) => {
      if (!table.paths[r][c].length) return { path: [], value: old };
      const address = utils.encode_cell({ r: r + 1, c }); const cell = sheet[address];
      if (cell?.f && (cell.v === undefined || cell.v === null)) throw new Error(`Recalculate and save ${table.name}!${address} in Excel first.`);
      let value: FigureCell = cell?.v === undefined || cell.v === null ? '' : String(cell.v);
      if (typeof old === 'number' || old === null) { value = typeof cell?.v === 'number' ? cell.v : parseChartNumber(String(value)); if (value === null && cell?.v !== undefined && String(cell.v).trim() !== '') throw new Error(`Invalid number at ${table.name}!${address}.`); }
      else if (typeof old === 'boolean') { if (!/^(true|false|1|0)$/i.test(String(value))) throw new Error(`Use TRUE or FALSE at ${table.name}!${address}.`); value = /^(true|1)$/i.test(String(value)); }
      return { path: table.paths[r][c], value };
    }));
  });
  const referenceFigure = updateFigureCells(template.referenceFigure!, changes);
  const changed = JSON.stringify(referenceFigure) !== JSON.stringify(template.referenceFigure);
  return validateImportedChart({ ...template, referenceFigure, reviewed: false, userEdited: template.userEdited || changed,
    dataFile: { fileName: workbook.fileName, sha256: workbook.sha256 } });
}
