import { forwardRef } from 'react';
import { ImportedChartFigure } from '@/templates/asset-noir/components/charts/ImportedChartFigure';
import type { ImportedChart } from '@/types/chart-import';
import { RegisteredFigure, legacyFigure } from './registry';

/** Reuse the same reviewed component registry in saved examples and fresh extraction results. */
export const TrialChartFigure = forwardRef<SVGSVGElement, { chart: ImportedChart }>(function TrialChartFigure({ chart }, ref) {
  if (chart.referenceFigure) return <RegisteredFigure ref={ref} figure={legacyFigure(chart.referenceFigure)} testId="imported-chart-figure" />;
  return <ImportedChartFigure ref={ref} chart={chart} />;
});
