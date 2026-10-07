/** Preserve extracted annotations across the model and renderer schemas.
 * Values are source strings, never recalculated growth rates.
 */
export function chartTrendAnnotation(figure: any): string | undefined {
  const chart = figure.chart;
  const direct = chart?.annotations?.find((text: string) => /CAGR/i.test(text));
  if (direct) return direct;
  const candidates = figure.seriesAnnotations?.filter((item: any) =>
    chart?.series?.some((s:any)=>s.name===item.series) && /CAGR/i.test(item.label) && item.value?.trim()) || [];
  if (candidates.length !== 1 || (chart?.series?.length !== 1 && !chart?.presentation?.trendArrow)) return undefined;
  const annotation = candidates[0];
  if (!annotation) return undefined;
  const escapedSeries=annotation.series.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const labelNamesSeries=new RegExp(`(?:^|\\s)${escapedSeries}(?=\\s|[:：(]|$)`,'i').test(annotation.label);
  const name=chart.series.length>1&&!labelNamesSeries?annotation.series+' ':'';
  return [figure.seriesAnnotationPeriod, `${name}${annotation.label}: ${annotation.value}`].filter(Boolean).join(' ');
}

/** Native axes calibrate data positions; preserve their physical aspect ratio. */
export function nativePlotHeight(figure:any,pageAspect:number,plotWidth:number,margins:number,fallback=380){
  const calibration=figure.nativePlot?.calibration,axes=figure.axes;
  if(!calibration||!axes)return fallback;
  const sourceWidth=(axes.xDomain[1]-axes.xDomain[0])/Math.abs(calibration.x[0]);
  const sourceHeight=(axes.yDomain[1]-axes.yDomain[0])/Math.abs(calibration.y[0]);
  const height=plotWidth*sourceHeight/sourceWidth/pageAspect+margins;
  return Number.isFinite(height)&&height>=180&&height<=1600?height:fallback;
}
