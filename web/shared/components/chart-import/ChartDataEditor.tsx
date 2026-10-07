import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import { CHART_KINDS, type ImportedChart } from '@/types/chart-import';
import { parseChartNumber } from '@/lib/chart-import/spreadsheet';
import { chartColumnLabel, pasteChartCells } from '@/lib/chart-import/grid';

const field = 'h-9 w-full rounded border border-[#ded9cf] bg-white px-2 text-sm text-[#1D262D] outline-none focus:border-[#9c805a]';
const titles = { bar: 'Bars', 'grouped-bar': 'Grouped bars', 'stacked-bar': 'Stacked bars', line: 'Lines' };

function NumericCell({ value, label, cellId, onChange, onPaste, onValidityChange }: { value: number | null; label: string; cellId: string; onChange: (value: number | null) => void; onPaste: (event: ClipboardEvent<HTMLInputElement>) => void; onValidityChange: (cellId: string, valid: boolean) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const valid = !text.trim() || parseChartNumber(text) !== null;
  useEffect(() => { setText(current => parseChartNumber(current) === value ? current : value === null ? '' : String(value)); }, [value]);
  useEffect(() => { onValidityChange(cellId, valid); return () => onValidityChange(cellId, true); }, [cellId, valid, onValidityChange]);
  return <input aria-label={label} aria-invalid={!valid} title={valid ? undefined : 'Enter a number, or clear the cell to leave it unknown.'} className={`${field} text-right tabular-nums ${!valid ? 'border-red-500 bg-red-50' : value === null ? 'border-amber-400 bg-amber-50' : ''}`}
    inputMode="decimal" value={text} placeholder="Unknown" onPaste={onPaste} onChange={event => { setText(event.target.value); onChange(parseChartNumber(event.target.value)); }} />;
}

export function ChartDataEditor({ chart, onChange, onValidityChange, fixedGeometryLabel }: { chart: ImportedChart; onChange: (chart: ImportedChart) => void; onValidityChange: (valid: boolean) => void; fixedGeometryLabel?:string }) {
  const [pasteError, setPasteError] = useState('');
  const [pasteRevision, setPasteRevision] = useState(0);
  const [invalidCells, setInvalidCells] = useState<Record<string, boolean>>({});
  const recordValidity = useCallback((cellId: string, valid: boolean) => setInvalidCells(current => {
    if (Boolean(current[cellId]) === !valid) return current;
    const next = { ...current }; if (valid) delete next[cellId]; else next[cellId] = true; return next;
  }), []);
  const valid = Object.keys(invalidCells).length === 0;
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);
  const update = (patch: Partial<ImportedChart>) => onChange({ ...chart, ...patch,
    userEdited: chart.userEdited || Boolean(patch.series || patch.labels), reviewed: false });
  const paste = (row: number, column: number) => (event: ClipboardEvent<HTMLElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!/[\t\n\r]/.test(text)) return;
    event.preventDefault(); setPasteError('');
    try { onChange(pasteChartCells(chart, row, column, text)); setPasteRevision(value => value + 1); } catch (cause) { setPasteError((cause as Error).message); }
  };
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs text-[#696762]">Title<input aria-label="Chart title" className={`${field} mt-1`} value={chart.title} maxLength={240} onChange={e => update({ title: e.target.value })} /></label>
      <label className="text-xs text-[#696762]">Chart type{fixedGeometryLabel?<div className={`${field} mt-1`}>{fixedGeometryLabel} · 换图型请修改需求后重新生成</div>:<select aria-label="Chart type" className={`${field} mt-1`} value={chart.kind} onChange={e => update({ kind: e.target.value as ImportedChart['kind'] })}>{CHART_KINDS.map(kind => <option key={kind} value={kind}>{titles[kind]}</option>)}</select>}</label>
      <label className="text-xs text-[#696762]">Unit<input aria-label="Chart unit" className={`${field} mt-1`} placeholder="$ millions, MW, %…" value={chart.unit} maxLength={80} onChange={e => update({ unit: e.target.value })} /></label>
      <label className="text-xs text-[#696762]">Source date, if known<input aria-label="Source date" type="date" className={`${field} mt-1`} value={chart.source.asOf} onChange={e => update({ source: { ...chart.source, asOf: e.target.value } })} /></label>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs text-[#696762]">
      <strong>Chart data</strong><span>Paste a range from Excel. Empty cells stay unknown.</span>
      <button type="button" className="rounded border bg-white px-2 py-1" onClick={() => update({ labels: [...chart.labels, ''], series: chart.series.map(s => ({ ...s, values: [...s.values, null] })) })}>+ Row</button>
      <button type="button" disabled={!!fixedGeometryLabel} className="rounded border bg-white px-2 py-1" onClick={() => update({ kind: chart.kind === 'bar' ? 'grouped-bar' : chart.kind, series: [...chart.series, { name: `Series ${chart.series.length + 1}`, values: chart.labels.map(() => null) }] })}>+ Series</button>
    </div>
    {pasteError && <p role="alert" className="text-sm text-red-700">{pasteError}</p>}
    {!valid && <p role="alert" className="text-sm text-red-700">Fix the highlighted number cells before applying or exporting. Clear a cell only when its value is unknown.</p>}
    <div className="max-h-72 overflow-auto rounded border border-[#d4d8d4]">
      <table aria-label="Chart data spreadsheet" className="w-full border-separate border-spacing-0 text-sm"><thead className="sticky top-0 z-10 bg-[#e8ede8]">
      <tr className="text-[11px] text-[#596759]"><th className="w-9 border-b border-r p-1" /><th className="border-b border-r p-1">A</th>{chart.series.map((_, i) => <th key={i} className="border-b border-r p-1">{chartColumnLabel(i + 1)}</th>)}<th className="w-8 border-b" /></tr><tr>
        <th className="border-r p-1 text-xs font-normal text-[#596759]">1</th><th tabIndex={0} aria-label="Paste table with headers" onPaste={paste(-1, 0)} className="min-w-40 border-r p-2 text-left font-medium">Category</th>
        {chart.series.map((series, si) => <th key={si} className="min-w-32 border-r p-2"><div className="flex items-center gap-1"><input aria-label={`Series ${si + 1} name`} className={field} value={series.name} maxLength={120} onPaste={paste(-1, si + 1)}
          onChange={e => update({ series: chart.series.map((s, i) => i === si ? { ...s, name: e.target.value } : s) })} /><button type="button" aria-label={`Remove series ${si + 1}`} className="px-1 font-normal text-[#696762]" disabled={!!fixedGeometryLabel || chart.series.length <= 1} onClick={() => update({ series: chart.series.filter((_, i) => i !== si) })}>×</button></div></th>)}<th />
      </tr></thead><tbody>{chart.labels.map((label, row) => <tr key={row}>
        <th className="border-r border-t bg-[#f0f3ef] p-1 text-xs font-normal text-[#596759]">{row + 2}</th>
        <td className="border-r border-t border-[#dfe4de] p-1"><input aria-label={`Category ${row + 1}`} className={field} value={label} maxLength={120} onPaste={paste(row, 0)}
          onChange={e => update({ labels: chart.labels.map((item, i) => i === row ? e.target.value : item) })} /></td>
        {chart.series.map((series, si) => <td key={si} className="border-r border-t border-[#dfe4de] p-1"><NumericCell key={pasteRevision} value={series.values[row]} cellId={`${row}:${si}`} onValidityChange={recordValidity} onPaste={paste(row, si + 1)}
          label={`${series.name}, ${label || row + 1}`} onChange={value => update({ series: chart.series.map((s, i) => i === si ? { ...s, values: s.values.map((v, r) => r === row ? value : v) } : s) })} /></td>)}
        <td className="border-t text-center"><button type="button" aria-label={`Remove category ${row + 1}`} className="px-2 text-[#807d71]" disabled={chart.labels.length <= 1} onClick={() => update({ labels: chart.labels.filter((_, i) => i !== row), series: chart.series.map(s => ({ ...s, values: s.values.filter((_, i) => i !== row) })) })}>×</button></td>
      </tr>)}</tbody></table>
    </div>
    {chart.userEdited && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Data includes user edits. Recheck source values and callouts such as CAGR before applying; callout text is not recalculated automatically.</p>}
    <label className="block text-xs text-[#696762]">Footnotes and callouts (one per line)
      <textarea aria-label="Chart footnotes" className={`${field} mt-1 h-16 py-2`} value={chart.annotations.join('\n')}
        onChange={e => update({ annotations: e.target.value.split('\n').slice(0, 20).map(line => line.slice(0, 600)) })} />
    </label>
    <div className="flex flex-wrap gap-4 text-sm text-[#696762]">{([
      ['valueAxis', 'Value axis'], ['grid', 'Grid lines'], ['legend', 'Legend'], ['trendArrow', 'CAGR arrow'],
    ] as const).map(([key, label]) => <label key={key} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={chart.presentation[key]}
      onChange={e => update({ presentation: { ...chart.presentation, [key]: e.target.checked } })} />{label}</label>)}</div>
    {chart.series.some(series => series.values.includes(null)) && <label className="flex items-center gap-2 text-sm text-amber-900">
      <input type="checkbox" checked={chart.allowGaps} onChange={e => update({ allowGaps: e.target.checked })} />Keep empty values as gaps, never as zero.
    </label>}
  </div>;
}
