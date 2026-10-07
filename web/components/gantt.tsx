import { forwardRef, useEffect, useId, useState } from 'react';
import { scaleLinear, symbol, symbolDiamond } from 'd3';
import { OM_COMPONENT_THEME } from './theme';

/** Shared local-trial contract. Source coordinates are relative positions, not exact dates. */
export interface GanttData {
  kind: 'gantt'; title: string; ticks: string[];
  phases: { title?: string; label?: string; firstRow: number; rowCount: number }[];
  tasks: { label: string; start: number; end: number; milestone: boolean }[];
  annotations?: { text: string; position: number; row?: number }[];
  notes?: string[];
}
export const GANTT_COMPONENT_VERSION = 'shared-gantt-v1';
const { ink,background:bg,primary,secondary,tertiary } = OM_COMPONENT_THEME.colors;
const palette = [ink, secondary, secondary, primary, tertiary, tertiary];
const font = OM_COMPONENT_THEME.font.data.family;
let context: CanvasRenderingContext2D | null = null;
function measure(text: string, size: number, weight = 400) {
  context ||= document.createElement('canvas').getContext('2d');
  context!.font = `${weight} ${size}px ${font}`;
  return context!.measureText(text).width;
}
function wrap(text: string, width: number, size: number, weight = 400) {
  const rows: string[] = []; let row = '';
  for (const word of String(text).split(/\s+/)) {
    if (row && measure(row + ' ' + word, size, weight) > width) { rows.push(row); row = ''; }
    let rest = word;
    while (measure(rest, size, weight) > width) {
      if (row) { rows.push(row); row = ''; }
      let n = 1;
      while (n < rest.length && measure(rest.slice(0, n + 1), size, weight) <= width) n++;
      rows.push(rest.slice(0, n)); rest = rest.slice(n);
    }
    row += (row ? ' ' : '') + rest;
  }
  if (row) rows.push(row);
  return rows.length ? rows : [''];
}
export function ganttErrors(f: GanttData): string[] {
  const errors: string[] = [];
  if (!f.tasks?.length || f.tasks.length > 80) errors.push('任务数量应为 1–80。');
  if (!f.ticks?.length || f.ticks.length > 80 || f.ticks.some(t => !t.trim())) errors.push('时间刻度数量应为 1–80。');
  if (f.tasks?.some(t => !t.label?.trim() || !Number.isFinite(t.start) || !Number.isFinite(t.end) || t.start < 0 || t.end > 1 || t.start > t.end || (t.milestone && t.start !== t.end))) errors.push('请检查任务名称、起止位置；里程碑的起点和终点应一致。');
  if ((f.phases?.length || 0) > 40) errors.push('阶段数量最多为 40。');
  if ((f.annotations?.length || 0) > 20) errors.push('标注数量最多为 20。');
  const used = new Set<number>();
  for (const p of f.phases || []) {
    if (!(p.title || p.label)?.trim() || !Number.isInteger(p.firstRow) || !Number.isInteger(p.rowCount) || p.firstRow < 0 || p.rowCount < 1 || p.firstRow + p.rowCount > f.tasks.length) { errors.push('阶段名称或任务范围无效。'); continue; }
    for (let i = p.firstRow; i < p.firstRow + p.rowCount; i++) {
      if (used.has(i)) errors.push('阶段任务范围不能重叠。');
      used.add(i);
    }
  }
  if (f.annotations?.some(a => !a.text?.trim() || !Number.isFinite(a.position) || a.position < 0 || a.position > 1 || (a.row !== undefined && (!Number.isInteger(a.row) || a.row < 0 || a.row >= f.tasks.length)))) errors.push('请检查标注文字、位置和对应任务。');
  return [...new Set(errors)];
}
type Box = { x: number; y: number; width: number; height: number };
const area = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export function layoutGantt(f: GanttData, width = 1728) {
  // Pixel-measured text and content-driven row heights; no source-page constants.
  const phaseWidth = f.phases?.length ? 158 : 0;
  const taskWidth = Math.max(330, Math.min(510, Math.max(...f.tasks.map(t => measure(t.label, 15) + 24))));
  const left = phaseWidth + taskWidth, right = width - 10;
  const cell = (right - left) / Math.max(1, f.ticks.length);
  const tickSize = Math.max(11, Math.min(15, cell / 3.4));
  const ticks = f.ticks.map(t => {
    const parts = t.match(/^(.*?)\s*(\([^()]*\))$/);
    return (parts ? [parts[1], parts[2]] : [t]).flatMap(s => wrap(s, cell - 6, tickSize, 600));
  });
  const top = Math.max(55, 14 + Math.max(...ticks.map(t => t.length)) * (tickSize + 3));
  const labels = f.tasks.map(t => wrap(t.label, taskWidth - 28, 15));
  const heights = labels.map(lines => Math.max(23.4, lines.length * 17 + 7));
  const phaseLabels = (f.phases || []).map(p => wrap(p.title || p.label || '', phaseWidth - 22, 15, 600));
  (f.phases || []).forEach((p, i) => {
    const available = heights.slice(p.firstRow, p.firstRow + p.rowCount).reduce((a, b) => a + b, 0);
    const extra = Math.max(0, phaseLabels[i].length * 17 + 43 - available);
    for (let j = p.firstRow; j < p.firstRow + p.rowCount; j++) if (j < heights.length) heights[j] += extra / p.rowCount;
  });
  let cursor = top;
  const rows = heights.map((height, i) => { const value = { y: cursor, height, lines: labels[i] }; cursor += height; return value; });
  const x = scaleLinear().domain([0, 1]).range([left, right]);
  const bars = f.tasks.map((t, i) => ({ x: x(t.start) - (t.milestone ? 6 : 0), y: rows[i].y + rows[i].height / 2 - 9, width: Math.max(t.milestone ? 12 : 2, x(t.end) - x(t.start)), height: 18 }));
  const occupied: Box[] = bars.map(b => ({ x: b.x - 5, y: b.y - 4, width: b.width + 10, height: b.height + 8 }));
  let height = cursor + 8;
  const annotations = (f.annotations || []).map(a => {
    const anchorRow = a.row ?? f.tasks.reduce((best, t, i) => Math.min(Math.abs(t.start - a.position), Math.abs(t.end - a.position)) < Math.min(Math.abs(f.tasks[best].start - a.position), Math.abs(f.tasks[best].end - a.position)) ? i : best, 0);
    const anchor = { x: x(a.position), y: rows[anchorRow].y + rows[anchorRow].height / 2 };
    const boxWidth = Math.min(220, Math.max(170, measure(a.text, 17, 600) + 24));
    const lines = wrap(a.text, boxWidth - 22, 17, 600), boxHeight = lines.length * 20 + 16;
    const bx = Math.max(left + 4, Math.min(right - boxWidth, anchor.x - boxWidth / 2));
    const candidates = rows.flatMap(r => [r.y, r.y - boxHeight]).filter(y => y >= top && y + boxHeight <= cursor).map(y => ({ x: bx, y, width: boxWidth, height: boxHeight }));
    const free = candidates.filter(b => occupied.every(o => area(b, o) < .1)).sort((a, b) => Math.abs(a.y + a.height / 2 - anchor.y) - Math.abs(b.y + b.height / 2 - anchor.y));
    const box = free[0] || { x: bx, y: height + 8, width: boxWidth, height: boxHeight };
    occupied.push({ x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 });
    height = Math.max(height, box.y + box.height + 8);
    return { ...box, anchor, lines, text: a.text };
  });
  return { width, height, phaseWidth, taskWidth, left, right, top, bottom: cursor, ticks, tickSize, cell, rows, phaseLabels, bars, annotations, x };
}

function Label({ x, y, lines, size = 15, anchor = 'start', fill = ink, weight = 400, role }: { x: number; y: number; lines: string[]; size?: number; anchor?: 'start' | 'middle'; fill?: string; weight?: number; role: string }) {
  return <text x={x} y={y} fontSize={size} textAnchor={anchor} fill={fill} fontWeight={weight} data-gantt-label={role}>{lines.map((s, i) => <tspan key={i} x={x} dy={i ? size + 2 : 0}>{s}</tspan>)}</text>;
}
function PhaseGlyph({ title }: { title: string }) {
  // Decorative, library-style glyphs; unknown categories get a neutral checklist.
  if (/mechanic/i.test(title)) return <><path d="M-10-9L-4-3 1-5 6-10 10-6 5-1 3 4 9 10 6 13-1 5-6 3-12-3Z" /><path d="M-3 4L-10 11" /></>;
  if (/electric/i.test(title)) return <path d="M2-13L-9 3H-1L-3 14 10-4H1Z" />;
  if (/civil|structure/i.test(title)) return <><path d="M-12 11H12M-9 10V-3L0-10 9-3V10M-4 10V2H4V10" /><path d="M-13-3L0-14 13-3" /></>;
  if (/fire|safety/i.test(title)) return <><path d="M0-14C2-5 12-3 9 6Q8 14 0 14T-9 6Q-12 0-5-7Q-5 2-1 0Q2-4 0-14Z" /></>;
  if (/procure/i.test(title)) return <><path d="M-10-8H10V13H-10ZM-4-8V-12H4V-8M-5-1H5M-5 5H5" /></>;
  return <><path d="M-9-13H9V13H-9ZM-5-6H5M-5 0H5M-5 6L-1 9 6 3" /></>;
}

export const SharedGanttFigure = forwardRef<SVGSVGElement, { figure: GanttData; fillContainer?: boolean; showTitle?: boolean; testId?: string }>(function SharedGanttFigure({ figure: f, fillContainer = false, showTitle = false, testId = 'pipeline-figure' }, ref) {
  const id = 'gantt-' + useId().replace(/:/g, ''), [, fontsReady] = useState(0);
  useEffect(() => { let active = true; void document.fonts.ready.then(() => { if (active) fontsReady(1); }); return () => { active = false; }; }, []);
  const errors = ganttErrors(f);
  if (errors.length) return <svg ref={ref} data-testid={testId} data-kind="gantt" viewBox="0 0 1728 160" width="1728" height="160" style={{ width: '100%', height: 'auto' }}><text x="20" y="60" fontSize="24">{errors[0]}</text></svg>;
  const l = layoutGantt(f), heading = showTitle ? wrap(f.title, l.width - 32, 30) : [], offset = heading.length ? heading.length * 36 + 16 : 0;
  const fills = [palette[0], palette[1], `url(#${id}-hatch)`, palette[3], palette[4], `url(#${id}-dots)`];
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={f.title} data-testid={testId} data-kind="gantt" data-component={GANTT_COMPONENT_VERSION} width={l.width} height={l.height + offset} viewBox={`0 0 ${l.width} ${l.height + offset}`} preserveAspectRatio="xMidYMin meet" style={{ width: '100%', height: fillContainer ? '100%' : 'auto', display: 'block' }} fontFamily={font}>
    <title>{f.title}</title><desc>Relative source schedule positions. Calendar days are not inferred.</desc>
    <rect data-chart-background="true" width={l.width} height={l.height + offset} fill={bg} />
    <defs><pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill={palette[2]} /><path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke={ink} strokeWidth="1" opacity=".4" /></pattern><pattern id={`${id}-dots`} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill={palette[5]} /><circle cx="4" cy="4" r="1.1" fill={ink} opacity=".6" /></pattern></defs>
    {heading.length > 0 && <Label x={12} y={31} lines={heading} size={30} role="title" />}
    <g transform={`translate(0,${offset})`}>
      {l.ticks.map((lines, i) => <g key={i} data-gantt-tick={i}><rect x={l.left + i * l.cell} y={0} width={l.cell - 1} height={l.top - 3} fill={i % 2 ? bg : palette[4]} /><Label x={l.left + (i + .5) * l.cell} y={20} lines={lines} size={l.tickSize} anchor="middle" weight={600} role="tick" /></g>)}
      <rect x={l.phaseWidth + 7} y={l.top} width={l.taskWidth - 12} height={l.bottom - l.top} fill={palette[4]} opacity=".25" />
      {f.phases.map((p, i) => { const y = l.rows[p.firstRow].y, height = l.rows.slice(p.firstRow, p.firstRow + p.rowCount).reduce((sum, r) => sum + r.height, 0), light = i % fills.length === 0, lines = l.phaseLabels[i], center = y + height / 2, textHeight = lines.length * 17; return <g key={i} data-gantt-phase={i}>
        <rect x={0} y={y} width={l.phaseWidth - 7} height={height - 1} fill={fills[i % fills.length]} />
        <g transform={`translate(${(l.phaseWidth - 7) / 2},${center - textHeight / 2 - 10}) scale(.7)`} stroke={light ? bg : ink} strokeWidth="1.5" fill="none"><PhaseGlyph title={p.title || p.label || ''} /></g>
        <Label x={(l.phaseWidth - 7) / 2} y={center - textHeight / 2 + 20} lines={lines} size={15} anchor="middle" weight={600} fill={light ? bg : ink} role="phase" />
      </g>; })}
      {f.tasks.map((t, i) => { const row = l.rows[i], phase = f.phases.findIndex(p => i >= p.firstRow && i < p.firstRow + p.rowCount), fill = phase < 0 ? ink : fills[phase % fills.length], a = l.x(t.start), b = l.x(t.end), cy = row.y + row.height / 2, barHeight = Math.min(16, row.height - 8), tip = Math.min(8, (b - a) / 2); return <g key={i} data-gantt-task={i} data-start={t.start} data-end={t.end}>
        <line x1={l.phaseWidth + 10} x2={l.right} y1={row.y} y2={row.y} stroke={ink} strokeWidth=".8" opacity=".35" strokeDasharray="6 4" />
        <Label x={l.phaseWidth + 12} y={cy - (row.lines.length - 1) * 17 / 2 + 5} lines={row.lines} role="task" />
        {t.milestone ? <path data-gantt-mark="milestone" d={symbol().type(symbolDiamond).size(78)() || ''} transform={`translate(${a},${cy})`} fill={fill} stroke={ink} strokeWidth=".7" /> : <path data-gantt-mark="bar" d={`M${a},${cy - barHeight / 2}H${b - tip}L${b},${cy}L${b - tip},${cy + barHeight / 2}H${a}Z`} fill={fill} stroke={ink} strokeWidth=".5" strokeOpacity=".25" />}
        <title>{`${t.label} · ${(t.start * 100).toFixed(2)}%–${(t.end * 100).toFixed(2)}% of source time axis`}</title>
      </g>; })}
      {l.annotations.map((a, i) => { const x = Math.max(a.x + 5, Math.min(a.x + a.width - 5, a.anchor.x)), y = a.anchor.y < a.y ? a.y : a.y + a.height; return <g key={i} data-gantt-annotation={i}>
        <line x1={a.anchor.x} y1={a.anchor.y} x2={x} y2={y} stroke={ink} strokeWidth="1.5" strokeDasharray="4 3" /><circle data-gantt-anchor={i} cx={a.anchor.x} cy={a.anchor.y} r={3.5} fill={ink} />
        <rect x={a.x} y={a.y} width={a.width} height={a.height} rx={5} fill={bg} stroke={palette[3]} strokeWidth="1.5" />
        <Label x={a.x + a.width / 2} y={a.y + 21} lines={a.lines} size={17} anchor="middle" weight={600} role="annotation" />
      </g>; })}
    </g>
  </svg>;
});
