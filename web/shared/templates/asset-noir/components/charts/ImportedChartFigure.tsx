import { forwardRef, useId } from 'react';
import { line, scaleBand, scaleLinear, stack, stackOffsetDiverging } from 'd3';
import type { ImportedChart } from '@/types/chart-import';
import { COLORS, TYPOGRAPHY } from '../../generated-design-tokens';
import { ReferenceChartFigure } from './ReferenceChartFigure';

const palette = [COLORS.text.accent, '#87968F', '#A8896D', '#B8C1C5', '#71675B', '#E0D5C6'];
const number = (v: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(v);
function lines(value: string, size: number): string[] {
  const result: string[] = []; let rest = value;
  while (rest.length > size) {
    const space = rest.lastIndexOf(' ', size);
    const cut = space > size / 3 ? space : size;
    result.push(rest.slice(0, cut)); rest = rest.slice(cut).trim();
  }
  return [...result, rest];
}

/** One SVG authority for the editor, PNG and SVG export. No chart screenshot reuse. */
export const ImportedChartFigure = forwardRef<SVGSVGElement, { chart: ImportedChart }>(function ImportedChartFigure({ chart }, ref) {
  const arrowId = useId().replace(/:/g, '');
  if (chart.referenceFigure) return <ReferenceChartFigure ref={ref} chart={chart} />;
  const dark = chart.theme === 'dark';
  const ink = dark ? COLORS.text.white : COLORS.text.primary;
  const bg = dark ? COLORS.bg.dark : COLORS.bg.secondary;
  const grouped = chart.kind === 'grouped-bar';
  const width = Math.max(1000, chart.labels.length * (grouped ? chart.series.length * 48 + 20 : 64) + 180);
  const labelLines = chart.labels.map(label => lines(label, Math.max(6, Math.floor((width - 180) / chart.labels.length / 10))));
  const titleLines = lines(chart.title, Math.floor((width - 96) / 24));
  const left = chart.presentation.valueAxis ? 110 : 64; const right = width - 58; const top = 75 + titleLines.length * 34; const bottom = top + 320;
  const categoryBottom = bottom + 22 + Math.max(...labelLines.map(value => value.length)) * 19;
  let lx = left; let ly = categoryBottom + (chart.presentation.legend ? 34 : 0);
  let legendRowHeight = chart.presentation.legend ? 28 : 0;
  const legends = (chart.presentation.legend ? chart.series : []).map((series, index) => {
    const text = lines(series.name, 32); const legendWidth = Math.max(...text.map(line => line.length)) * 9 + 50;
    if (lx + legendWidth > right) { lx = left; ly += legendRowHeight; legendRowHeight = 28; }
    legendRowHeight = Math.max(legendRowHeight, text.length * 22 + 6);
    const value = { x: lx, y: ly, text, color: palette[index] }; lx += legendWidth;
    return value;
  });
  const sourceText = `Source: ${chart.source.fileName} · ${chart.source.locator}${chart.source.asOf ? ` · As of ${chart.source.asOf}` : ' · Source date not provided'}`;
  const trend = chart.presentation.trendArrow ? chart.annotations.find(note => /CAGR/i.test(note)) : undefined;
  const notes = [...chart.annotations.filter(note => note && note !== trend), ...(chart.allowGaps && chart.series.some(s => s.values.includes(null)) ? ['— = no value supplied; not zero.'] : []),
    ...(chart.userEdited ? ['Data includes user edits; source shown for reference.'] : []), sourceText];
  const sourceLines = notes.flatMap(text => lines(text, Math.floor((width - 100) / 8)));
  const sourceY = ly + legendRowHeight + 24; const height = sourceY + sourceLines.length * 20 + 30;
  // Use numeric indices so a temporarily duplicated/empty edited label never collapses bars.
  const indices = chart.labels.map((_, i) => String(i));
  const x = scaleBand().domain(indices).range([left, right]).padding(0.3);
  const seriesX = scaleBand().domain(chart.series.map((_, i) => String(i))).range([0, x.bandwidth()]).padding(0.14);
  const rows = chart.labels.map((_, index) => chart.series.map(series => series.values[index]));
  const stacked = stack<(number | null)[], number>().keys(chart.series.map((_, i) => i))
    .value((row, key) => row[key] ?? 0).offset(stackOffsetDiverging)(rows);
  const values = chart.series.flatMap(series => series.values.filter((v): v is number => v !== null));
  const extents = chart.kind === 'stacked-bar' ? stacked.flatMap(series => series.flatMap(point => [point[0], point[1]])) : values;
  const lo = Math.min(0, ...extents); const hi = Math.max(0, ...extents);
  const y = scaleLinear().domain([lo < 0 ? lo * 1.15 : 0, hi > 0 ? hi * 1.17 : lo < 0 ? 0 : 1]).range([bottom, top]);
  if (chart.presentation.valueAxis) y.nice(5);
  const y0 = y(0);
  const path = line<number | null>().defined((v): v is number => v !== null)
    .x((_, i) => (x(String(i)) ?? 0) + x.bandwidth() / 2).y(v => y(v!));
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={chart.title || 'Chart preview'}
    data-testid="imported-chart-figure" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
    style={{ width: '100%', height: 'auto', display: 'block' }}>
    <title>{chart.title}</title>
    <desc>{chart.series.map(series => `${series.name}: ${series.values.map(v => v === null ? 'unknown' : v).join(', ')}`).join('; ')}</desc>
    <rect data-chart-background="true" width={width} height={height} fill={bg} />
    <g fill={ink} fontFamily={TYPOGRAPHY.fonts.heading} fontSize={30}>
      {titleLines.map((text, i) => <text key={i} x={48} y={48 + i * 34}>{text}</text>)}
    </g>
    <g fill={ink} fontFamily={TYPOGRAPHY.fonts.comment} fontSize={16}>
      <text x={left} y={top - 18} opacity={0.75}>{chart.unit}</text>
    </g>
    <g fontFamily={TYPOGRAPHY.fonts.data} fontSize={18} fill={ink}>
      {y.ticks(5).map(tick => <g key={tick}>
        {(chart.presentation.grid || tick === 0) && <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke={ink} strokeOpacity={tick === 0 ? 0.4 : 0.12} />}
        {chart.presentation.valueAxis && <text x={left - 14} y={y(tick) + 6} textAnchor="end">{number(tick)}</text>}
      </g>)}
      {chart.series.map((series, si) => <g key={si} data-series={series.name}>
        {chart.kind === 'line' && <path d={path(series.values) ?? ''} fill="none" stroke={palette[si]} strokeWidth={3} />}
        {series.values.map((value, index) => {
          if (value === null) return <text key={index} x={(x(String(index)) ?? 0) + x.bandwidth() / 2} y={y0 - 8} textAnchor="middle" fill={chart.allowGaps ? ink : '#B45309'}>{chart.allowGaps ? '—' : '?'}</text>;
          const xx = (x(String(index)) ?? 0) + (grouped ? seriesX(String(si)) ?? 0 : 0);
          const bw = grouped ? seriesX.bandwidth() : x.bandwidth();
          const p = stacked[si][index];
          const stackedBar = chart.kind === 'stacked-bar';
          const yy = stackedBar ? y(Math.max(p[0], p[1])) : Math.min(y(value), y0);
          const barHeight = stackedBar ? Math.abs(y(p[0]) - y(p[1])) : Math.abs(y(value) - y0);
          const smallSegments = stacked.map((layer, j) => ({ si: j, y: (y(layer[index][0]) + y(layer[index][1])) / 2,
            h: Math.abs(y(layer[index][0]) - y(layer[index][1])) }))
            .filter(segment => segment.h < 24 && chart.series[segment.si].values[index] !== null).sort((a, b) => a.y - b.y);
          const smallIndex = smallSegments.findIndex(segment => segment.si === si);
          const outside = stackedBar && barHeight < 24;
          const outsideY = Math.min(bottom - smallSegments.length * 19, Math.max(top + 10, smallSegments[0]?.y ?? top)) + smallIndex * 19;
          const labelY = outside ? outsideY : stackedBar ? yy + barHeight / 2 + 6 : y(value) + (value < 0 ? 23 : -9);
          return <g key={index} data-value={value}>
            {chart.kind === 'line'
              ? <circle cx={xx + bw / 2} cy={y(value)} r={4} fill={palette[si]} />
              : <rect x={xx} y={yy} width={bw} height={barHeight} fill={palette[si]} />}
            {outside && <line x1={xx + bw} x2={xx + bw + 6} y1={yy + barHeight / 2} y2={labelY - 5} stroke={ink} strokeWidth={0.7} />}
            <text x={outside ? xx + bw + 8 : xx + bw / 2} y={labelY} textAnchor={outside ? 'start' : 'middle'} fontSize={outside ? 13 : 16}
              fill={stackedBar && !outside ? COLORS.text.primary : ink}>{number(value)}</text>
            <title>{`${chart.labels[index]} · ${series.name}: ${number(value)} ${chart.unit}`}</title>
          </g>;
        })}
      </g>)}
      {labelLines.map((text, i) => <text key={i} x={(x(String(i)) ?? 0) + x.bandwidth() / 2} y={bottom + 25} textAnchor="middle" fontSize={17}>
        {text.map((part, j) => <tspan key={j} x={(x(String(i)) ?? 0) + x.bandwidth() / 2} dy={j ? 19 : 0}>{part}</tspan>)}
      </text>)}
    </g>
    {trend && <g fill={ink} stroke={ink}>
      <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
      <line x1={(x(String(Math.max(0, chart.series[0].values.findIndex(v => v !== null)))) ?? left) + x.bandwidth() / 2}
        y1={top + 16} x2={right - x.bandwidth() / 2} y2={top - 8} strokeWidth={1.2} markerEnd={`url(#${arrowId})`} />
      <text x={(left + right) / 2} y={top - 8} stroke="none" textAnchor="middle" fontFamily={TYPOGRAPHY.fonts.comment} fontSize={17}>{trend}</text>
    </g>}
    <g fontFamily={TYPOGRAPHY.fonts.comment} fontSize={17} fill={ink}>
      {legends.map((legend, i) => <g key={i}><rect x={legend.x} y={legend.y - 13} width={16} height={16} fill={legend.color} />
        <text x={legend.x + 24} y={legend.y}>{legend.text.map((part, j) => <tspan key={j} x={legend.x + 24} dy={j ? 22 : 0}>{part}</tspan>)}</text></g>)}
      {sourceLines.map((text, i) => <text key={i} x={48} y={sourceY + i * 20} fontSize={14} opacity={0.75}>{text}</text>)}
    </g>
  </svg>;
});
