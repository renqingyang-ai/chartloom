import {forwardRef, useId} from 'react';
import {arc, area, line, pie, scaleBand, scaleLinear, stack, stackOffsetDiverging} from 'd3';
import type {ImportedChart} from '@/types/chart-import';
import {OM_COMPONENT_THEME, chartSeriesPaints} from './theme';

const number=(n:number)=>new Intl.NumberFormat('en-US',{maximumSignificantDigits:12}).format(n);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const wrap=(s:string,n:number)=>{const words=s.match(/[\u3400-\u9fff]|\S+\s*/g)||[];const lines:string[]=[];let line='';for(const w of words){if(line.length+w.length>n&&line){lines.push(line.trim());line='';}line+=w;}if(line)lines.push(line.trim());return lines;};
function Copy({x,y,text,size=16,anchor='start',width=30,fill}:{x:number;y:number;text:string;size?:number;anchor?:'start'|'middle'|'end';width?:number;fill?:string}){
 return <text x={x} y={y} textAnchor={anchor} fontSize={size} fill={fill}>{wrap(text,width).map((s,i)=><tspan key={i} x={x} dy={i?size*1.25:0}>{s}</tspan>)}</text>;
}

/** Adaptive geometry for data-first charts; source-image reconstruction stays on its own path. */
export const DataChartFigure=forwardRef<SVGSVGElement,{figure:any}>(function DataChartFigure({figure},ref){
 const c:ImportedChart=figure.chart,d=figure.dataDesign,t=OM_COMPONENT_THEME,id=useId().replace(/:/g,''),w=1000;
 const isPie=['pie','donut'].includes(d.kind),isScatter=d.kind==='scatter';
 const kind=['combo','pie','donut','scatter','area'].includes(d.kind)?d.kind:c.kind;
 const horizontal=d.orientation==='horizontal'&&!isPie&&!isScatter;
 const styles=c.series.map((_,i)=>({geometry:kind==='combo'?(d.series[i]?.geometry||'bar'):['line','area'].includes(kind)?kind:'bar',axis:kind==='combo'?(d.series[i]?.axis||'primary'):'primary'}));
 const paints=chartSeriesPaints(c.kind,isPie?c.labels.map(()=>'bar'):styles.map(s=>s.geometry));
 const baseHeight=horizontal?Math.max(620,190+c.labels.length*46):isPie?Math.max(660,180+c.labels.length*38):660;
 const noteLines=c.annotations.flatMap(note=>wrap(note,100)),h=baseHeight+(noteLines.length?22+noteLines.length*18:0);
 const headLines=wrap(c.title,48),top=65+headLines.length*32,left=horizontal?200:100,right=kind==='combo'&&styles.some(s=>s.axis==='secondary')?890:944,bottom=baseHeight-130;
 const rows=c.labels.map((_,i)=>c.series.map(s=>s.values[i]));
 const layers=stack<(number|null)[],number>().keys(c.series.map((_,i)=>i)).value((r,k)=>r[k]??0).offset(stackOffsetDiverging)(rows);
 const domain=(values:number[],zero=true):[number,number]=>{let lo=Math.min(...values),hi=Math.max(...values);if(!values.length)return [0,1];if(zero){lo=Math.min(0,lo);hi=Math.max(0,hi);}if(lo===hi){lo-=lo===0?0:Math.abs(lo)*.1;hi+=Math.abs(hi)*.1||1;}return [lo,hi];};
 const scale=(secondary=false)=>{const values=kind==='stacked-bar'?layers.flatMap(l=>l.flatMap(p=>[...p])):c.series.flatMap((s,i)=>(styles[i].axis==='secondary')===secondary?s.values.filter(finite):[]);return scaleLinear().domain(domain(values)).nice(5).range(horizontal?[left,right]:[bottom,top]);};
 const primary=scale(),secondary=scale(true),yScale=(i:number)=>styles[i].axis==='secondary'?secondary:primary;
 const bands=scaleBand<number>().domain(c.labels.map((_,i)=>i)).range(horizontal?[top,bottom]:[left,right]).padding(.28);
 const barIndices=styles.flatMap((s,i)=>s.geometry==='bar'?[i]:[]),sub=scaleBand<number>().domain(barIndices).range([0,bands.bandwidth()]).padding(.12);
 const center=(i:number)=>(bands(i)??0)+bands.bandwidth()/2;
 const palette=(i:number)=>paints[i%paints.length];
 const fill=(i:number)=>palette(i).pattern?`url(#data-${id}-${i})`:palette(i).color;
 const unit=(i:number)=>styles[i].axis==='secondary'?d.secondaryUnit:c.unit;
 const label=(v:number,i:number)=>number(v)+(unit(i)==='%'?'%':'');
 const tick=(v:number,u:string)=>number(v)+(u==='%'?'%':'');
 const axis=(sc:ReturnType<typeof scale>,other=false)=> <g data-axis={other?'secondary':'primary'}>
  {sc.ticks(5).map(v=><g key={v}>{horizontal?<><line x1={sc(v)} x2={sc(v)} y1={top} y2={bottom} stroke={t.colors.ink} opacity={c.presentation.grid?.12:0}/><text x={sc(v)} y={bottom+26} textAnchor="middle">{tick(v,other?d.secondaryUnit:c.unit)}</text></>:<><line x1={left} x2={right} y1={sc(v)} y2={sc(v)} stroke={t.colors.ink} opacity={!other&&c.presentation.grid?.12:0}/><text x={other?right+14:left-14} y={sc(v)+5} textAnchor={other?'start':'end'}>{tick(v,other?d.secondaryUnit:c.unit)}</text></>}</g>)}
  <Copy x={other?right:horizontal?right:left} y={top-22} text={other?d.secondaryUnit:c.unit} width={35} anchor={other||horizontal?'end':'start'}/>
 </g>;
 const geometries=c.series.map((s,si)=>{
  const sc=yScale(si),geometry=styles[si].geometry;
  const points=s.values.map((v,i)=>({v,i}));
  const xx=(v:number,i:number)=>horizontal?sc(v):center(i),yy=(v:number,i:number)=>horizontal?center(i):sc(v);
  const curve=line<typeof points[number]>().defined(p=>finite(p.v)).x(p=>xx(p.v!,p.i)).y(p=>yy(p.v!,p.i));
  const a=area<typeof points[number]>().defined(p=>finite(p.v));
  if(horizontal)a.y(p=>center(p.i)).x0(sc(0)).x1(p=>sc(p.v!));else a.x(p=>center(p.i)).y0(sc(0)).y1(p=>sc(p.v!));
  return <g key={si} data-series={s.name}>
   {geometry==='area'&&<path d={a(points)||''} fill={palette(si).color} fillOpacity={.25}/>}
   {geometry!=='bar'&&<path d={curve(points)||''} fill="none" stroke={palette(si).color} strokeWidth={3} data-line-series={si}/>}
   {s.values.map((v,i)=>{if(!finite(v))return null;const stacked=kind==='stacked-bar',ends=stacked?layers[si][i]:[0,v],at=(bands(i)??0)+(stacked?0:sub(si)??0),bw=stacked?bands.bandwidth():sub.bandwidth(),start=sc(ends[0]),end=sc(ends[1]);
    const x=geometry==='bar'?(horizontal?Math.min(start,end):at):xx(v,i),y=geometry==='bar'?(horizontal?at:Math.min(start,end)):yy(v,i),height=horizontal?bw:Math.abs(end-start),width=horizontal?Math.abs(end-start):bw;
    const inside=stacked&&(horizontal?width:height)>24;
    const lx=geometry==='bar'?(horizontal?inside?(start+end)/2:end+(v<0?-8:8):at+bw/2):xx(v,i);
    const ly=geometry==='bar'?(horizontal?at+bw/2+5:inside?(start+end)/2+5:end+(v<0?22:-10)):yy(v,i)-11;
    return <g key={i} data-mark={`${si}:${i}`} data-value={v}>{geometry==='bar'?<rect x={x} y={y} width={width} height={height} fill={fill(si)} rx={1}/>:<circle cx={x} cy={y} r={4.5} fill={palette(si).color} stroke={t.colors.background} strokeWidth={1.5}/>}
     {d.showValues&&(!stacked||inside)&&<text x={lx} y={ly} textAnchor={horizontal&&!inside?(v<0?'end':'start'):'middle'} fontSize={14} fill={inside&&palette(si).color===t.colors.ink?t.colors.background:t.colors.ink}>{label(v,si)}</text>}
     <title>{`${c.labels[i]} · ${s.name}: ${label(v,si)}`}</title></g>;
   })}
  </g>;
 });
 const legend=(isPie?c.labels:c.series.map(s=>s.name)).map((name,i)=>({name,i}));
 const legendCols=3,legendY=baseHeight-42,legendRows=Math.ceil(legend.length/legendCols);
 const pieMarks=()=>{const r=190,cx=310,cy=(top+bottom)/2,arcs=pie<number>().sort(null).value(v=>v)(c.series[0].values as number[]),shape=arc<any>().innerRadius(kind==='donut'?r*.6:0).outerRadius(r),total=c.series[0].values.reduce<number>((sum,v)=>sum+(v||0),0);return <g transform={`translate(${cx},${cy})`}>{arcs.map((p,i)=>{const point=shape.centroid(p);return <g key={i} data-mark={`0:${i}`} data-value={p.value}><path d={shape(p)||''} fill={fill(i)} stroke={t.colors.background} strokeWidth={3}/>{d.showValues&&p.endAngle-p.startAngle>.3&&<text x={point[0]} y={point[1]} textAnchor="middle" fill={palette(i).color===t.colors.ink?t.colors.background:t.colors.ink}>{number(p.value)}</text>}<title>{`${c.labels[i]}: ${number(p.value)} (${number(p.value/total*100)}%)`}</title></g>;})}{kind==='donut'&&<><text textAnchor="middle" y={-8} fontSize={16}>合计</text><text textAnchor="middle" y={25} fontSize={28}>{number(total)}</text></>}</g>;};
 const scatter=()=>{const xs=c.series[0].values,ys=c.series[1]?.values||[],sx=scaleLinear().domain(domain(xs.filter(finite),false)).nice().range([left,right]),sy=scaleLinear().domain(domain(ys.filter(finite),false)).nice().range([bottom,top]);return <g><Copy x={left} y={top-22} text={c.series[1]?.name||''}/>{sx.ticks(6).map(v=><text key={v} x={sx(v)} y={bottom+28} textAnchor="middle">{number(v)}</text>)}{sy.ticks(5).map(v=><g key={v}><line x1={left} x2={right} y1={sy(v)} y2={sy(v)} stroke={t.colors.ink} opacity={.12}/><text x={left-14} y={sy(v)+5} textAnchor="end">{number(v)}</text></g>)}{xs.map((x,i)=>!finite(x)||!finite(ys[i])?null:<g key={i} data-mark={`point:${i}`} data-x={x} data-value={ys[i]}><circle cx={sx(x)} cy={sy(ys[i]!)} r={7} fill={t.colors.primary} stroke={t.colors.ink} strokeWidth={1.5}/>{d.showValues&&<text x={sx(x)+10} y={sy(ys[i]!)-10} fontSize={14}>{number(ys[i]!)}</text>}<title>{`${c.series[0].name}: ${x}; ${c.series[1].name}: ${ys[i]}`}</title></g>)}<Copy x={(left+right)/2} y={bottom+64} text={c.series[0].name} anchor="middle"/></g>;};
 return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:'auto',display:'block'}} data-testid="pipeline-figure" data-kind={kind} data-origin="data" fontFamily={t.font.data.family} fontSize={16} fill={t.colors.ink}>
  <title>{c.title}</title><rect data-chart-background="true" width={w} height={h} fill={t.colors.background}/>
  <defs>{paints.map((paint,i)=>paint.pattern?<pattern key={i} id={`data-${id}-${i}`} width={6} height={6} patternUnits="userSpaceOnUse"><rect width={6} height={6} fill={paint.color}/>{paint.pattern==='dots'?<circle cx={3} cy={3} r={.7} fill={t.colors.ink}/>:<path d="M0,6L6,0" stroke={t.colors.ink} strokeWidth={.5}/>}</pattern>:null)}</defs>
  <g fontFamily={t.font.heading.family}><Copy x={32} y={43} text={c.title} size={30} width={48}/></g>
  {isPie?pieMarks():isScatter?scatter():<>{c.presentation.valueAxis&&axis(primary)}{c.presentation.valueAxis&&styles.some(s=>s.axis==='secondary')&&axis(secondary,true)}{geometries}{c.labels.map((name,i)=><Copy key={i} x={horizontal?left-16:center(i)} y={horizontal?center(i)+5:bottom+26} text={name} width={horizontal?20:Math.max(4,Math.floor(bands.step()/9))} size={14} anchor={horizontal?'end':'middle'}/>)}</>}
  {noteLines.map((text,i)=><text key={'note-'+i} x={32} y={baseHeight+16+i*18} fontFamily={t.font.note.family} fontSize={13}>{text}</text>)}
  {!isScatter&&c.presentation.legend&&legend.map(({name,i})=>{const x=isPie?575:32+(i%legendCols)*320,y=isPie?top+25+i*38:legendY-(legendRows-1-Math.floor(i/legendCols))*26;return <g key={i} data-legend={name}><rect x={x} y={y-12} width={14} height={14} rx={2} fill={fill(i)}/><Copy x={x+24} y={y} text={name+(kind==='combo'&&styles[i].axis==='secondary'?' · 右轴':'')} size={15} width={isPie?40:28}/></g>;})}
 </svg>;
});
