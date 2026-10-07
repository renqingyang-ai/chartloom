import { forwardRef } from 'react';
import { scaleLinear } from 'd3';
import { OM_COMPONENT_THEME as theme } from './theme';

/** One data-driven schedule grammar; source measurements are independent of tasks. */
export const SourceSchedule=forwardRef<SVGSVGElement,{figure:any}>(function SourceSchedule({figure:f},ref){
 const l=f.scheduleLayout,w=1000,h=w/l.aspect,[bx,by,bw,bh]=l.plotBox,px=(v:number)=>v*w/100,py=(v:number)=>v*h/100;
 const left=px(bx),right=px(bx+bw),top=py(by),bottom=py(by+bh),x=scaleLinear().domain([0,1]).range([left,right]);
 const fs=py(l.fontSize),rows=f.tasks.map((_:any,i:number)=>l.rowCenters.length===f.tasks.length?py(l.rowCenters[i]):top+(i+.5)*(bottom-top)/f.tasks.length);
 const size=Math.min(py(l.barHeight),(bottom-top)/Math.max(1,f.tasks.length)*.85),ink=theme.colors.ink;
 return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} data-testid="pipeline-figure" data-component="source-schedule-v1" data-kind="gantt" role="img" aria-label={f.title} style={{width:'100%',height:'auto',display:'block'}} fontFamily={theme.font.data.family} fontSize={fs} fill={ink}>
  <title>{f.title}</title><rect width={w} height={h} fill={theme.colors.background} data-chart-background="true"/>
  {f.ticks.map((label:string,i:number)=>{const at=x(i/Math.max(1,f.ticks.length-1));return <g key={i} data-gantt-tick={i}>
   {l.grid&&<line x1={at} x2={at} y1={top} y2={bottom} stroke="#d9dcd5"/>}<text x={at} y={l.tickSide==='top'?top-fs*.65:bottom+fs*1.3} textAnchor="middle">{label}</text></g>;})}
  <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#9ca79f"/><line x1={left} x2={left} y1={top} y2={bottom} stroke="#9ca79f"/>
  {f.tasks.map((t:any,i:number)=>{const cy=rows[i],a=x(t.start),b=x(t.end);return <g key={i} data-gantt-task={i} data-start={t.start} data-end={t.end}>
   <text x={left-fs*.5} y={cy+fs*.32} textAnchor="end">{t.label}</text>{t.milestone?<path data-gantt-mark={i} d={`M${a},${cy-size/2}l${size/2},${size/2}l${-size/2},${size/2}l${-size/2},${-size/2}Z`} fill={ink}/>:<rect data-gantt-mark={i} x={a} y={cy-size/2} width={Math.max(1,b-a)} height={size} fill={ink}/>}</g>;})}
  {l.xTitle&&<text x={(left+right)/2} y={Math.min(h-fs*.2,bottom+fs*3)} textAnchor="middle">{l.xTitle}</text>}
  {l.yTitle&&<text x={fs*1.1} y={(top+bottom)/2} textAnchor="middle" transform={`rotate(-90,${fs*1.1},${(top+bottom)/2})`}>{l.yTitle}</text>}
  {(l.title||'')&&<text x={left} y={Math.max(fs,top-fs*2)} fontFamily={theme.font.heading.family} fontSize={fs*1.25}>{l.title}</text>}
 </svg>;
});
