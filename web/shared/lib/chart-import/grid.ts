import type { ImportedChart } from '@/types/chart-import';
import { parseChartNumber } from './spreadsheet';

export function chartColumnLabel(index: number): string {
  let label = '';
  for (let column = index + 1; column > 0; column = Math.floor((column - 1) / 26)) {
    label = String.fromCharCode(65 + (column - 1) % 26) + label;
  }
  return label;
}

/** Atomic rectangular paste. A negative row is the header; column zero holds categories. */
export function pasteChartCells(chart: ImportedChart, row: number, column: number, text: string): ImportedChart {
  const cells = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
  const rowCount = Math.max(chart.labels.length, row + cells.length);
  const seriesCount = Math.max(chart.series.length, column + Math.max(...cells.map(line => line.length)) - 1);
  if (row < -1 || column < 0) throw new Error('Paste data at a valid table position.');
  const labels = Array.from({ length: rowCount }, (_, i) => chart.labels[i] ?? '');
  const series = Array.from({ length: seriesCount }, (_, i) => ({ name: chart.series[i]?.name ?? `Series ${i + 1}`,
    values: Array.from({ length: rowCount }, (_, j) => chart.series[i]?.values[j] ?? null) }));
  cells.forEach((line, ri) => line.forEach((cell, ci) => {
    const r = row + ri; const c = column + ci;
    if (r === -1) { if (c > 0) series[c - 1].name = cell.slice(0, 120); return; }
    if (c === 0) { labels[r] = cell.slice(0, 120); return; }
    const value = parseChartNumber(cell);
    if (cell.trim() && value === null) throw new Error(`Cell ${chartColumnLabel(c)}${r + 2} is not a number. Paste saved values; formulas are not calculated.`);
    series[c - 1].values[r] = value;
  }));
  return { ...chart, labels, series, kind: chart.kind === 'bar' && series.length > 1 ? 'grouped-bar' : chart.kind, userEdited: true, reviewed: false };
}
