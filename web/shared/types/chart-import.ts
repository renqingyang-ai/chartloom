import { referenceFigureData, validateReferenceFigure, type ReferenceFigure } from './reference-figure';

export const CHART_KINDS = ['bar', 'grouped-bar', 'stacked-bar', 'line'] as const;
export type ChartKind = typeof CHART_KINDS[number];
export interface ChartSeries { name: string; values: (number | null)[] }
export interface ChartSource {
  kind: 'spreadsheet' | 'image' | 'manual';
  fileName: string;
  locator: string;
  sha256: string;
  importedAt: string;
  asOf: string;
}
export interface ImportedChart {
  version: 1;
  title: string;
  kind: ChartKind;
  unit: string;
  labels: string[];
  series: ChartSeries[];
  source: ChartSource;
  warnings: string[];
  annotations: string[];
  allowGaps: boolean;
  presentation: { valueAxis: boolean; grid: boolean; legend: boolean; trendArrow: boolean };
  reviewed: boolean;
  theme: 'light' | 'dark';
  userEdited: boolean;
  dataFile?: { fileName: string; sha256: string };
  referenceFigure?: ReferenceFigure;
}

export function validateImportedChart(value: unknown): ImportedChart {
  if (!value || typeof value !== 'object') throw new Error('Invalid chart file.');
  const raw = value as ImportedChart;
  const referenceFigure = raw.referenceFigure ? validateReferenceFigure(raw.referenceFigure) : undefined;
  const chart = referenceFigure ? { ...raw, ...referenceFigureData(referenceFigure), referenceFigure } : raw;
  const text = (v: unknown, max = 240): v is string => typeof v === 'string' && v.length <= max;
  if (chart.version !== 1 || !CHART_KINDS.includes(chart.kind)
    || !text(chart.title) || !text(chart.unit, 80)
    || !Array.isArray(chart.labels) || chart.labels.length < 1
    || !chart.labels.every(label => text(label, 120))
    || !Array.isArray(chart.series) || (!referenceFigure && chart.series.length < 1)
    || !chart.series.every(s => text(s.name, 120) && Array.isArray(s.values)
      && s.values.length === chart.labels.length
      && s.values.every(v => v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e15)))) {
    throw new Error('Unsupported chart data. Use one or more categories with one numeric value or blank per category in every series.');
  }
  const source = chart.source;
  if (!source || !['spreadsheet', 'image', 'manual'].includes(source.kind)
    || !text(source.fileName) || !text(source.locator, 1000)
    || !text(source.sha256, 64) || !text(source.importedAt, 40) || !text(source.asOf, 80)
    || !Array.isArray(chart.warnings) || chart.warnings.length > 30
    || !chart.warnings.every(w => text(w, 600))) throw new Error('The chart source record is missing or invalid.');
  const annotations = chart.annotations ?? [];
  if (!Array.isArray(annotations) || annotations.length > 20 || !annotations.every(a => text(a, 600))) throw new Error('Invalid chart footnotes.');
  if (chart.dataFile && (!text(chart.dataFile.fileName) || !text(chart.dataFile.sha256, 64))) throw new Error('Invalid chart workbook record.');
  return { version: 1, title: chart.title, kind: chart.kind, unit: chart.unit,
    labels: [...chart.labels], series: chart.series.map(s => ({ name: s.name, values: [...s.values] })),
    source: { ...source }, warnings: [...chart.warnings], reviewed: chart.reviewed === true,
    annotations: [...annotations], allowGaps: chart.allowGaps === true,
    presentation: { valueAxis: chart.presentation?.valueAxis !== false, grid: chart.presentation?.grid !== false,
      legend: chart.presentation?.legend !== false, trendArrow: chart.presentation?.trendArrow === true },
    theme: chart.theme === 'dark' ? 'dark' : 'light', userEdited: chart.userEdited === true,
    ...(chart.dataFile ? { dataFile: { fileName: chart.dataFile.fileName, sha256: chart.dataFile.sha256 } } : {}),
    ...(referenceFigure ? { referenceFigure } : {}) };
}

export function chartProblems(chart: ImportedChart): string[] {
  if (chart.referenceFigure) {
    try { validateReferenceFigure(chart.referenceFigure); return chart.title.trim() ? [] : ['Add a chart title.']; }
    catch (error) { return [(error as Error).message]; }
  }
  const issues: string[] = [];
  if (!chart.title.trim()) issues.push('Add a chart title.');
  if (chart.labels.some(label => !label.trim())) issues.push('Every category needs a label.');
  if (new Set(chart.labels).size !== chart.labels.length) issues.push('Category labels must be unique.');
  if (chart.series.some(series => !series.name.trim())) issues.push('Every series needs a name.');
  if (chart.series.some(s => s.values.includes(null)) && !chart.allowGaps) issues.push('Resolve the empty values or explicitly keep them as gaps. Empty does not mean zero.');
  if (chart.warnings.some(w => w.startsWith('Mixed percentage'))) issues.push('Use columns with the same unit in one chart.');
  if (chart.kind === 'bar' && chart.series.length > 1) issues.push('Choose Grouped bars or Stacked bars for multiple series.');
  return issues;
}
