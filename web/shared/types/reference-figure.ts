import * as z from 'zod';

const text = z.string().max(1000);
const number = z.number().finite().min(-1e15).max(1e15);
const point = z.object({ year: number, value: number }).passthrough();
const source = z.object({ document: text, asOf: text, page: z.number().int().positive(), figure: text, pdfSha256: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough();
const schema = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,100}$/), kind: z.enum(['single', 'stacked', 'grouped', 'balance', 'scatter', 'curves', 'timeline', 'gantt', 'tiers']),
  title: text, page: z.number().int().positive(), width: z.number().min(200).max(4096), height: z.number().min(150).max(4096),
  source, extractionMethod: text, quality: text, unit: text.optional(),
  categories: z.array(text).min(1).max(100).optional(),
  series: z.array(z.object({ name: text, values: z.array(number.nullable()).max(100), cagr: text.optional() }).passthrough()).optional(),
  reportedTotals: z.array(number).max(100).optional(), margins: z.array(text).max(100).optional(),
  cagr: text.nullable().optional(), multiple: text.optional(), legendFootnote: text.optional(), note: text.optional(),
  points: z.array(point.extend({ label: text })).min(1).max(100).optional(),
  curves: z.array(z.object({ name: text, cagr: text, annualKnots: z.array(point).min(2).max(100), segments: z.array(z.array(point).length(4)).max(100) }).passthrough()).optional(),
  xDomain: z.tuple([number, number]).optional(), yDomain: z.tuple([number, number]).optional(),
  xTicks: z.array(number).max(100).optional(), yTicks: z.array(number).max(100).optional(),
  phases: z.array(z.object({ title: text.optional(), label: text.optional(), firstRow: z.number().int().nonnegative().optional(), rowCount: z.number().int().positive().optional(),
    events: z.array(z.object({ date: text, description: text, conflicts: z.array(text).max(10) }).passthrough()).max(30).optional() }).passthrough()).max(20).optional(),
  tasks: z.array(z.object({ label: text, start: z.number().min(0).max(1), end: z.number().min(0).max(1), milestone: z.boolean() }).passthrough()).max(100).optional(),
  ticks: z.array(text).max(100).optional(), annotations: z.array(z.object({ text, position: number })).max(20).optional(),
  tiers: z.array(z.object({ name: text, cities: z.array(text).max(30) })).max(10).optional(),
  highlight: text.optional(), direction: text.optional(), curvesEdited: z.boolean().optional(),
}).passthrough().superRefine((d, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (['single', 'stacked', 'grouped', 'balance'].includes(d.kind)) {
    if (!d.categories?.length || !d.series?.length || d.series.some(s => s.values.length !== d.categories!.length)) fail('Missing chart categories or series.');
    if (d.reportedTotals && d.reportedTotals.length !== d.categories?.length) fail('Totals must match categories.');
    if (d.categories && new Set(d.categories).size !== d.categories.length) fail('Category labels must be unique.');
    if (d.categories?.some(label => !label.trim()) || d.series?.some(s => !s.name.trim()) || (d.series && new Set(d.series.map(s => s.name)).size !== d.series.length)) fail('Categories and series need unique, nonempty labels.');
    if (d.kind === 'single' && d.series?.length !== 1) fail('This source figure uses one series.');
    if (d.kind === 'grouped' && d.series?.length !== 2) fail('This source figure uses two series.');
    if (d.kind === 'grouped' && !d.series?.some(s => s.values.some(v => v !== null))) fail('Keep at least one numeric observation.');
    if (d.kind === 'stacked' && (!d.reportedTotals || d.series?.some(s => s.values.some(v => v === null || v < 0)))) fail('Stacked source figures require nonnegative values and printed totals.');
    if (d.kind === 'grouped' && (!d.margins || d.margins.length !== d.categories?.length)) fail('Margins must match categories.');
    if (d.kind === 'balance' && (d.categories?.length !== 3 || d.series?.length !== 4 || !d.reportedTotals || !d.multiple || !d.legendFootnote)) fail('The balance-sheet layout needs three categories and four series.');
    if (d.kind === 'balance' && d.series?.some((s, j) => s.values.some((v, i) => i === [0, 0, 1, 2][j] ? v === null || v < 0 : v !== null))) fail('Keep balance-sheet amounts in their original series columns.');
  }
  if (['scatter', 'curves'].includes(d.kind)) {
    if (!d.xDomain || !d.yDomain || !d.xTicks || !d.yTicks || d.xDomain[0] >= d.xDomain[1] || d.yDomain[0] >= d.yDomain[1]) fail('Chart axes are invalid.');
    if (d.kind === 'scatter' ? !d.points?.length : !d.curves?.length) fail('Missing chart points.');
    if (d.kind === 'curves' && d.curves?.some(c => c.annualKnots.length < 9 || !c.segments.length || c.annualKnots.some((p, i) => i > 0 && p.year <= c.annualKnots[i - 1].year))) fail('Curve years must increase; keep at least nine source points.');
  }
  if (d.kind === 'timeline' && (d.phases?.length !== 3 || d.phases.some(p => !p.title || p.events?.length !== 3))) fail('This timeline layout uses three phases and nine milestones.');
  if (d.kind === 'gantt' && (!d.tasks?.length || d.ticks?.length !== 19 || !d.phases?.length || d.tasks.some(t => t.start > t.end)
    || d.phases.some(p => p.firstRow === undefined || !p.rowCount || !p.label || p.firstRow + p.rowCount > d.tasks!.length))) fail('Schedule rows, phases or start/end positions are invalid.');
  if (d.kind === 'tiers' && (d.tiers?.length !== 3 || d.tiers.some((t, i) => t.cities.length !== [3, 6, 8][i]))) fail('This source diagram uses three tiers with 3, 6 and 8 markets.');
});

export type ReferenceFigure = z.infer<typeof schema>;
export function referenceFigureData(d: ReferenceFigure) {
  if (d.categories && d.series) return { labels: d.categories, series: d.series.map(s => ({ name: s.name, values: s.values })) };
  if (d.points) return { labels: d.points.map(p => p.label), series: [{ name: 'Year', values: d.points.map(p => p.year) }, { name: d.unit || 'Value', values: d.points.map(p => p.value) }] };
  if (d.curves) return { labels: d.curves[0].annualKnots.map(p => String(p.year)), series: d.curves.map(c => ({ name: c.name, values: c.annualKnots.map(p => p.value) })) };
  if (d.tasks) return { labels: d.tasks.map(t => t.label), series: [{ name: 'Start (0–1)', values: d.tasks.map(t => t.start) }, { name: 'End (0–1)', values: d.tasks.map(t => t.end) }] };
  return { labels: d.tiers ? d.tiers.flatMap(t => t.cities) : d.phases!.flatMap(p => p.events!.map(e => e.date)), series: [] };
}
export function validateReferenceFigure(value: unknown): ReferenceFigure {
  if (JSON.stringify(value).length > 300000) throw new Error('Reference figure data is too large.');
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0]?.message || 'Invalid reference figure.');
  return result.data;
}
