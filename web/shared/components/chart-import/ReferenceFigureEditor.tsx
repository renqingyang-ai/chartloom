import { useEffect, useState } from 'react';
import { figureTables, updateFigureCells, type FigureCell } from '@/lib/chart-import/figure-tables';
import { parseChartNumber } from '@/lib/chart-import/spreadsheet';
import { validateImportedChart, type ImportedChart } from '@/types/chart-import';

export function ReferenceFigureEditor({ chart, onChange, onValidityChange }: { chart: ImportedChart; onChange: (chart: ImportedChart) => void; onValidityChange: (valid: boolean) => void }) {
  const [tables] = useState(() => figureTables(chart.referenceFigure!));
  const [draft, setDraft] = useState(() => tables.map(t => t.rows.map(row => row.map(v => v === null ? '' : String(v)))));
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => { onValidityChange(true); }, [onValidityChange]);
  const apply = (next: string[][][]) => {
    setDraft(next);
    try {
      const changes = tables.flatMap((t, ti) => t.rows.flatMap((row, r) => row.map((old, c) => {
        const text = next[ti][r][c]; let value: FigureCell = text;
        if (typeof old === 'boolean') { if (!/^(true|false|1|0)$/i.test(text)) throw new Error('Milestone must be TRUE or FALSE.'); value = /^(true|1)$/i.test(text); }
        else if (typeof old === 'number' || old === null) { value = parseChartNumber(text); if (text.trim() && value === null) throw new Error(`Enter a valid number in ${t.name}, row ${r + 2}.`); }
        return { path: t.paths[r][c], value };
      })));
      const referenceFigure = updateFigureCells(chart.referenceFigure!, changes);
      onChange(validateImportedChart({ ...chart, referenceFigure, userEdited: true, reviewed: false })); setError(''); onValidityChange(true);
    } catch (cause) { setError((cause as Error).message); onValidityChange(false); }
  };
  const table = tables[active];
  const quality = {
    'printed-values': 'Values were transcribed from numbers printed in the source.',
    'digitized-vector-position': 'Values are approximate readings from the source plot.',
    'digitized-vector-curve': 'Values are approximate readings from the source curves.',
    'baseline-text-with-input-overrides': 'Milestones retain source text and the documented input-file corrections.',
    'source-plot-positions': 'Task positions were read from the source schedule; they are not exact calendar dates.',
    'categorical-source-diagram': 'Market names and tier groupings come from the source diagram.',
  }[chart.referenceFigure!.quality] || chart.referenceFigure!.quality;
  return <div className="space-y-3">
    <label className="block text-xs text-[#696762]">Data sheet<select aria-label="Figure data sheet" className="mt-1 h-9 w-full rounded border bg-white px-2 text-sm" value={active} onChange={e => setActive(Number(e.target.value))}>{tables.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}</select></label>
    <p className="text-xs text-[#696762]">Edit cells, paste a range, or export Excel. Original annotations have their own sheets.{chart.referenceFigure!.kind === 'gantt' && ' Schedule positions are relative to the source time axis; they are not exact calendar dates.'}</p>
    <div className="max-h-[420px] overflow-auto rounded border"><table aria-label="Figure data spreadsheet" className="w-full border-collapse bg-white text-sm"><thead className="sticky top-0 bg-[#e8ede8]"><tr><th className="p-2" />{table.headers.map(h => <th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead>
      <tbody>{table.rows.map((row, r) => <tr key={r}><th className="border bg-[#f0f3ef] p-2 text-xs font-normal">{r + 2}</th>{row.map((_, c) => <td key={c} className="border p-1"><input aria-label={`${table.name}, row ${r + 2}, ${table.headers[c]}`} className="w-full min-w-28 rounded border border-transparent px-2 py-2 focus:border-[#9c805a]" value={draft[active][r][c]} readOnly={!table.paths[r][c].length}
        onChange={e => { const next = structuredClone(draft); next[active][r][c] = e.target.value; apply(next); }}
        onPaste={e => { const text = e.clipboardData.getData('text/plain'); if (!/[\t\n\r]/.test(text)) return; e.preventDefault(); const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(s => s.split('\t')); const next = structuredClone(draft);
          if (r + rows.length > table.rows.length || rows.some(row => c + row.length > table.headers.length)) { setError('The pasted range exceeds this source figure. Paste only the data cells.'); return; }
          rows.forEach((row, i) => row.forEach((v, j) => { if (table.paths[r + i][c + j].length) next[active][r + i][c + j] = v; })); apply(next); }} /></td>)}</tr>)}</tbody></table></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{quality}{['single', 'stacked', 'grouped', 'balance', 'curves'].includes(chart.referenceFigure!.kind) && ' Check printed totals, margins and CAGR after edits; these source annotations are preserved independently and are not recalculated.'}{chart.referenceFigure!.sourceLegendConflict ? ' The source balance-sheet legend has a color mismatch; the chart retains the † note.' : ''}</p>
  </div>;
}
