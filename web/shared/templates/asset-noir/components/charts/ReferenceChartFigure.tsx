import { forwardRef, useLayoutEffect, useRef } from 'react';
import type { ImportedChart } from '@/types/chart-import';
import { renderReferenceFigure } from '@/lib/chart-import/reference-renderer.js';
import { COLORS, TYPOGRAPHY } from '../../generated-design-tokens';

/** Preserve the reviewed figure structure; the same SVG is exported and shown in OM. */
export const ReferenceChartFigure = forwardRef<SVGSVGElement, { chart: ImportedChart }>(function ReferenceChartFigure({ chart }, ref) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current || !chart.referenceFigure) return;
    const element = host.current; element.replaceChildren();
    const svg = renderReferenceFigure(element, { ...chart.referenceFigure, title: chart.title }, {
      colors: { ink: COLORS.text.primary, primary: '#D0B795', secondary: '#DECFBA', tertiary: '#EFE4D6', background: COLORS.bg.secondary },
      font: { heading: { family: TYPOGRAPHY.fonts.heading, size: 32, weight: 500 }, data: { family: TYPOGRAPHY.fonts.data, size: 20, weight: 400 }, note: { family: TYPOGRAPHY.fonts.comment, size: 16, weight: 300, style: 'italic' } },
    });
    if (chart.userEdited) {
      const { width, height } = chart.referenceFigure;
      const extra = 30;
      svg.setAttribute('height', String(height + extra)); svg.setAttribute('viewBox', `0 0 ${width} ${height + extra}`);
      svg.querySelector('[data-chart-background]')?.setAttribute('height', String(height + extra));
      const note = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      note.setAttribute('x', '8'); note.setAttribute('y', String(height + 21)); note.setAttribute('font-family', TYPOGRAPHY.fonts.comment);
      note.setAttribute('font-size', '14'); note.setAttribute('fill', COLORS.text.primary);
      note.textContent = 'User-edited data · Check printed totals and annotations'; svg.appendChild(note);
    }
    svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.setAttribute('data-testid', 'imported-chart-figure');
    if (typeof ref === 'function') ref(svg); else if (ref) ref.current = svg;
    return () => { element.replaceChildren(); if (typeof ref === 'function') ref(null); else if (ref) ref.current = null; };
  }, [chart, ref]);
  return <div ref={host} />;
});
