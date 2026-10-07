import { COLORS, TYPOGRAPHY } from '@/templates/asset-noir/generated-design-tokens';

/** OM font tokens + palette from the reviewed chart baseline. One theme for all registered components. */
export const OM_COMPONENT_THEME={
 colors:window.CHART_PLATFORM_THEME?.chartColors || {ink:COLORS.text.primary,primary:'#D0B795',secondary:'#DECFBA',tertiary:'#EFE4D6',background:COLORS.bg.secondary},
 font:{heading:{family:TYPOGRAPHY.fonts.heading,size:32,weight:500},data:{family:TYPOGRAPHY.fonts.data,size:20,weight:400},note:{family:TYPOGRAPHY.fonts.comment,size:16,weight:300,style:'italic'}}
};

export type ChartPaint={color:string;pattern?:'hatch'|'dots'};
/** Geometry determines the visual role; input series order still determines the legend binding. */
export function chartSeriesPaints(kind:string,geometries:string[]):ChartPaint[]{
 const c=OM_COMPONENT_THEME.colors;
 const stacked:ChartPaint[]=[{color:c.ink},{color:c.secondary},{color:c.secondary,pattern:'hatch'},{color:c.primary},{color:c.tertiary},{color:c.tertiary,pattern:'dots'}];
 const warm:ChartPaint[]=[{color:c.primary},{color:c.ink},{color:c.secondary},{color:c.secondary,pattern:'hatch'},{color:c.tertiary},{color:c.tertiary,pattern:'dots'}];
 const strokes=[c.ink,c.primary,'#907B5D',c.secondary];
 const mixed=geometries.includes('bar')&&geometries.some(g=>g==='line'||g==='point');
 let bar=0,stroke=0;
 return geometries.map((geometry,i)=>{
  if(mixed){if(geometry==='bar')return warm[bar++%warm.length];return {color:strokes[stroke++%strokes.length]};}
  if(geometry==='line'||geometry==='point')return {color:strokes[i%strokes.length]};
  const palette=kind==='stacked-bar'?stacked:warm;return palette[i%palette.length];
 });
}
