import { validateReferenceFigure, type ReferenceFigure } from '@/types/reference-figure';

export type FigureCell = string | number | boolean | null;
type Path = (string | number)[];
export interface FigureTable { name: string; headers: string[]; rows: FigureCell[][]; paths: Path[][] }

/** Columns are a view of the actual saved specification, including explicit annotation data. */
export function figureTables(d: ReferenceFigure): FigureTable[] {
  const tables: FigureTable[] = [];
  const add = (name: string, headers: string[], rows: FigureCell[][], paths: Path[][]) => tables.push({ name, headers, rows, paths });
  if (d.series && d.categories) add('Chart Data', ['Category', ...d.series.map(s => s.name)], d.categories.map((c, i) => [c, ...d.series!.map(s => s.values[i])]),
    d.categories.map((_, i) => [['categories', i], ...d.series!.map((s, j) => d.kind === 'balance' && s.values[i] === null ? [] : ['series', j, 'values', i])]));
  if (d.series) add('Series labels', ['Series'], d.series.map(s => [s.name]), d.series.map((_, i) => [['series', i, 'name']]));
  if (d.reportedTotals) add('Printed totals', ['Category', 'Printed total'], d.reportedTotals.map((v, i) => [d.categories![i], v]), d.reportedTotals.map((_, i) => [[], ['reportedTotals', i]]));
  if (d.margins) add('Margins', ['Category', 'Printed margin'], d.margins.map((v, i) => [d.categories![i], v]), d.margins.map((_, i) => [[], ['margins', i]]));
  const notes: FigureCell[][] = []; const paths: Path[][] = [];
  for (const key of ['cagr', 'multiple', 'legendFootnote', 'note', 'highlight', 'direction'] as const) if (d[key] != null) { notes.push([key, d[key]!]); paths.push([[], [key]]); }
  d.series?.forEach((s, i) => { if (s.cagr) { notes.push([s.name + ' CAGR', s.cagr]); paths.push([[], ['series', i, 'cagr']]); } });
  d.curves?.forEach((s, i) => { notes.push([s.name + ' CAGR', s.cagr]); paths.push([[], ['curves', i, 'cagr']]); });
  if (notes.length) add('Annotations', ['Field', 'Text'], notes, paths);
  if (d.points) add('Points', ['Label', 'Year (chart reading)', d.unit || 'Value'], d.points.map(p => [p.label, p.year, p.value]), d.points.map((_, i) => [['points', i, 'label'], ['points', i, 'year'], ['points', i, 'value']]));
  d.curves?.forEach((c, j) => add(`Curve ${j + 1}`, ['Year (chart reading)', c.name], c.annualKnots.map(p => [p.year, p.value]), c.annualKnots.map((_, i) => [['curves', j, 'annualKnots', i, 'year'], ['curves', j, 'annualKnots', i, 'value']])));
  if (d.kind === 'timeline') d.phases?.forEach((p, j) => add(`Phase ${j + 1}`, ['Date', 'Milestone'], p.events!.map(e => [e.date, e.description]), p.events!.map((_, i) => [['phases', j, 'events', i, 'date'], ['phases', j, 'events', i, 'description']])));
  if (d.tasks) add('Schedule', ['Task', 'Start (0–1)', 'End (0–1)', 'Milestone'], d.tasks.map(t => [t.label, t.start, t.end, t.milestone]), d.tasks.map((_, i) => ['label', 'start', 'end', 'milestone'].map(k => ['tasks', i, k])));
  if (d.ticks) add('Time axis', ['Tick'], d.ticks.map(t => [t]), d.ticks.map((_, i) => [['ticks', i]]));
  if (d.phases) add('Phase labels', ['Phase'], d.phases.map(p => [p.title || p.label || '']), d.phases.map((p, i) => [['phases', i, p.title !== undefined ? 'title' : 'label']]));
  if (d.tiers) {
    add('Tier labels', ['Tier'], d.tiers.map(t => [t.name]), d.tiers.map((_, i) => [['tiers', i, 'name']]));
    d.tiers.forEach((t, j) => add(`Tier ${j + 1}`, ['Market'], t.cities.map(c => [c]), t.cities.map((_, i) => [['tiers', j, 'cities', i]])));
  }
  return tables;
}

export function updateFigureCells(original: ReferenceFigure, changes: { path: Path; value: FigureCell }[]): ReferenceFigure {
  const next = structuredClone(original);
  for (const { path, value } of changes) {
    if (!path.length) continue;
    if (path.some(p => typeof p === 'string' && ['__proto__', 'constructor', 'prototype'].includes(p))) throw new Error('Invalid cell path.');
    let object: unknown = next;
    for (const key of path.slice(0, -1)) object = (object as Record<string | number, unknown>)[key];
    if ((object as Record<string | number, unknown>)[path.at(-1)!] === value) continue;
    (object as Record<string | number, unknown>)[path.at(-1)!] = value;
    if (path.includes('annualKnots')) next.curvesEdited = true;
  }
  return validateReferenceFigure(next);
}
