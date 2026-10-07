import { forwardRef, useId, useLayoutEffect, useRef } from 'react';
import { OM_COMPONENT_THEME } from './theme';
import { renderReferenceFigure } from './reviewed-renderer.js';
import { addFigureHeading } from './heading';
import { SharedGanttFigure } from './gantt';
import { chartTrendAnnotation, nativePlotHeight } from './source-annotations';

export const COMPONENTS = [
  {kind:'single',name:'柱状图',rules:'负数、空值、单位、数值标签、CAGR'},
  {kind:'stacked',name:'堆叠柱状图',rules:'系列顺序、小段标签、原稿合计、图例、分段 CAGR'},
  {kind:'grouped',name:'分组柱状图',rules:'多系列、正负值、利润率、CAGR'},
  {kind:'balance',name:'资产负债图',rules:'独立金额、合计、倍数、图例与冲突说明'},
  {kind:'scatter',name:'散点图',rules:'坐标轴、数据点、名称与文字避让'},
  {kind:'curves',name:'曲线图',rules:'原生曲线、数据编辑、系列名称与增长率'},
  {kind:'timeline',name:'时间轴',rules:'阶段、事件、日期、图标与上下交错排版'},
  {kind:'tiers',name:'分层图',rules:'层级、成员、重点标记与方向说明'},
  {kind:'gantt',name:'甘特图',rules:'阶段、任务、月份、里程碑与起止标注'},
] as const;
export const COMPONENT_LIBRARY_VERSION='reviewed-components-v1';
export function legacyFigure(f:any){
  return {...f,categoryCallouts:f.categoryCallouts||(f.margins?[{label:f.marginLabel||'LQA Adj. EBITDA Margin (%)',values:f.margins}]:[]),
    ...(f.kind==='balance'?{categoryCallouts:[{label:'Total Gross Debt',values:f.reportedTotals.map((v:any,i:number)=>i===0?'$'+new Intl.NumberFormat('en-US').format(v):null)},{label:f.multiple?.split(':')[0]||'',values:f.categories.map((_:any,i:number)=>i===f.categories.length-1?f.multiple?.split(':').at(-1)?.trim():null)}]}:{}),
    axisSuffix:f.unit?.startsWith('B')?'B':'',
    seriesAnnotationPeriod:f.annotationFacts?.find((a:any)=>a.kind==='segment-cagr')?.period||'',
    curves:f.curves?.map((c:any)=>({...c,cagr:c.cagr&&/CAGR/i.test(c.cagr)?c.cagr:c.cagr?c.cagr+' CAGR':''}))};
}

/** Normalize schemas only. Never replace an uploaded fact with saved sample values. */
export function pipelineFigure(element:any){
  const f=element.figure,c=f.chart,b=element.bbox;
  const source=c?.source||f.source||{},base:any={...f,title:c?.title||f.title,key:element.id,source:{document:source.fileName||'',page:source.locator||'',asOf:source.asOf||''},extractionMethod:'Live extraction; source facts preserved',width:1000,height:Math.max(300,1000*b[3]/b[2]/(element.aspect||16/9))};
  if(f.kind==='gantt')return f;
  if(f.kind==='chart'&&c&&c.kind!=='line'){
    const sparse=c.kind==='stacked-bar'&&c.series.length>1&&c.labels.length<=6&&c.series.every((s:any)=>s.values.filter((v:any)=>v!==null).length===1);
    const kind=f.componentKind==='balance'||sparse?'balance':c.kind==='stacked-bar'?'stacked':c.kind==='grouped-bar'||c.series.length>1?'grouped':'single';
    const small=kind==='balance';const width=small?480:kind==='grouped'?860:kind==='single'?840:1000;
    return {...base,kind,width,height:small?520:Math.max(kind==='single'?282:kind==='grouped'?345:430,width*b[3]/b[2]/(element.aspect||16/9)-40),unit:c.unit,categories:[...c.labels],series:c.series.map((s:any)=>({...s,cagr:f.seriesAnnotations?.find((a:any)=>a.series===s.name&&/CAGR/i.test(a.label))?.value})),reportedTotals:f.totals||[],categoryCallouts:f.categoryCallouts||[],cagr:chartTrendAnnotation(f),legendFootnote:c.warnings?.filter((s:string)=>/legend|conflict|图例|冲突/i.test(s)).join(' ')||'',note:f.note||'',seriesAnnotationPeriod:f.seriesAnnotationPeriod||''};
  }
  if(f.kind==='scatter'){const height=nativePlotHeight(f,element.aspect||16/9,620-89,87);return {...base,width:620,height,xDomain:f.axes.xDomain,yDomain:f.axes.yDomain,xTicks:f.axes.xTicks,yTicks:f.axes.yTicks,axisSuffix:c.unit==='B'?'B':'',points:c.labels.flatMap((label:string,i:number)=>c.series[0].values[i]===null||c.series[1].values[i]===null?[]:[{label,year:c.series[0].values[i],value:c.series[1].values[i],labelOffset:f.pointLabelOffsets?.[i]?{dx:f.pointLabelOffsets[i].dx*(620-89)/(f.axes.xDomain[1]-f.axes.xDomain[0]),dy:-f.pointLabelOffsets[i].dy*(height-87)/(f.axes.yDomain[1]-f.axes.yDomain[0])}:undefined}])};}
  if(f.kind==='curves')return {...base,width:620,height:nativePlotHeight(f,element.aspect||16/9,620-90,88),xDomain:f.axes.xDomain,yDomain:f.axes.yDomain,xTicks:f.axes.xTicks,yTicks:f.axes.yTicks,curvesEdited:c.userEdited,curves:c.series.map((s:any,j:number)=>{const native=f.nativeCurves?.find((a:any)=>a.name===s.name),same=JSON.stringify(native?.sampleValues)===JSON.stringify(s.values);return {name:s.name,cagr:c.annotations?.[j]||'',annualKnots:s.values.map((value:any,i:number)=>({year:Number(c.labels[i]),value})),segments:same?native?.segments.map((seg:any)=>seg.map(([year,value]:number[])=>({year,value}))):[]};})};
  if(f.kind==='timeline')return {...base,width:1728,height:698};
  if(f.kind==='tiers')return {...base,width:540,height:f.nativeGeometry?540*f.nativeGeometry.region[3]/f.nativeGeometry.region[2]/(f.nativeGeometry.sourceAspect||element.aspect||16/9):540};
  return null;
}

export const RegisteredFigure=forwardRef<SVGSVGElement,{figure:any;fillContainer?:boolean;testId?:string;header?:{title?:string;caption?:string}}>(function RegisteredFigure({figure,fillContainer=false,testId='pipeline-figure',header},ref){
  const host=useRef<HTMLDivElement>(null),id=useId().replace(/:/g,'');
  useLayoutEffect(()=>{if(!host.current||figure.kind==='gantt')return;let active=true;
    const draw=()=>{if(!active||!host.current)return;host.current.replaceChildren();const svg=renderReferenceFigure(host.current,{...figure,renderId:'shared-'+id},OM_COMPONENT_THEME);addFigureHeading(svg,header);svg.style.width='100%';svg.style.height=fillContainer?'100%':'auto';svg.style.display='block';svg.setAttribute('preserveAspectRatio','xMidYMin meet');svg.setAttribute('data-testid',testId);svg.setAttribute('data-component',COMPONENT_LIBRARY_VERSION+':'+figure.kind);svg.setAttribute('data-kind',figure.kind);if(typeof ref==='function')ref(svg);else if(ref)ref.current=svg;};
    draw();void document.fonts.ready.then(draw);return()=>{active=false;if(typeof ref==='function')ref(null);else if(ref)ref.current=null;};
  },[figure,fillContainer,testId,id,ref,header]);
  if(figure.kind==='gantt')return <SharedGanttFigure ref={ref} figure={figure} fillContainer={fillContainer} testId={testId}/>;
  return <div ref={host} style={{width:'100%',height:fillContainer?'100%':undefined}}/>;
});
