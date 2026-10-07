import type { ReferenceFigure } from '@/types/reference-figure';
export function renderReferenceFigure(host: HTMLElement, figure: ReferenceFigure, theme: {
  colors: Record<string, string>; font: Record<string, { family: string; size: number; weight: number; style?: string }>;
}): SVGSVGElement;
