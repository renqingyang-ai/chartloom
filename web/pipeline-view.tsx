import {platformUrl} from '@/lib/chart-platform-url';
import {OM_COMPONENT_THEME} from './components/theme';
import { useEffect, useRef, type Ref } from 'react';
import { scaleBand, scaleLinear, line, stack, stackOffsetDiverging, pie, arc, forceSimulation, forceCollide, forceX, forceY } from 'd3';
import { COLORS, TYPOGRAPHY } from '@/templates/asset-noir/generated-design-tokens';
import { SharedGanttFigure } from './components/gantt';
import { RegisteredFigure, pipelineFigure } from './components/registry';
import { GeographicMap } from './components/geographic-map';
import { SourcePie } from './components/source-pie';
import { SourceLayoutFigure } from './components/source-layout';
import { SourceSchedule } from './components/source-schedule';
import { DataChartFigure } from './components/data-chart';
import { LogoGroup, SourceAsset } from './components/page-assets';
import { FileText, TrendingUp, Zap, Cpu, Handshake, Hammer, Truck } from 'lucide-react';

const C={ink:COLORS.text.primary,bg:COLORS.bg.secondary,colors:[OM_COMPONENT_THEME.colors.ink,OM_COMPONENT_THEME.colors.primary,OM_COMPONENT_THEME.colors.secondary,OM_COMPONENT_THEME.colors.tertiary]};
const fmt=(v:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(v);
function words(text:string,length:number){const out:string[]=[];let current='';for(const w of String(text||'').split(/\s+/)){if((current+' '+w).length>length&&current){out.push(current);current=w;}else current+=(current?' ':'')+w;}if(current)out.push(current);return out;}
const Text=({x,y,text,size=18,width=25,anchor='start',fill=C.ink,weight=400}:{x:number;y:number;text:any;size?:number;width?:number;anchor?:any;fill?:string;weight?:number})=><text x={x} y={y} fill={fill} fontSize={size} fontWeight={weight} textAnchor={anchor}>{words(String(text||''),width).map((s,i)=><tspan key={i} x={x} dy={i?size*1.2:0}>{s}</tspan>)}</text>;
function DiagramCopy({event,size}:{event:any;size:number}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;const fit=()=>{let s=size;el.style.fontSize=`${s}px`;while(s>9&&el.scrollHeight>el.clientHeight+1){s-=.25;el.style.fontSize=`${s}px`;}el.dataset.overflow=String(el.scrollHeight>el.clientHeight+1);};void document.fonts.ready.then(fit);const ro=new ResizeObserver(fit);ro.observe(el);return()=>ro.disconnect();},[event,size]);
 return <div ref={ref} className="diagram-copy" style={{fontSize:size,textAlign:'center'}}><strong>{event.date}</strong><p>{event.description}</p></div>;
}

function Statistical({f,w,h}:{f:any;w:number;h:number}){
 const c=f.chart,n=c.labels.length,grouped=c.kind==='grouped-bar',stacked=c.kind==='stacked-bar';
 const boost=Math.max(1,Math.min(2.2,600/(f.physicalWidth||600))),allCallouts=f.categoryCallouts||[],rows=allCallouts.filter((r:any)=>r.values.filter(Boolean).length>1),inline=allCallouts.filter((r:any)=>r.values.filter(Boolean).length<=1),legends=[...c.series.map((s:any,i:number)=>({name:s.name,color:C.colors[i%C.colors.length]})),...inline.map((r:any)=>({name:r.label,color:''}))],legendCols=boost>1.3?Math.min(2,legends.length):legends.length,legendRows=Math.ceil(legends.length/legendCols),calloutHeight=rows.length*64*boost,fs=Math.min(20,Math.max(12,w/(n*6.4)))*boost,left=c.presentation.valueAxis?68:15,right=w-26,top=(c.presentation.trendArrow?75:43)+calloutHeight,bottom=h-(c.presentation.legend?34+36*legendRows*boost:31);
 const indices=c.labels.map((_:any,i:number)=>String(i)),x=scaleBand<string>().domain(indices).range([left,right]).padding(grouped?.23:.38),sub=scaleBand<string>().domain(c.series.map((_:any,i:number)=>String(i))).range([0,x.bandwidth()]).padding(.15);
 const layers=stack<any,number>().keys(c.series.map((_:any,i:number)=>i)).value((r:any,k:number)=>r[k]??0).offset(stackOffsetDiverging)(c.labels.map((_:any,i:number)=>c.series.map((s:any)=>s.values[i])));
 const vals=stacked?layers.flatMap(l=>l.flatMap(v=>[v[0],v[1]])):c.series.flatMap((s:any)=>s.values.filter((v:any)=>v!==null));
 const lo=Math.min(0,...vals),hi=Math.max(1,...vals),negativeRoom=lo<0?Math.min(48*boost,(bottom-top)*.18):0,y=scaleLinear().domain([lo<0?lo*1.14:0,hi*(f.totals?.length?1.12:1.16)]).range([bottom-negativeRoom,top]);
 const plotline=line<any>().defined(v=>v!==null).x((_:any,i:number)=>(x(String(i))||0)+x.bandwidth()/2).y(v=>y(v));
 const cagr=c.annotations?.find((s:string)=>/CAGR/i.test(s));
 const labelValue=(v:number,i:number,j:number)=>f.valueLabels?.[j]?.[i]?.value===v?f.valueLabels[j][i].text:c.unit==='$'?(v<0?`($${fmt(-v)})`:`$${fmt(v)}`):fmt(v)+(c.unit==='%'?'%':'');
 const callouts:Record<string,number>={};
 if(stacked)for(let i=0;i<n;i++){
  const candidates=layers.map((l,j)=>({j,key:`${j}-${i}`,height:Math.abs(y(l[i][0])-y(l[i][1])),target:(y(l[i][0])+y(l[i][1]))/2})).filter(l=>l.height<16&&c.series[l.j].values[i]!==null),inside=new Set<string>();
  const groups:typeof candidates[]=[];for(const v of candidates){const g=groups.at(-1);if(g&&g.at(-1)!.j===v.j-1)g.push(v);else groups.push([v]);}
  for(const g of groups){const largest=[...g].sort((a,b)=>b.height-a.height)[0];if(largest.height>=10)inside.add(largest.key);}
  const small=candidates.filter(l=>!inside.has(l.key)).sort((a,b)=>a.target-b.target);
  let last=-Infinity;for(const l of small){callouts[l.key]=Math.max(l.target,last+12);last=callouts[l.key];}
  if(small.length){const offset=small.reduce((sum,l)=>sum+callouts[l.key]-l.target,0)/small.length;for(const l of small)callouts[l.key]-=offset;}
 }
 return <g fontFamily={TYPOGRAPHY.fonts.data}>
  <Text x={left} y={23} text={f.caption||(['$','%'].includes(c.unit)?'':c.unit)} size={16} width={80}/>
  {c.presentation.valueAxis&&y.ticks(4).map(v=><g key={v}><Text x={left-9} y={y(v)+5} text={fmt(v)} size={14} anchor="end"/>{c.presentation.grid&&<line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke={C.ink} opacity={.12}/>}</g>)}
  <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke={C.ink} opacity={.3}/>
  {c.series.map((s:any,j:number)=><g key={j} data-series={s.name}>
   {c.kind==='line'&&<path d={plotline(s.values)||''} stroke={C.colors[j%C.colors.length]} strokeWidth={3} fill="none"/>}
   {s.values.map((v:number|null,i:number)=>{if(v===null)return null;const xx=(x(String(i))||0)+(grouped?(sub(String(j))||0):0),bw=grouped?sub.bandwidth():x.bandwidth(),seg=layers[j][i],yy=stacked?y(Math.max(...seg)):Math.min(y(0),y(v)),bh=stacked?Math.abs(y(seg[0])-y(seg[1])):Math.abs(y(v)-y(0));
    const isolatedSmall=stacked&&boost>1.3&&bh<fs*1.3&&c.series.filter((a:any)=>a.values[i]!==null).length===1,small=stacked&&!isolatedSmall&&callouts[`${j}-${i}`]!==undefined,labelSize=isolatedSmall?fs:stacked?Math.min(fs,Math.max(11,bh*.85)):fs;const ylab=isolatedSmall?yy-9:stacked?yy+bh/2+labelSize*.3:y(v)+(v<0?fs+3:-7);
    return <g key={i} data-value={v}>
      {c.kind==='line'?<circle cx={xx+bw/2} cy={y(v)} r={3} fill={C.colors[j%C.colors.length]}/>:<rect x={xx} y={yy} width={bw} height={bh} fill={C.colors[j%C.colors.length]}/>}
      {small?<><path d={`M${xx+bw},${yy+bh/2}L${xx+bw+4},${callouts[`${j}-${i}`]}`} fill="none" stroke={C.ink}/><Text x={xx+bw+5} y={callouts[`${j}-${i}`]+3} text={labelValue(v,i,j)} size={10}/></>:<Text x={xx+bw/2} y={ylab} anchor="middle" text={labelValue(v,i,j)} size={labelSize} fill={stacked&&j===0?C.bg:C.ink}/>}
      <title>{`${c.labels[i]} · ${s.name}: ${v}`}</title>
    </g>;})}
  </g>)}
  {c.labels.map((s:string,i:number)=><Text key={i} x={(x(String(i))||0)+x.bandwidth()/2} y={bottom+21} text={s} width={16} size={Math.min(18,fs)} anchor="middle"/>)}
  {(f.totals||[]).map((v:number|null,i:number)=>v===null||inline.some((r:any)=>Number(String(r.values[i]).replace(/[^\d.\-]/g,''))===v)?null:<Text key={i} x={(x(String(i))||0)+x.bandwidth()/2} y={y(layers.at(-1)?.[i]?.[1]||v)-9} text={(c.unit==='$'?'$':'')+fmt(v)} size={fs} anchor="middle" weight={600}/>)}
  {c.presentation.legend&&legends.map((s:any,i:number)=>{const col=w/legendCols,xx=(i%legendCols)*col,yy=h-19*boost-(legendRows-1-Math.floor(i/legendCols))*36*boost;return <g key={i}><rect x={xx} y={yy} width={12*boost} height={12*boost} fill={s.color||C.bg} stroke={s.color?undefined:C.ink} strokeDasharray={s.color?undefined:'4 3'}/><Text x={xx+17*boost} y={yy+11*boost} text={s.name} size={Math.min(17*boost,col/(s.name.length*.55+3))} width={36}/></g>;})}
  {inline.map((r:any,k:number)=>r.values.map((v:string|null,i:number)=>{if(!v)return null;const xx=(x(String(i))||0)+x.bandwidth()/2,peak=stacked?Math.max(...layers.map(l=>l[i][1])):Math.max(0,...c.series.map((s:any)=>s.values[i]||0)),yy=y(peak)-60*boost-inline.slice(0,k).filter((a:any)=>a.values[i]).length*32*boost,bw=Math.min(x.step()*.85,Math.max(60,v.length*12+18)*boost);return <g key={`${k}-${i}`}><rect x={xx-bw/2} y={yy} width={bw} height={27*boost} fill={C.bg} stroke={C.ink} strokeDasharray="5 4"/><Text x={xx} y={yy+20*boost} text={v} size={19*boost} anchor="middle" width={25}/></g>;}))}
  {rows.map((row:any,k:number)=><g key={k}><Text x={left} y={(23+k*64)*boost} text={row.label} size={16*boost} width={70}/>{row.values.map((v:string|null,i:number)=>{if(!v)return null;const xx=(x(String(i))||0)+x.bandwidth()/2,bw=Math.min(x.step()*.85,Math.max(60,v.length*12+18)*boost);return <g key={i}><rect x={xx-bw/2} y={(30+k*64)*boost} width={bw} height={27*boost} fill={C.bg} stroke={C.ink} strokeDasharray="5 4"/><Text x={xx} y={(50+k*64)*boost} text={v} size={19*boost} anchor="middle" width={25}/></g>;})}</g>)}
  {cagr&&c.presentation.trendArrow&&<g transform={`translate(0,${calloutHeight})`}><path d={`M${w*.18},66 L${w*.9},33 l-12,-3 m12,3 l-8,9`} stroke={C.ink} fill="none"/><Text x={w*.52} y={30} text={cagr} size={18} anchor="middle"/></g>}
 </g>;
}

function PieFigure({f,w,h}:{f:any;w:number;h:number}){
 const c=f.chart,values=c.series[0].values,r=Math.min(w*.28,h*.32),arcs=pie<number>().sort(null).value(v=>v??0)(values),shape=arc<any>().innerRadius(f.donut?r*.55:0).outerRadius(r);
 return <g><g transform={`translate(${w/2},${h*.4})`}>{arcs.map((a,i)=>{const p=shape.centroid(a);return <g key={i} data-value={values[i]}><path d={shape(a)||''} fill={C.colors[i%C.colors.length]} stroke={C.bg} strokeWidth={2}/><Text x={p[0]} y={p[1]} text={`${fmt(values[i])}${c.unit}`} size={24} anchor="middle" fill={i===0?C.bg:C.ink}/></g>;})}</g>{c.labels.map((s:string,i:number)=><g key={i}><rect x={w*.15} y={h*.8+i*26-16} width={16} height={16} fill={C.colors[i%C.colors.length]}/><Text x={w*.15+24} y={h*.8+i*26} text={s} size={21} width={40}/></g>)}</g>;
}

function MapDiagram({f,w,h,bbox}:{f:any;w:number;h:number;bbox:number[]}){
 const nodes=f.nodes||[],map=f.kind==='map',base=f.basemap,b=base?.bbox;
 if(!map&&nodes.length<=8&&Math.max(...nodes.map((n:any)=>n.y))-Math.min(...nodes.map((n:any)=>n.y))<15){const cell=w/nodes.length;return <g><line x1={cell/2} x2={w-cell/2} y1={57} y2={57} stroke={C.colors[3]} strokeWidth={12}/>{nodes.map((n:any,i:number)=>{const lines=n.label.split('\n'),title=lines.shift(),description=lines.join('\n').replace(/\s*[▪•]\s*/g,'\n• '); return <g key={n.id}><circle cx={(i+.5)*cell} cy={57} r={35} fill={C.colors[i%C.colors.length]}/><Text x={(i+.5)*cell} y={67} text={i+1} size={30} anchor="middle" fill={i===0?C.bg:C.ink}/><foreignObject x={i*cell+8} y={110} width={cell-16} height={h-118}><DiagramCopy event={{date:title,description}} size={28}/></foreignObject></g>;})}</g>;}
 const marked=nodes.filter((n:any)=>f.cardLinks?.[n.id]).map((n:any)=>({...n,x:n.x/100*w,y:n.y/100*h,tx:n.x/100*w,ty:n.y/100*h}));
 forceSimulation<any>(marked).force('x',forceX<any>(n=>n.tx).strength(.2)).force('y',forceY<any>(n=>n.ty).strength(.2)).force('collision',forceCollide(19).iterations(3)).stop().tick(70);
 return <g>{base&&<image href={platformUrl(base.url)} x={(b[0]-bbox[0])/bbox[2]*w} y={(b[1]-bbox[1])/bbox[3]*h} width={b[2]/bbox[2]*w} height={b[3]/bbox[3]*h} opacity={.55} style={{filter:'grayscale(1)'}}/>}
  {(f.edges||[]).map((e:any,i:number)=>{const a=nodes.find((n:any)=>n.id===e.from),b=nodes.find((n:any)=>n.id===e.to);if(!a||!b)return null;const ax=a.x/100*w,ay=a.y/100*h,bx=b.x/100*w,by=b.y/100*h,candidates=[.5,.35,.65,.25,.75].map(t=>({x:ax+(bx-ax)*t,y:ay+(by-ay)*t})),p=candidates.sort((a,b)=>Math.min(...marked.map((n:any)=>Math.hypot(b.x-n.x,b.y-n.y)),1e6)-Math.min(...marked.map((n:any)=>Math.hypot(a.x-n.x,a.y-n.y)),1e6))[0];let angle=map?Math.atan2(by-ay,bx-ax)*180/Math.PI:0;if(angle>90)angle-=180;if(angle<-90)angle+=180;const labelWidth=String(e.label||'').length*8+14;return <g key={i}><line x1={ax} y1={ay} x2={bx} y2={by} stroke={C.ink} strokeWidth={2} strokeDasharray={map?'7 5':undefined}/><g transform={`translate(${p.x},${p.y}) rotate(${angle})`}><rect x={-labelWidth/2} y={-23} width={labelWidth} height={21} rx={3} fill={C.bg} opacity={.95}/><Text x={0} y={-7} text={e.label} size={16} anchor="middle" width={40}/></g></g>;})}
  {nodes.map((n:any,i:number)=>{const xx=n.x/100*w,yy=n.y/100*h,m=marked.find((a:any)=>a.id===n.id);if(m)return <g key={n.id}><line x1={xx} y1={yy} x2={m.x} y2={m.y} stroke={C.ink} opacity={.6}/><circle cx={xx} cy={yy} r={3} fill={C.ink}/><circle cx={m.x} cy={m.y} r={15} fill={C.ink} stroke={C.bg} strokeWidth={2}/><Text x={m.x} y={m.y+5} text={f.cardLinks[n.id]} size={16} anchor="middle" fill={C.bg}/><title>{`${f.cardLinks[n.id]} · ${n.label}`}</title></g>;return <g key={n.id}>{map?<circle cx={xx} cy={yy} r={7} fill={C.ink} stroke={C.bg} strokeWidth={2}/>:<rect x={xx-70} y={yy-20} width={140} height={40} rx={3} fill={C.colors[3]}/>}
    <Text x={Math.min(w-70,Math.max(70,xx))} y={yy+(map?(i%2?-14:22):5)} text={n.label} size={map?15:17} width={22} anchor="middle"/><title>{n.label}</title>
   </g>;})}
 </g>;
}

export function PipelineFigure({element,aspect,onEdit,svgRef,standalone=false}:{element:any;aspect:number;onEdit?:(id:string)=>void;svgRef?:Ref<SVGSVGElement>;standalone?:boolean}){
 if(element.figure.dataDesign)return <div className="pipeline-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}}><DataChartFigure figure={element.figure} ref={svgRef}/></div>;
 if(element.figure.kind==='gantt'&&element.figure.scheduleLayout&&!element.figure.phases?.length&&!element.figure.annotations?.length)return <div className="pipeline-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}}><SourceSchedule figure={element.figure} ref={svgRef}/></div>;
 if(element.figure.sourceLayout?.version===1)return <div className="pipeline-figure source-layout-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}} title={onEdit?'点击编辑数据':undefined}><SourceLayoutFigure figure={element.figure} standalone={standalone} ref={svgRef}/></div>;
 // The editable-table kind is only a carrier for mixed graphs. Never turn a
 // failed layout into a different chart and present that as a conversion.
 if(element.figure.layoutVerification?.status==='incomplete'||element.figure.seriesGeometry?.some((s:any)=>s.axis==='secondary'||s.geometry!==(element.figure.chart?.kind==='line'?'line':'bar')))return <div className="pipeline-figure" data-conversion-incomplete="true" style={{padding:24,background:C.bg,color:C.ink}}><strong>图形转换尚未完成</strong><p>这张图的布局或坐标轴未能完整确认。已保留提取数据，请重新转换或核对数据。</p>{onEdit&&<button onClick={()=>onEdit(element.id)}>查看已提取数据</button>}</div>;
 if(element.figure.kind==='pie'&&element.figure.pieLayout){const b=element.sourceBBox||element.bbox;return <div className="pipeline-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}}><SourcePie figure={element.figure} aspect={b[2]/b[3]*aspect} standalone={standalone} ref={svgRef}/></div>;}
 if(element.figure.nativeGeography)return <div className="pipeline-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}} title={onEdit?'点击编辑图形文字':undefined}><GeographicMap figure={{...element.figure,sourceAspect:aspect}} standalone={standalone} ref={svgRef}/></div>;
 if(element.figure.kind==='gantt')return <div className="pipeline-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}} title={onEdit?'点击编辑数据或结构':undefined}><SharedGanttFigure figure={element.figure} ref={svgRef} fillContainer={!standalone} showTitle={standalone||!element.suppressFigureTitle}/></div>;
 const registered=pipelineFigure({...element,aspect});
 if(registered){return <div className="pipeline-figure registered-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}} title={onEdit?'点击编辑数据或结构':undefined}><RegisteredFigure figure={registered} header={{title:element.suppressFigureTitle||element.figure.nativeGeometry?.labels?.some((l:any)=>l.ref[0]==='title')?'':element.figure.chart?.title||element.figure.title,caption:element.figure.caption}} fillContainer={!standalone} ref={svgRef}/></div>;}
 const b=element.bbox,f={...element.figure,physicalWidth:b[2]*14.4},w=1000,headingSize=25*Math.max(1,Math.min(2,600/(b[2]*14.4))),heading=(standalone||f.chart||f.kind==='diagram'||f.kind==='gantt')?headingSize*1.7:0,h=Math.max(180,Math.min(1300,1000*b[3]/b[2]/aspect))-heading;
 return <div className="pipeline-figure" onClick={()=>onEdit?.(element.id)} role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined} onKeyDown={e=>{if(e.key==='Enter')onEdit?.(element.id);}} title={onEdit?'点击编辑数据或结构':undefined}>
  <svg ref={svgRef} viewBox={`0 0 ${w} ${h+heading}`} width={w} height={h+heading} data-testid="pipeline-figure" data-kind={f.kind} xmlns="http://www.w3.org/2000/svg" style={{width:'100%',height:standalone?'auto':'100%',display:'block'}} fontFamily={TYPOGRAPHY.fonts.data}>
   <title>{f.title}</title><rect data-chart-background="true" width={w} height={h+heading} fill={C.bg}/>{heading>0&&<Text x={15} y={headingSize*1.1} text={f.chart?.title||f.title} size={headingSize} width={Math.floor(960/(headingSize*.55))}/>}<g transform={`translate(0,${heading})`}>
   {f.kind==='chart'?<Statistical f={f} w={w} h={h}/>:f.kind==='pie'?<PieFigure f={f} w={w} h={h}/>:['map','diagram'].includes(f.kind)?<MapDiagram f={f} w={w} h={h} bbox={b}/>:<Text x={20} y={30} text={f.text||'未能转换此图形'} width={60}/>}
  </g></svg>
 </div>;
}

function FitCopy({element}:{element:any}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;const fit=()=>{let size=element.fontSize||18;el.style.fontSize=`${size}px`;while(size>10&&(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)){size-=.5;el.style.fontSize=`${size}px`;}el.dataset.overflow=String(el.scrollHeight>el.clientHeight+2);};void document.fonts.ready.then(fit);const ro=new ResizeObserver(fit);ro.observe(el);return()=>ro.disconnect();},[element]);
 const compact=element.type==='card'&&element.bbox?.[3]<8,bodyHasTitle=compact&&String(element.text||'').toLowerCase().includes(String(element.title||'').toLowerCase());
 const duplicateCopy=String(element.text||'').replace(/\s/g,'').toLowerCase()===String(element.title||'').replace(/\s/g,'').toLowerCase();
 const Icon=({document:FileText,growth:TrendingUp,power:Zap,chip:Cpu,delivery:Handshake,construction:Hammer,supply:Truck} as Partial<Record<string,typeof FileText>>)[element.icon?.name];
 return <div ref={ref} className={`pipeline-copy kind-${element.type}${compact?' compact-card':''}${element.variant==='metric'?' metric-card':''}${Icon?' with-icon':''}`} data-copy={element.id}>{Icon&&<Icon className="page-card-icon" aria-hidden="true"/>}{element.title&&!element.hideTitle&&!bodyHasTitle&&<h3>{element.mapNumber&&<span className="map-card-number">{element.mapNumber}</span>}{element.title}</h3>}{element.type==='table'?<table><thead><tr>{element.rowGroups&&<th>{element.groupHeader}</th>}{element.columns.map((v:string,i:number)=><th key={i}>{v}</th>)}</tr></thead><tbody>{element.rows.map((r:string[],i:number)=><tr key={i}>{element.rowGroups?.filter((g:any)=>g.firstRow===i).map((g:any)=><th key={g.firstRow} scope="rowgroup" rowSpan={g.rowCount} className="table-row-group">{g.title}</th>)}{r.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table>:<>{(!duplicateCopy||bodyHasTitle)&&<p>{element.text}</p>}{element.status&&<p className="card-status">{element.status}</p>}</>}</div>;
}

function ProfileCard({element,elements}:{element:any;elements:any[]}){
 const children=elements.filter(e=>e.parentId===element.id),photo=children.find(e=>e.assetRole==='photo'),logos=children.filter(e=>e.type==='logo-group');
 const paragraphs=String(element.text||'').split(/\n\s*\n/),lead=paragraphs.length>1?paragraphs.shift():'',body=paragraphs.join('\n\n');
 return <div className="profile-card" data-component-role="profile-card"><div className="profile-heading"><div className="profile-portrait">{photo&&<SourceAsset item={photo}/>}</div><FitCopy element={{...element,type:'text',text:lead,fontSize:16}}/><div className="profile-logos">{logos.map(e=><LogoGroup key={e.id} element={e} hideTitle/>)}</div></div><div className="profile-biography"><FitCopy element={{...element,id:element.id+'-biography',type:'text',title:'',text:body,fontSize:16}}/></div></div>;
}

export function PipelinePage({result,onEdit}:{result:any;onEdit?:(id:string)=>void}){
 const outer=useRef<HTMLDivElement>(null),sheet=useRef<HTMLDivElement>(null),width=1440,height=width/result.aspect;
 const cards=result.elements.filter((e:any)=>e.type==='card'),cardNumbers:Record<string,number>={},mapLinks:Record<string,Record<string,number>>={},norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 for(const e of result.elements.filter((e:any)=>e.figure?.kind==='map')){mapLinks[e.id]={};for(const n of e.figure.nodes){const i=cards.findIndex((c:any)=>norm(c.title)===norm(n.label));if(i>=0){mapLinks[e.id][n.id]=i+1;cardNumbers[cards[i].id]=i+1;}}}
 useEffect(()=>{const host=outer.current,inner=sheet.current;if(!host||!inner)return;const resize=()=>{const scale=host.clientWidth/width;inner.style.transform=`scale(${scale})`;host.style.height=`${height*scale}px`;};const ro=new ResizeObserver(resize);ro.observe(host);resize();return()=>ro.disconnect();},[height]);
 return <div ref={outer} className="pipeline-page-wrap" data-testid="converted-page"><article ref={sheet} className="pipeline-page" style={{width,height,fontFamily:TYPOGRAPHY.fonts.data,background:C.bg,color:C.ink}}>
  <header style={{paddingRight:result.elements.some((e:any)=>e.type==='asset'&&e.bbox[1]<11)?150:0}}><span>REFERENCE · OM</span>{!result.elements.some((e:any)=>e.type==='asset'&&e.bbox[1]<11)&&<b>A</b>}<h2>{result.title}</h2>{result.subtitle&&<p>{result.subtitle}</p>}</header>
  {result.elements.filter((e:any)=>!e.parentId).map((e:any)=>{const [x,y,w,h]=e.bbox,hasSection=result.elements.some((s:any)=>s.type==='section'&&s.bbox[1]<y&&y-s.bbox[1]<10&&Math.min(s.bbox[0]+s.bbox[2],x+w)-Math.max(s.bbox[0],x)>w*.8);return <section key={e.id} className={`pipeline-element type-${e.type}`} data-element-id={e.id} style={{left:x/100*width,top:y/100*height,width:w/100*width,height:h/100*height}}>
   {e.componentKind==='profile-card'?<ProfileCard element={e} elements={result.elements}/>:e.figure?<>{e.title&&e.figure.kind==='map'&&!hasSection&&<h3 className="pipeline-chart-title inside-title">{e.title}</h3>}<PipelineFigure element={{...e,suppressFigureTitle:norm(e.figure.title||'')===norm(result.title),figure:mapLinks[e.id]?{...e.figure,cardLinks:mapLinks[e.id]}:e.figure}} aspect={result.aspect} onEdit={onEdit}/></>:e.type==='logo-group'?<LogoGroup element={e}/>:e.type==='asset'?<SourceAsset item={e}/>:<FitCopy element={{...e,mapNumber:cardNumbers[e.id]}}/>}
  </section>;})}
  <footer>{result.footnotes.map((f:string,i:number)=><p key={i}>{f}</p>)}<p>Reference · {result.source.fileName} · {result.source.locator}{result.source.asOf?' · '+result.source.asOf:''}</p></footer>
 </article></div>;
}
