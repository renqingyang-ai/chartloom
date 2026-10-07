export interface RenderTheme {
  colors: { ink: string; primary: string; secondary: string; tertiary: string; background: string };
  font: Record<'heading' | 'data' | 'note', { family: string; size: number; weight: number; style?: string }>;
}
export function renderReferenceFigure(host: HTMLElement, figure: Record<string, any>, theme: RenderTheme): SVGSVGElement;
