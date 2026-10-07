import { validateImportedChart, type ImportedChart } from '@/types/chart-import';
import { chartFromRange, defaultChartRange, type ChartWorkbook } from './spreadsheet';
import { appendFigureSheets, figureFromWorkbook } from './figure-excel';

const META = '_CRE_Chart'; const SIGNATURE = 'CRE Studio Chart v1'; const DATA = 'Chart Data';

/** Excel carries editable cells plus chart settings, not an executable embedded chart. */
export async function chartExcelFile(chart: ImportedChart): Promise<File> {
  const XLSX = await import('xlsx'); const value = validateImportedChart(chart);
  const book = XLSX.utils.book_new();
  const rows = [['Category', ...value.series.map(series => series.name)], ...value.labels.map((label, i) => [label, ...value.series.map(series => series.values[i])])];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++) for (let c = 1; c <= value.series.length; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    if (cell?.t === 'n') {
      if (value.unit === '%') cell.v = Number(cell.v) / 100;
      cell.z = value.unit === '%' ? '0.########%' : '#,##0.########;[Red](#,##0.########)';
    }
  }
  sheet['!cols'] = [{ wch: 28 }, ...value.series.map(() => ({ wch: 22 }))];
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  if (value.referenceFigure) await appendFigureSheets(book, value);
  else XLSX.utils.book_append_sheet(book, sheet, DATA);
  const info = XLSX.utils.aoa_to_sheet([
    ['Chart', value.title], ['Unit', value.unit], ['Instructions', value.referenceFigure
      ? 'Edit this figure’s data sheets, keep worksheet names and row counts, save in Excel, then import into the same OM chart. Review totals, margins and CAGR separately in their annotation sheets.'
      : 'Edit Chart Data, save in Excel, then import this file in Chartloom. Blank cells remain unknown.'],
    ['Source file', value.source.fileName], ['Source location', value.source.locator], ['Source date', value.source.asOf || 'Not provided'],
    ['Source SHA-256', value.source.sha256], ['User-edited data', value.userEdited ? 'Yes; check values and callouts against the source.' : 'No'],
    ['Formula handling', 'Import reads saved formula results; recalculate and save in Excel first.'],
    ...(value.referenceFigure ? [['Data quality', value.referenceFigure.quality], ['Source annotations', 'Printed totals, margins and CAGR are preserved independently; they are not recalculated.']] : []),
    ...value.annotations.map((note, i) => [`Note ${i + 1}`, note]),
  ]);
  info['!cols'] = [{ wch: 24 }, { wch: 110 }]; XLSX.utils.book_append_sheet(book, info, 'Source and notes');
  const json = JSON.stringify(value); const chunks = [SIGNATURE];
  for (let offset = 0; offset < json.length; offset += 30000) chunks.push(json.slice(offset, offset + 30000));
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(chunks.map(chunk => [chunk])), META);
  book.Workbook = { Sheets: book.SheetNames.map(name => ({ name, Hidden: name === META ? 2 : 0 })) };
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true });
  return new File([bytes], 'chart-data.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function workbookChart(workbook: ChartWorkbook): ImportedChart | undefined {
  const sheet = workbook.book.Sheets[META];
  if (!sheet || sheet.A1?.v !== SIGNATURE) return undefined;
  let json = '';
  for (let row = 2; row <= 32 && sheet[`A${row}`]; row++) json += String(sheet[`A${row}`].v ?? '');
  try { return validateImportedChart(JSON.parse(json)); } catch { throw new Error('The chart settings in this Excel file are damaged. Export a fresh workbook or import a plain data sheet.'); }
}

export function chartWorksheetNames(workbook: ChartWorkbook): string[] {
  const template = workbookChart(workbook);
  return template?.referenceFigure ? workbook.book.SheetNames.filter(name => ![META, 'Source and notes'].includes(name)) : template ? [DATA] : workbook.book.SheetNames;
}

export async function defaultChartWorkbookRange(workbook: ChartWorkbook, sheet: string): Promise<string> {
  if (workbook.book.Sheets[META]?.A1?.v === SIGNATURE) return workbook.book.Sheets[sheet]?.['!ref'] || 'A1:B2';
  return defaultChartRange(workbook, sheet);
}

/** Use the visible cells as the authority; hidden settings never override edited numbers. */
export async function chartFromWorkbook(workbook: ChartWorkbook, sheet: string, range: string, existing?: ImportedChart): Promise<ImportedChart> {
  const saved = workbookChart(workbook);
  if (existing?.referenceFigure && saved?.referenceFigure && existing.referenceFigure.key !== saved.referenceFigure.key) throw new Error('This workbook belongs to a different chart. Open that chart or use this chart’s exported Excel file.');
  const referenceTemplate = existing?.referenceFigure ? existing : saved?.referenceFigure ? saved : undefined;
  if (referenceTemplate) return figureFromWorkbook(workbook, referenceTemplate);
  const cells = await chartFromRange(workbook, sheet, range);
  const template = existing ?? (sheet === DATA ? saved : undefined);
  if (!template) return cells;
  const changed = JSON.stringify([template.labels, template.series]) !== JSON.stringify([cells.labels, cells.series]);
  return validateImportedChart({ ...template, labels: cells.labels, series: cells.series,
    kind: template.kind === 'bar' && cells.series.length > 1 ? 'grouped-bar' : template.kind,
    unit: cells.unit || template.unit, userEdited: template.userEdited || changed, reviewed: false,
    dataFile: { fileName: workbook.fileName, sha256: workbook.sha256 },
    warnings: [...new Set([...template.warnings, ...cells.warnings])].slice(0, 25) });
}
