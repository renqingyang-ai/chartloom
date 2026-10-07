import { forwardRef } from 'react';
import { arc, pie } from 'd3';
import { OM_COMPONENT_THEME as theme } from './theme';

/** Circle geometry and label visibility come from the uploaded chart, not a sample. */
export const SourcePie=forwardRef<SVGSVGElement,{figure:any;aspect:number;standalone?:boolean}>(function SourcePie({figure:f,aspect,standalone=false},ref){
 const width=1000,height=width/aspect,c=f.chart,l=f.pieLayout,[bx,by,bw,bh]=l.plotBox;
 const cx=(bx+bw/2)*width/100,cy=(by+bh/2)*height/100,r=Math.min(bw*width,bh*height)/200;
 const angle=l.startAngle*Math.PI/180,arcs=pie<number>().sort(null).value(v=>v).startAngle(angle).endAngle(angle+2*Math.PI*(l.clockwise===false?-1:1))(c.series[0].values);
 const path=arc<any>().innerRadius(r*l.holeRatio).outerRadius(r);
 const colors=[theme.colors.ink,theme.colors.secondary,theme.colors.primary,theme.colors.tertiary];
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;context.font=`20px ${theme.font.data.family}`;
 const order=[...new Set<number>([...(f.legendOrder||[]).map((label:string)=>c.labels.indexOf(label)).filter((i:number)=>i>=0),...c.labels.map((_:string,i:number)=>i)])];
 const lengths=order.map(i=>context.measureText(c.labels[i]).width+42),total=lengths.reduce((sum:number,n:number)=>sum+n,0),scale=Math.min(1,(width-40)/total),horizontal=l.legendOrientation==='horizontal';
 const bottom=Math.min(height-16,Math.max(cy+r+34,height*.96)),left=(width-total*scale)/2;
 return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} data-testid="pipeline-figure" data-kind="pie" data-component="source-pie-v1" role="img" aria-label={f.title} style={{width:'100%',height:standalone?'auto':'100%',display:'block'}} fontFamily={theme.font.data.family}>
  <title>{f.title}</title><rect data-chart-background="true" width={width} height={height} fill={theme.colors.background}/>
  <text x={14} y={32} fontFamily={theme.font.heading.family} fontSize={28} fill={theme.colors.ink}>{c.title||f.title}</text>
  <g transform={`translate(${cx},${cy})`}>{arcs.map((a,i)=>{const p=path.centroid(a);return <g key={i} data-value={c.series[0].values[i]} data-category={c.labels[i]}>
   <path data-pie-slice={i} d={path(a)||''} fill={colors[i%colors.length]}/>
   {l.dataLabels&&<text x={p[0]} y={p[1]} textAnchor="middle" dominantBaseline="middle" fill={i%colors.length===0?theme.colors.background:theme.colors.ink} fontSize={20}>{f.valueLabels?.[0]?.[i]?.value===c.series[0].values[i]?f.valueLabels[0][i].text:`${c.series[0].values[i]}${c.unit==='%'?'%':''}`}</text>}
  </g>;})}</g>
  {c.presentation.legend&&order.map((i:number,position:number)=>{const label=c.labels[i],x=horizontal?left+lengths.slice(0,position).reduce((sum:number,n:number)=>sum+n,0)*scale:l.legendPosition==='right'?cx+r+22:l.legendPosition==='left'?14:Math.max(20,cx-r*.7),y=horizontal?bottom:l.legendPosition==='bottom'?bottom-(c.labels.length-1-position)*28:cy-(c.labels.length-1)*14+position*28;return <g key={i} transform={`translate(${x},${y})`}>
   <rect data-pie-legend={i} x={0} y={-14*scale} width={16*scale} height={16*scale} fill={colors[i%colors.length]}/><text data-legend={label} x={22*scale} y={0} fontSize={20*scale} fill={theme.colors.ink}>{label}</text>
  </g>;})}
 </svg>;
});
