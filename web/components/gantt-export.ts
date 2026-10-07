import type { ChartSource, ImportedChart } from '@/types/chart-import';
import { ganttErrors, type GanttData } from './gantt';

export function ganttCarrier(f: GanttData, source: ChartSource, reviewed: boolean): ImportedChart {
  return { version: 1, title: f.title, kind: 'grouped-bar', unit: 'Source-axis fraction', labels: f.tasks.map(t => t.label), series: [{ name: 'Start', values: f.tasks.map(t => t.start) }, { name: 'End', values: f.tasks.map(t => t.end) }], source, warnings: [], annotations: ['Positions are relative to the source graphic; exact calendar dates have not been inferred.'], allowGaps: false, reviewed, userEdited: true, theme: 'light', presentation: { valueAxis: false, grid: false, legend: false, trendArrow: false } };
}
export async function ganttExcel(f: GanttData, source: ChartSource) {
  const X = await import('xlsx'), book = X.utils.book_new();
  const add = (name: string, rows: unknown[][], widths: number[]) => { const sheet = X.utils.aoa_to_sheet(rows); sheet['!cols'] = widths.map(wch => ({ wch })); X.utils.book_append_sheet(book, sheet, name); };
  add('Tasks', [['Task', 'Start (0–1)', 'End (0–1)', 'Milestone'], ...f.tasks.map(t => [t.label, t.start, t.end, t.milestone])], [70, 18, 18, 15]);
  add('Phases', [['Phase', 'First task (1-based)', 'Task count'], ...f.phases.map(p => [p.title || p.label, p.firstRow + 1, p.rowCount])], [40, 24, 18]);
  add('Time axis', [['Tick'], ...f.ticks.map(t => [t])], [35]);
  add('Callouts', [['Text', 'Position (0–1)', 'Task (1-based; optional)'], ...(f.annotations || []).map(a => [a.text, a.position, a.row === undefined ? null : a.row + 1])], [60, 22, 28]);
  add('Source', [['File', source.fileName], ['Page', source.locator], ['As of', source.asOf], ['SHA256', source.sha256], ['Coordinate meaning', 'Relative source-graphic positions, not verified calendar days.'], ['Title', f.title]], [25, 100]);
  return new Blob([X.write(book, { type: 'array', bookType: 'xlsx', compression: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export async function ganttFromExcel(file: File, original: GanttData): Promise<GanttData> {
  const X = await import('xlsx'), book = X.read(await file.arrayBuffer(), { type: 'array' });
  const rows = (name: string): any[][] => { if (!book.Sheets[name]) throw Error(`缺少 ${name} 工作表。`); return X.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' }).slice(1) as any[][]; };
  const numeric = (v: any) => v === '' ? NaN : Number(v);
  const f: GanttData = { ...original, tasks: rows('Tasks').map(r => { if (![true, false, 0, 1, 'true', 'false', 'TRUE', 'FALSE', ''].includes(r[3])) throw Error('Milestone 仅接受 TRUE / FALSE。'); return { label: String(r[0] || ''), start: numeric(r[1]), end: numeric(r[2]), milestone: [true, 1, 'true', 'TRUE'].includes(r[3]) }; }), phases: rows('Phases').map(r => ({ title: String(r[0] || ''), firstRow: numeric(r[1]) - 1, rowCount: numeric(r[2]) })), ticks: rows('Time axis').map(r => String(r[0] || '')), annotations: rows('Callouts').map(r => ({ text: String(r[0] || ''), position: numeric(r[1]), ...(r[2] === '' ? {} : { row: numeric(r[2]) - 1 }) })) };
  const errors = ganttErrors(f); if (errors.length) throw Error(errors[0]);
  return f;
}
