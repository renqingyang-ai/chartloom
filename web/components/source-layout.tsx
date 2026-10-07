import { forwardRef, useId, useLayoutEffect, useRef } from 'react';
import { select, scaleLinear, scaleLog, line, area, curveLinear, curveMonotoneX, curveStepAfter, pie, arc, interpolateRgb, color as parseColor } from 'd3';
import { OM_COMPONENT_THEME as theme, chartSeriesPaints } from './theme';
import { parsePrintedNumber, formatBoundValue } from './printed-number';
import { fitPieLabel, type InkBox } from './pie-label-layout';
import { fitBarInk } from './bar-label-layout';

const valid=(v:any):v is number=>typeof v==='number'&&Number.isFinite(v);
const numericLabel=(v:any,formats?:any):number=>{
 const raw=String(v).trim().replace(/[−–]/g,'-'),superscript:Record<string,string>={'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-','⁺':'+'};
 const normalized=raw.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g,s=>'^'+[...s].map(c=>superscript[c]).join(''));
 const match=normalized.match(/^10\s*\^\s*\{?(-?\d+)\}?$/);return match?10**Number(match[1]):parsePrintedNumber(normalized,formats)??Number(normalized);
};
const contrast=(fill:string)=>{
 const parsed=parseColor(fill)?.rgb();if(!parsed)return theme.colors.ink;
 const rgb=[parsed.r,parsed.g,parsed.b].map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.3?theme.colors.ink:theme.colors.background;
};

/** Saved results also need protection from legacy pixel/percent mistakes. */
export function sourceBarLayoutIssue(f:any):string|null {
 if(f.kind!=='chart')return null;
 const l=f.sourceLayout,c=f.chart,n=c.labels.length;
 const barIndices=c.series.map((_:any,si:number)=>si).filter((si:number)=>(l.seriesStyles.find((s:any)=>s.series===si)?.geometry||(c.kind==='line'?'line':'bar'))==='bar');
 const bars=barIndices.length,order=l.barSeriesOrder;
 const mirrored=l.mirrorBars!==undefined&&l.mirrorBars!==null;
 const categoryCentered=l.barPlacement==='category';
 if(l.barPlacement!==undefined&&!['category','grouped'].includes(l.barPlacement))return 'Source bar placement is invalid';
 if(categoryCentered){
  if(!bars||c.kind==='stacked-bar'||mirrored)return 'Category-centered bars require unstacked, non-mirrored bar series';
  if(l.categoryPositions.length!==n||l.groupGap!==0)return 'Category-centered bars require measured category centers and no group gap';
  if(c.labels.some((_:any,i:number)=>barIndices.filter((si:number)=>c.series[si].values[i]!==null).length>1))return 'Category-centered bars require at most one present bar per category';
 }
 if(mirrored){
  const ds=l.mirrorBars?.directions,a=l.valueAxis;
  if(c.kind==='stacked-bar'||bars!==2||c.series.length!==2)return 'Mirrored bars require exactly two unstacked bar series';
  if(!Array.isArray(ds)||ds.length!==2||!ds.every((d:any)=>Number.isInteger(d))||[...ds].sort((a,b)=>a-b).join(',')!=='-1,1')return 'Mirrored bars require opposite series drawing directions';
  if(c.series.some((s:any)=>s.values.some((v:any)=>v!==null&&(!valid(v)||v<0))))return 'Mirrored magnitudes must remain nonnegative; signed data requires an ordinary signed axis';
  if(a.scale!=='linear'||!(a.domain[0]<0&&a.domain[1]>0)||f.barBaselines?.length||l.seriesStyles.some((s:any)=>(s.axis||'primary')!=='primary'))return 'Mirrored bars require one linear scale and a shared zero baseline';
 }
 // Legacy saved results may omit this field. New layouts validate it upstream.
 if(order===undefined&&l.barOrderRequired&&bars>1&&c.kind!=='stacked-bar'&&!mirrored&&!categoryCentered)return 'Source bar series order has not been measured';
 if(order!==undefined&&(!Array.isArray(order)||order.length!==bars||order.some((si:any)=>!Number.isInteger(si))||[...order].sort((a,b)=>a-b).some((si,i)=>si!==barIndices[i])))return 'Source bar series order does not match its bar bindings';
 if(!n||!bars)return null;
 if(!(l.barWidth>0))return 'Source bar width must be positive for visible categories';
 const count=c.kind==='stacked-bar'||mirrored||categoryCentered?1:bars,extent=count*l.barWidth+(count-1)*l.groupGap;
 const positions=[...l.categoryPositions].sort((a,b)=>a-b),plotSize=l.plotBox[l.orientation==='horizontal'?3:2];
 const steps=positions.length?positions.slice(1).map((p,i)=>p-positions[i]):[plotSize/n];
 const available=steps.length?Math.min(...steps):plotSize;
 return extent>available+(l.barGeometryTolerance??1e-6)?`Source bar group width ${extent}% overlaps categories spaced ${available}%; remeasure source geometry`:null;
}

/** Fixed drawing grammar. Every measurement comes from this upload's sourceLayout. */
export function drawSourceLayout(host:HTMLElement,f:any,id:string){
 const l=f.sourceLayout,c=f.chart,old=l.sourceData,w=1000,h=w/l.aspect;
 const px=(v:number)=>v*w/100,py=(v:number)=>v*h/100;
 const [bx,by,bw,bh]=l.plotBox,[left,top,right,bottom]=[px(bx),py(by),px(bx+bw),py(by+bh)];
 const horizontal=l.orientation==='horizontal',isPie=f.kind==='pie',isScatter=['scatter','bubble'].includes(f.kind),isMatrix=f.kind==='heatmap';
 const canvasHeight=h+py(l.bottomPadding||0);
 const svg=select(host).append('svg').attr('xmlns','http://www.w3.org/2000/svg').attr('width',w).attr('height',canvasHeight).attr('viewBox',`0 0 ${w} ${canvasHeight}`)
  .attr('data-testid','pipeline-figure').attr('data-component','source-layout-v1').attr('data-kind',f.kind).attr('data-chart-kind',c.kind).attr('data-orientation',l.orientation).attr('role','img').attr('aria-label',c.title||f.title)
  .attr('font-family',theme.font.data.family).attr('fill',theme.colors.ink);
 svg.append('title').text(c.title||f.title);
 svg.append('rect').attr('data-chart-background','true').attr('width',w).attr('height',canvasHeight).attr('fill',theme.colors.background);
 const geometryIssue=sourceBarLayoutIssue(f);
 if(geometryIssue){
  svg.attr('data-layout-error',geometryIssue);
  svg.append('text').attr('x',36).attr('y',Math.max(44,canvasHeight*.38)).attr('font-size',24).text('柱宽与分类间距不一致，需重新转换。');
  svg.append('text').attr('x',36).attr('y',Math.max(80,canvasHeight*.38+38)).attr('font-size',18).attr('fill','#697570').text('提取数据仍已保留，可查看或编辑。');
  return svg.node()!;
 }
 const defs=svg.append('defs');
 const marker=defs.append('marker').attr('id',id+'-arrow').attr('viewBox','0 -4 8 8').attr('refX',7).attr('refY',0).attr('markerWidth',7).attr('markerHeight',7).attr('orient','auto-start-reverse');
 marker.append('path').attr('d','M0,-3L7,0L0,3').attr('fill','none').attr('stroke',theme.colors.ink).attr('stroke-width',1.1);
 const clipPad=Math.max(2,...l.seriesStyles.filter((s:any)=>s.marker!=='none').map((s:any)=>py(s.markerSize)/2+2));
 defs.append('clipPath').attr('id',id+'-plot').append('rect').attr('x',left-clipPad).attr('y',top-clipPad).attr('width',right-left+clipPad*2).attr('height',bottom-top+clipPad*2);
 const style=(si:number)=>l.seriesStyles.find((s:any)=>s.series===si)||{geometry:isScatter?'point':c.kind==='line'?'line':'bar',marker:isScatter?'circle':'none',markerSize:1.2,lineWidth:.4,curve:'linear',axis:'primary'};
 const paints=chartSeriesPaints(c.kind,isPie?c.labels.map(()=> 'bar'):c.series.map((_:any,i:number)=>style(i).geometry));
 const colors=paints.map(p=>p.color);
 const fills=paints.map((p,i)=>{
  if(!p.pattern)return p.color;
  const patternId=`${id}-series-${i}`,pattern=defs.append('pattern').attr('id',patternId).attr('patternUnits','userSpaceOnUse').attr('width',8).attr('height',8);
  pattern.append('rect').attr('width',8).attr('height',8).attr('fill',p.color);
  if(p.pattern==='dots')pattern.append('circle').attr('cx',4).attr('cy',4).attr('r',1.1).attr('fill',theme.colors.ink).attr('opacity',.55);
  else pattern.append('path').attr('d','M-2,2L2,-2 M0,8L8,0 M6,10L10,6').attr('stroke',theme.colors.ink).attr('stroke-width',1).attr('opacity',.38);
  return `url(#${patternId})`;
 });
 const category=(i:number,data=c)=>{
  const ps=l.categoryPositions;
  if(ps.length===data.labels.length)return horizontal?py(ps[i]):px(ps[i]);
  const a=horizontal?top:left,b=horizontal?bottom:right;
  return a+(b-a)*(i+.5)/data.labels.length;
 };
 const baseValue=(si:number,i:number,data:any,baselines:any[])=>{
  const explicit=baselines?.find((b:any)=>b.categoryIndex===i&&b.series===data.series[si]?.name);
  if(explicit)return explicit.value;
  if(data.kind!=='stacked-bar')return 0;
  const value=data.series[si]?.values[i];
  return data.series.slice(0,si).reduce((sum:number,s:any,j:number)=>sum+((style(j).geometry==='bar'||f.stackedArea&&style(j).geometry==='area')&&valid(s.values[i])&&(s.values[i]>=0)===(value>=0)?s.values[i]:0),0);
 };
 // A left-facing magnitude remains a positive source fact in the editor,
 // exports and data-value attributes; only its drawing coordinate is signed.
 const barValue=(si:number,value:number)=>value*(l.mirrorBars?.directions[si]??1);
 const scaleFor=(axis:any,si:number,data=c,original=false)=>{
  let domain=[...axis.domain];
  if(data.userEdited&&!original){
   const values=data.series.flatMap((s:any,j:number)=>(!isScatter||j===(f.fields?.y??1))&&style(j).axis===style(si).axis?s.values.flatMap((v:any,i:number)=>valid(v)?style(j).geometry==='bar'?[barValue(j,v)+baseValue(j,i,data,f.barBaselines),baseValue(j,i,data,f.barBaselines)]:[v]:[]):[]).filter((v:any)=>valid(v)&&(axis.scale!=='log'||v>0));
   if(values.length){const lo=Math.min(...values),hi=Math.max(...values);domain=[Math.min(domain[0],lo),Math.max(domain[1],hi)];}
  }
  const sc=axis.scale==='log'?scaleLog():scaleLinear();
  const range=horizontal?[left,right]:[bottom,top];
  return sc.domain(domain).range(axis.reversed?[...range].reverse():range);
 };
 const numericX=(original=false)=>{
  const a=l.xAxis||{domain:f.axes?.xDomain||[0,1],scale:'linear'};
  const sc=a.scale==='log'?scaleLog():scaleLinear();let d=[...a.domain];
  if(c.userEdited&&!original){const vs=(isScatter?c.series[f.fields?.x??0].values:c.labels.map((v:any)=>numericLabel(v,l.numberFormats))).filter((v:any)=>valid(v)&&(a.scale!=='log'||v>0));if(vs.length){d=[Math.min(d[0],...vs),Math.max(d[1],...vs)];}}
  return sc.domain(d).range(a.reversed?[right,left]:[left,right]);
 };
 const ys=(si:number,original=false)=>scaleFor(style(si).axis==='secondary'&&l.secondaryAxis?l.secondaryAxis:l.valueAxis,si,original?old:c,original);
 const barCenter=(si:number,i:number,data=c)=>{
  const bars:number[]=l.barSeriesOrder||data.series.map((_:any,j:number)=>j).filter((j:number)=>style(j).geometry==='bar');
  const grouped=data.kind!=='stacked-bar'&&bars.length>1&&!l.mirrorBars&&l.barPlacement!=='category';
  const unit=(horizontal?h:w)/100,width=l.barWidth*unit,gap=l.groupGap*unit;
  return category(i,data)+(grouped?(bars.indexOf(si)-(bars.length-1)/2)*(width+gap):0);
 };
 const valuePoint=(si:number,i:number,original=false)=>{
  const data=original?old:c,sc=ys(si,original),v=data.series[si]?.values[i],base=baseValue(si,i,data,original?old.barBaselines:f.barBaselines);
  if(!valid(v))return null;
  if(isScatter){const xv=data.series[f.fields?.x??0].values[i],yv=data.series[f.fields?.y??1].values[i],x=numericX(original)(xv),y=ys(f.fields?.y??1,original)(yv);return valid(xv)&&valid(yv)&&valid(x)&&valid(y)?[x,y]:null;}
  if(style(si).geometry!=='bar'){const x=l.xAxis?numericX(original)(numericLabel(data.labels[i],l.numberFormats)):category(i,data),y=sc(v+(f.stackedArea?base:0));return valid(x)&&valid(y)?[x,y]:null;}
  const at=barCenter(si,i,data),end=sc(base+barValue(si,v));return valid(end)?(horizontal?[end,at]:[at,end]):null;
 };
 // Repeated value labels use one measured type size. A single OCR rectangle
 // that includes a wedge edge or neighbouring label must not enlarge one value.
 const fontKey=(t:any)=>`${t.role}:${t.role==='category'?'shared':Math.round(t.fontSize*10)}:${!!t.bold}:${!!t.italic}`;
 const fontSamples=new Map<string,number[]>(),fontSizes=new Map<string,number>();
 const fontMeasure=document.createElement('canvas').getContext('2d')!;
 for(const t of l.texts){if(!['value','total','category','point-label'].includes(t.role)||!t.glyphBox||t.nativeFontSize)continue;
  fontMeasure.font=`${t.italic?'italic ':''}${t.bold?600:400} 100px ${theme.font.data.family}`;
  const m=fontMeasure.measureText(t.text),ratio=(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/100;
  if(ratio>0){const key=fontKey(t),xs=fontSamples.get(key)||[];xs.push(py(t.glyphBox[3])/ratio);fontSamples.set(key,xs);}
 }
 for(const [key,xs] of fontSamples)if(xs.length>=3){xs.sort((a,b)=>a-b);fontSizes.set(key,xs[Math.floor(xs.length/2)]);}
 const pieLabelBoxes:InkBox[]=[];
 const text=(group:any,t:any,value:string,x:number,y:number)=>{
  const family=t.role==='title'?theme.font.heading.family:theme.font.data.family;
  const measure=document.createElement('canvas').getContext('2d')!;
  const weight=t.bold?600:t.role==='title'?theme.font.heading.weight:theme.font.data.weight;
  const fontSpec=(size:number)=>`${t.italic?'italic ':''}${weight} ${size}px ${family}`;
  const paragraphs=String(value||'').split('\n'),multiline=paragraphs.length>1;
  let font=py(t.fontSize||2.8);
  const shared=fontSizes.get(fontKey(t));
  let glyphDescent=0;
  if(t.nativeFontSize)font=py(t.nativeFontSize);
  else if(t.glyphBox||shared){measure.font=fontSpec(100);const m=measure.measureText(paragraphs[0]||'H'),ratio=(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/100;if(ratio>0){font=Math.max(font*.75,Math.min(font*1.85,shared||py(t.glyphBox[3])/ratio));glyphDescent=m.actualBoundingBoxDescent/100;}}
  const sourceCopy=['title','caption','note','free'].includes(t.role);
  const available=t.width||(t.box?Math.max(1,t.box[2]-1):sourceCopy&&t.glyphBox?t.glyphBox[2]:0);
  // Explicit source line breaks are geometry, not an invitation to add rows.
  // Fit the OM font inside the observed width/leading before placing baselines.
  if(multiline||sourceCopy&&available){
   measure.font=fontSpec(100);
   const metrics=paragraphs.map(row=>measure.measureText(row)),widest=Math.max(...metrics.map(m=>m.width));
   if(available&&widest>0)font=Math.min(font,px(available)*100/widest);
   const inkHeight=Math.max(...metrics.map(m=>m.actualBoundingBoxAscent+m.actualBoundingBoxDescent));
   if(multiline&&t.lineStep&&inkHeight>0)font=Math.min(font,py(t.lineStep)*.9*100/inkHeight);
  }
  y-=glyphDescent*font;
  if(t.role==='annotation'&&!t.box){
   for(const leader of l.lines){
    if(!leader.arrowEnd||leader.points.length!==2)continue;
    const [a,b]=leader.points.map((p:any)=>[px(p[0]),py(p[1])]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    if(!len||Math.abs(Math.atan2(dy,dx)*180/Math.PI-(t.rotation||0))>15)continue;
    const along=((x-a[0])*dx+(y-a[1])*dy)/len,normal=[dy/len,-dx/len],distance=(x-a[0])*normal[0]+(y-a[1])*normal[1];
    if(along>0&&along<len&&Math.abs(distance)<font*1.2){const lift=Math.max(0,font*.22+2-distance);x+=normal[0]*lift;y+=normal[1]*lift;}
   }
  }
  let labelFill=t.box?theme.colors.ink:isPie&&t.color==='inverse'&&t.role==='value'?contrast(colors[t.index%colors.length]):t.color==='muted'?'#697570':theme.colors.ink;
  let halo:string=theme.colors.background;
  let pieLabelFit:string|undefined;
  let barLabelFit:string|undefined,barLabelReview:string|undefined;
  if(isPie&&['value','category'].includes(t.role)&&!t.box&&!t.rotation&&pieArcs[t.index]&&oldArcs[t.index]){
   const a=pieArcs[t.index],b=oldArcs[t.index],cx=(left+right)/2,cy=(top+bottom)/2,r=Math.min(right-left,bottom-top)/2,inner=r*(l.pie?.holeRatio||0);
   const ink=(size:number):InkBox=>{
    measure.font=fontSpec(size);
    const rows=paragraphs.map((row,i)=>{const m=measure.measureText(row),offset=t.anchor==='end'?m.width:t.anchor==='middle'?m.width/2:0,dy=i*(t.lineStep?py(t.lineStep):size*1.13);return {left:-offset-m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight-offset,top:dy-m.actualBoundingBoxAscent,bottom:dy+m.actualBoundingBoxDescent};});
    return {left:Math.min(...rows.map(b=>b.left)),right:Math.max(...rows.map(b=>b.right)),top:Math.min(...rows.map(b=>b.top)),bottom:Math.max(...rows.map(b=>b.bottom))};
   };
   const box=ink(font),ox=(box.left+box.right)/2,oy=(box.top+box.bottom)/2,dx=x+ox-cx,dy=y+oy-cy,distance=Math.hypot(dx,dy);
   // External labels and centre-of-donut copy retain their source positions.
   // Both a value and its category follow the same data-bound arc on edits.
   if(distance<r&&distance>inner&&Math.abs(b.endAngle-b.startAngle)>1e-8){
    const delta=(a.startAngle+a.endAngle-b.startAngle-b.endAngle)/2;
    x=cx+dx*Math.cos(delta)-dy*Math.sin(delta)-ox;y=cy+dx*Math.sin(delta)+dy*Math.cos(delta)-oy;
    const fit=fitPieLabel({cx,cy,inner,outer:r,start:a.startAngle,end:a.endAngle},{x,y,font},ink,pieLabelBoxes);
    ({x,y,font}=fit);pieLabelBoxes.push(fit.box);pieLabelFit=fit.fitted?'sector-ink':'needs-review';
    labelFill=contrast(colors[t.index%colors.length]);halo=labelFill===theme.colors.ink?theme.colors.background:theme.colors.ink;
   }
  }
  if(t.role==='value'&&!isPie&&!t.box&&!t.rotation&&!multiline&&style(t.series||0).geometry==='bar'){
   const si=t.series||0,mark=host.querySelector<SVGRectElement>(`rect[data-mark="${si}:${t.index}"]`);
   const ink=(size:number):InkBox=>{
    measure.font=fontSpec(size);const m=measure.measureText(value),offset=t.anchor==='end'?m.width:t.anchor==='middle'?m.width/2:0;
    return {left:-offset-m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight-offset,top:-m.actualBoundingBoxAscent,bottom:m.actualBoundingBoxDescent};
   };
   if(mark){
    const rect={left:mark.x.baseVal.value,right:mark.x.baseVal.value+mark.width.baseVal.value,top:mark.y.baseVal.value,bottom:mark.y.baseVal.value+mark.height.baseVal.value};
    const sourceScale=ys(si,true),sourceBase=sourceScale(Math.max(sourceScale.domain()[0],baseValue(si,t.index,old,old.barBaselines)));
    const sourceEnd=valuePoint(si,t.index,true)?.[horizontal?0:1],currentEnd=valuePoint(si,t.index)?.[horizontal?0:1];
    const sourceInk=t.glyphBox?(horizontal?[px(t.glyphBox[0]),px(t.glyphBox[0]+t.glyphBox[2])]:[py(t.glyphBox[1]),py(t.glyphBox[1]+t.glyphBox[3])]):null;
    const sourcePosition=sourceInk?(sourceInk[0]+sourceInk[1])/2:horizontal?px(t.x):py(t.y);
    const direction=valid(sourceEnd)?Math.sign(sourceEnd-sourceBase):0;
    // An OCR box can include a tiny bar or axis. Its anchor alone may then
    // fall inside that bar while the actual number lies beyond the endpoint.
    // Classify against immutable source geometry, so editing never turns an
    // external value into an internal one just because the bar gets longer.
    const external=direction&&valid(sourceEnd)&&direction*(sourcePosition-sourceEnd)>0;
    if(external&&valid(currentEnd)){
     const box=ink(font),sourceAnchor=horizontal?px(t.x):py(t.y);
     const sourceNear=sourceInk?(direction>0?sourceInk[0]:sourceInk[1]):sourceAnchor+(horizontal?(direction>0?box.left:box.right):(direction>0?box.top:box.bottom));
     const gap=Math.max(1,direction*(sourceNear-sourceEnd!));
     if(horizontal&&sourceInk){
      const edge=direction>0?box.left:box.right;x=currentEnd+direction*gap-edge;
      if(box.bottom-box.top<=rect.bottom-rect.top)y=Math.max(rect.top-box.top,Math.min(y,rect.bottom-box.bottom));
     }else if(sourceInk){
      const edge=direction>0?box.top:box.bottom;y=currentEnd+direction*gap-edge;
     }
     labelFill=theme.colors.ink;barLabelFit='external-endpoint';
    }else if(x>=rect.left&&x<=rect.right&&((y>=rect.top&&y<=rect.bottom)||(y-font*.4>=rect.top&&y-font*.4<=rect.bottom))){
     const fit=fitBarInk(rect,{x,y,font},ink);({x,y,font}=fit);
     labelFill=contrast(mark.getAttribute('data-base-color')||colors[si%colors.length]);
     barLabelFit=fit.translated?'bounded-translation':'source-anchor';
     if(fit.needsReview)barLabelReview='Bar segment cannot contain its value label at the measured type size';
    }
   }
  }
  if(t.role==='value'&&!isPie&&style(t.series||0).geometry==='line'){
   const under=[...host.querySelectorAll<SVGRectElement>('rect[data-mark]')].find(r=>x>=r.x.baseVal.value&&x<=r.x.baseVal.value+r.width.baseVal.value&&y-font*.4>=r.y.baseVal.value&&y-font*.4<=r.y.baseVal.value+r.height.baseVal.value);
   if(under){halo=under.getAttribute('data-base-color')||under.getAttribute('fill')||halo;labelFill=contrast(halo);}
  }
  const node=group.append('text').attr('x',x).attr('y',y).attr('text-anchor',t.anchor||'start')
   .attr('font-family',family).attr('font-size',font)
   .attr('font-weight',weight).attr('font-style',t.italic?'italic':'normal')
   .attr('fill',labelFill)
   .attr('data-pie-label-fit',pieLabelFit)
   .attr('data-bar-label-fit',barLabelFit)
   .attr('data-label-review',barLabelReview||(pieLabelFit==='needs-review'?'Pie label cannot fit its bound slice at a readable size':null))
   .attr('data-source-text',t.role||'axis');
  if(pieLabelFit==='needs-review')node.attr('paint-order','stroke').attr('stroke',halo).attr('stroke-width',2).attr('stroke-linejoin','round');
  if(t.rotation)node.attr('transform',`rotate(${t.rotation},${x},${y})`);
  if(t.role==='point-label'||t.role==='value'&&!isPie&&style(t.series||0).geometry==='line')node.attr('paint-order','stroke').attr('stroke',halo).attr('stroke-width',1.5).attr('stroke-linejoin','round');
  measure.font=fontSpec(font);
  const rows:string[]=[];
  for(const paragraph of paragraphs){
   if(multiline||sourceCopy||!available){rows.push(paragraph);continue;}
   let row='';for(const word of paragraph.split(/\s+/)){const next=row?row+' '+word:word;if(row&&measure.measureText(next).width>px(available)){rows.push(row);row=word;}else row=next;}rows.push(row);
  }
  rows.forEach((row,i)=>node.append('tspan').attr('x',x).attr('dy',i?(t.lineStep?py(t.lineStep):font*1.13):0).text(row));
  return node;
 };
 const axes=svg.append('g').attr('data-layer','axes');
 const numericAxis=(a:any,isX:boolean,si=0)=>{
  const sc=isX?numericX():scaleFor(a,si),valueHorizontal=isX||horizontal,side=a.side||(isX?'bottom':'left');
  const anchor=side==='left'?left:side==='right'?right:side==='top'?top:bottom;
  const originalScale=isX?numericX(true):scaleFor(a,si,old,true);
  const measuredTicks=(a.ticks||[]).filter((t:any)=>valid(t.textX)&&valid(t.textY)&&valid(originalScale(t.value)));
  const median=(xs:number[])=>{const sorted=[...xs].sort((a,b)=>a-b),m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;};
  // Partial OCR must not send the remaining ticks to a second baseline. Their
  // values still set the along-axis position; measured peers set text offset.
  const fallbackCross=measuredTicks.length>=2?median(measuredTicks.map((t:any)=>valueHorizontal?py(t.textY):px(t.textX))):null;
  const fallbackAlong=measuredTicks.length>=2?median(measuredTicks.map((t:any)=>(valueHorizontal?px(t.textX):py(t.textY))-originalScale(t.value))):0;
  if(a.visible){axes.append('line').attr('x1',valueHorizontal?left:anchor).attr('x2',valueHorizontal?right:anchor).attr('y1',valueHorizontal?anchor:top).attr('y2',valueHorizontal?anchor:bottom).attr('stroke',theme.colors.ink).attr('stroke-width',.8);}
  for(const tick of a.ticks||[]){const at=sc(tick.value);if(!valid(at))continue;
   if(a.grid)axes.append('line').attr('x1',valueHorizontal?at:left).attr('x2',valueHorizontal?at:right).attr('y1',valueHorizontal?top:at).attr('y2',valueHorizontal?bottom:at).attr('stroke','#D8DDD8').attr('stroke-width',.8);
   if(a.visible){const offset=py(a.fontSize||2.8),measured=valid(tick.textX)&&valid(tick.textY);
    const originalAt=originalScale(tick.value),peerAligned=!measured&&fallbackCross!==null;
    const tx=measured?px(tick.textX)+(valueHorizontal?at-originalAt:0):peerAligned?(valueHorizontal?at+fallbackAlong:fallbackCross):valueHorizontal?at:anchor+(side==='right'?6:-6);
    const ty=measured?py(tick.textY)+(valueHorizontal?0:at-originalAt):peerAligned?(valueHorizontal?fallbackCross:at+fallbackAlong):valueHorizontal?anchor+(side==='top'?-6:offset+5):at+offset*.32;
    text(axes,{fontSize:a.fontSize,anchor:measured||peerAligned?'middle':valueHorizontal?'middle':side==='right'?'start':'end'},tick.text,tx,ty);
   }
  }
 };
 if(!isPie&&!isMatrix){
  numericAxis(l.valueAxis,false,isScatter?1:l.seriesStyles.find((s:any)=>s.axis!=='secondary')?.series||0);
  if(l.xAxis)numericAxis(l.xAxis,true);
  if(l.secondaryAxis)numericAxis(l.secondaryAxis,false,l.seriesStyles.find((s:any)=>s.axis==='secondary')?.series||0);
  if(l.categoryAxis.visible&&!l.xAxis){const a=l.categoryAxis,side=a.side;for(let i=0;i<c.labels.length;i++){
   const at=category(i),font=py(a.fontSize),x=horizontal?(side==='right'?right+8:left-8):at,y=horizontal?at+font*.3:side==='top'?top-8:bottom+font+5;
   text(axes,{...a,role:'category',anchor:horizontal?(side==='right'?'start':'end'):a.rotation<0?'end':a.rotation>0?'start':'middle'},c.labels[i],x,y);
  }}
 }
 const marks=svg.append('g').attr('data-layer','marks').attr('clip-path',isPie?null:`url(#${id}-plot)`);
 const point=(group:any,shape:string,x:number,y:number,size:number,fill:string)=>{
  const node=shape==='circle'?group.append('circle').attr('cx',x).attr('cy',y).attr('r',size/2):group.append('path').attr('d',shape==='diamond'?`M${x},${y-size/2}L${x+size/2},${y}L${x},${y+size/2}L${x-size/2},${y}Z`:shape==='triangle'?`M${x},${y-size/2}L${x+size/2},${y+size/2}L${x-size/2},${y+size/2}Z`:`M${x-size/2},${y-size/2}h${size}v${size}h${-size}Z`);
  return node.attr('fill',fill).attr('data-marker-size',size).attr('data-center-x',x).attr('data-center-y',y);
 };
 let pieArcs:any[]=[],oldArcs:any[]=[];
 if(isMatrix){
  const rows=c.series.length,cols=c.labels.length,cw=(right-left)/cols,ch=(bottom-top)/rows;
  const domain=f.matrix?.colorDomain||[0,1],shade=scaleLinear().domain(domain).range([0,1]).clamp(true),paint=interpolateRgb(theme.colors.tertiary,theme.colors.ink);
  c.series.forEach((s:any,ri:number)=>s.values.forEach((v:any,ci:number)=>{
   const fill=valid(v)?paint(shade(v)):'#EEEEEA';marks.append('rect').attr('x',left+ci*cw).attr('y',top+ri*ch).attr('width',cw).attr('height',ch).attr('fill',fill).attr('data-cell',`${ri}:${ci}`).attr('data-value',v);
   if(valid(v)&&f.matrix?.showValues){const size=Math.min(py(3),cw/Math.max(2,String(v).length*.65),ch*.45);marks.append('text').attr('x',left+(ci+.5)*cw).attr('y',top+(ri+.5)*ch).attr('dominant-baseline','middle').attr('text-anchor','middle').attr('font-size',size).attr('fill',contrast(fill)).text(v);}
  }));
  c.labels.forEach((label:string,i:number)=>text(axes,{fontSize:l.categoryAxis.fontSize,anchor:'end',rotation:l.categoryAxis.rotation||-35},label,left+(i+.5)*cw,bottom+py(3)));
  c.series.forEach((s:any,i:number)=>text(axes,{fontSize:l.valueAxis.fontSize,anchor:'end'},s.name,left-6,top+(i+.5)*ch+py(.8)));
  if(f.matrix?.colorBar){const start=right+px(3),bw=Math.min(px(2),w-start-px(7));if(bw>0){for(let j=0;j<100;j++)axes.append('rect').attr('x',start).attr('y',top+j*(bottom-top)/100).attr('width',bw).attr('height',(bottom-top)/100+.2).attr('fill',paint(1-j/99));for(const t of f.matrix.colorTicks||[])text(axes,{fontSize:2.4},t.text,start+bw+4,bottom-shade(t.value)*(bottom-top));}}
 }else if(['candlestick','boxplot'].includes(f.kind)){
  const fields=f.fields,sc=ys(0),bw=l.barWidth*(horizontal?h:w)/100;
  const stroke=(a:number,b:number,at:number)=>marks.append('line').attr('x1',horizontal?a:at).attr('x2',horizontal?b:at).attr('y1',horizontal?at:a).attr('y2',horizontal?at:b).attr('stroke',theme.colors.ink).attr('stroke-width',1.3);
  const cap=(at:number,pos:number)=>marks.append('line').attr('x1',horizontal?pos:at-bw*.3).attr('x2',horizontal?pos:at+bw*.3).attr('y1',horizontal?at-bw*.3:pos).attr('y2',horizontal?at+bw*.3:pos).attr('stroke',theme.colors.ink).attr('stroke-width',1.3);
  for(let i=0;i<c.labels.length;i++){
   const value=(key:string)=>c.series[fields[key]]?.values[i],low=value(f.kind==='boxplot'?'lower':'low'),high=value(f.kind==='boxplot'?'upper':'high'),a=value(f.kind==='boxplot'?'q1':'open'),b=value(f.kind==='boxplot'?'q3':'close');
   if(![low,high,a,b].every(valid))continue;const at=category(i),p=sc(a),q=sc(b),lo=sc(low),hi=sc(high);if(![p,q,lo,hi].every(valid))continue;
   stroke(lo,hi,at).attr('data-interval',i);
   const fill=f.kind==='candlestick'&&b<a?theme.colors.ink:theme.colors.primary;
   marks.append('rect').attr('x',horizontal?Math.min(p,q):at-bw/2).attr('y',horizontal?at-bw/2:Math.min(p,q)).attr('width',horizontal?Math.max(1,Math.abs(q-p)):bw).attr('height',horizontal?bw:Math.max(1,Math.abs(q-p))).attr('fill',fill).attr('stroke',theme.colors.ink).attr('stroke-width',.8).attr('data-interval-body',i);
   if(f.kind==='boxplot'){cap(at,lo);cap(at,hi);const median=value('median');if(valid(median))cap(at,sc(median));for(const si of fields.outliers||[]){const v=c.series[si]?.values[i];if(valid(v))point(marks,'circle',horizontal?sc(v):at,horizontal?at:sc(v),4,theme.colors.ink);}}
  }
 }else if(isPie){
  const cx=(left+right)/2,cy=(top+bottom)/2,r=Math.min(right-left,bottom-top)/2,start=(l.pie?.startAngle||0)*Math.PI/180;
  const make=pie<number>().sort(null).value(v=>v).startAngle(start).endAngle(start+Math.PI*2*(l.pie?.clockwise===false?-1:1));
  pieArcs=make(c.series[0].values);oldArcs=make(old.series[0].values);
  const a=arc<any>().innerRadius(r*(l.pie?.holeRatio||0)).outerRadius(r);
  const g=marks.append('g').attr('transform',`translate(${cx},${cy})`);
  pieArcs.forEach((p:any,i:number)=>g.append('path').attr('d',a(p)).attr('fill',fills[i%fills.length]).attr('stroke',theme.colors.background).attr('stroke-width',.7).attr('data-mark',`0:${i}`).attr('data-value',c.series[0].values[i]));
 }else if(isScatter){
  const s=style(0);
  if(s.geometry==='line'){const pts=c.labels.map((_:any,i:number)=>valuePoint(0,i));marks.append('path').attr('d',line<any>().defined(p=>!!p&&p.every(valid)).x(p=>p[0]).y(p=>p[1])(pts)).attr('fill','none').attr('stroke',colors[0]).attr('stroke-width',py(s.lineWidth)).attr('stroke-dasharray',s.dashed?'7 4':null).attr('data-series-line',0);}
  const groups=[...new Set(f.pointGroups||[])];
  for(let i=0;i<c.labels.length;i++){const p=valuePoint(0,i),size=f.kind==='bubble'?py(c.series[f.fields.size]?.values[i]||s.markerSize):py(s.markerSize),paint=f.kind==='bubble'?colors[Math.max(0,groups.indexOf(f.pointGroups?.[i]))%colors.length]:colors[0];if(p)point(marks,s.marker==='none'?'circle':s.marker,p[0],p[1],size,paint).attr('opacity',f.kind==='bubble'?.65:1).attr('data-mark',`0:${i}`).attr('data-value',c.series[1].values[i]);}
 }else for(let si=0;si<c.series.length;si++){
  const s=style(si),values=c.series[si].values,sc=ys(si),color=colors[si%colors.length];
  if(s.geometry==='bar')values.forEach((v:any,i:number)=>{if(!valid(v))return;const base=baseValue(si,i,c,f.barBaselines),start=sc(Math.max(sc.domain()[0],base)),end=sc(base+barValue(si,v)),at=barCenter(si,i),width=l.barWidth*(horizontal?h:w)/100;if(!valid(start)||!valid(end))return;
   marks.append('rect').attr('x',horizontal?Math.min(start,end):at-width/2).attr('y',horizontal?at-width/2:Math.min(start,end)).attr('width',horizontal?Math.abs(end-start):width).attr('height',horizontal?width:Math.abs(end-start)).attr('fill',fills[si%fills.length]).attr('data-base-color',color).attr('data-mark',`${si}:${i}`).attr('data-value',v);
  });
  else{
   const pts=values.map((_:any,i:number)=>valuePoint(si,i));
   const curve=s.curve==='monotone'?curveMonotoneX:s.curve==='step'?curveStepAfter:curveLinear;
   const path=line<any>().defined(p=>!!p).x(p=>p[0]).y(p=>p[1]).curve(curve);
   if(s.geometry==='area')marks.append('path').attr('d',area<any>().defined(p=>!!p).x(p=>p[0]).y0((_:any,i:number)=>sc(f.stackedArea?baseValue(si,i,c,f.barBaselines):Math.max(0,sc.domain()[0]))).y1(p=>p[1]).curve(curve)(pts)).attr('fill',fills[si%fills.length]).attr('opacity',f.stackedArea?1:.24).attr('data-area-series',si);
   if(s.geometry!=='point')marks.append('path').attr('d',path(pts)).attr('fill','none').attr('stroke',color).attr('stroke-width',py(s.lineWidth)).attr('stroke-dasharray',s.dashed?'7 4':null).attr('data-series-line',si);
   if(s.marker!=='none'||s.geometry==='point')pts.forEach((p:any,i:number)=>{if(p)point(marks,s.marker==='none'?'circle':s.marker,p[0],p[1],py(s.markerSize),color).attr('data-mark',`${si}:${i}`).attr('data-value',values[i]);});
  }
 }
 for(const error of f.errorBars||[]){
  const p=valuePoint(error.series,error.index);if(!p)continue;
  const isX=error.axis==='x',scale=isX?(horizontal?ys(error.series):numericX()):ys(error.series),project=(v:number)=>l.mirrorBars&&style(error.series).geometry==='bar'?barValue(error.series,v):v,a=scale(project(error.low)),b=scale(project(error.high));if(!valid(a)||!valid(b))continue;
  const g=marks.append('g').attr('data-error-bar',`${error.series}:${error.index}`).attr('stroke',theme.colors.ink).attr('stroke-width',1.5);
  g.append('line').attr('x1',isX?a:p[0]).attr('x2',isX?b:p[0]).attr('y1',isX?p[1]:a).attr('y2',isX?p[1]:b);
  for(const at of [a,b])g.append('line').attr('x1',isX?at:p[0]-4).attr('x2',isX?at:p[0]+4).attr('y1',isX?p[1]-4:at).attr('y2',isX?p[1]+4:at);
 }
 const leaders=svg.append('g').attr('data-layer','source-leaders');
 for(const lne of l.lines){leaders.append('path').attr('d',line<any>().x(p=>px(p[0])).y(p=>py(p[1]))(lne.points)).attr('fill','none').attr('stroke',lne.series!==undefined?colors[lne.series%colors.length]:theme.colors.ink).attr('stroke-width',py(lne.width)).attr('stroke-dasharray',lne.dashed?'6 4':null).attr('marker-end',lne.arrowEnd?`url(#${id}-arrow)`:null).attr('marker-start',lne.arrowStart?`url(#${id}-arrow)`:null);}
 const labels=svg.append('g').attr('data-layer','bound-text');
 for(const t of l.texts){
  let value=t.text,x=px(t.x),y=py(t.y);const i=t.index,si=t.series||0;
  if(t.role==='title')value=c.title!==old.title?c.title:t.text;
  else if(t.role==='caption')value=f.caption&&f.caption.replace(/\s+/g,' ').trim()!==t.text.replace(/\s+/g,' ').trim()?f.caption:t.text;
  else if(t.role==='category'||t.role==='point-label')value=c.labels[i]===old.labels[i]?t.text:c.labels[i]??'';
  else if(t.role==='value'){
   const v=c.series[si]?.values[i],prior=old.series[si]?.values[i];if(!valid(v))continue;value=v===prior?t.text:formatBoundValue(v,t.text,t.valueTemplate,l.numberFormats);
  }else if(t.role==='total'){const v=f.totals?.[i];if(!valid(v))continue;value=v===old.totals?.[i]?t.text:formatBoundValue(v,t.text,t.valueTemplate,l.numberFormats);}
  else if(t.role==='callout')value=f.categoryCallouts?.[t.item]?.values[i]??'';
  else if(t.role==='series-annotation'){const a=f.seriesAnnotations?.[t.item];if(a)value=t.text.includes(a.label)?`${a.label}: ${a.value}`:a.value;}
  else if(t.role==='series-name')value=c.series[si]?.name??t.text;
  else if(t.role==='annotation')value=c.annotations?.[t.item]??t.text;
  else if(t.role==='note')value=f.note&&f.note.replace(/\s+/g,' ').trim()!==t.text.replace(/\s+/g,' ').trim()?f.note:t.text;
  if(!isPie&&['value','point-label','category'].includes(t.role)){
   if(t.role==='category'&&!isScatter){const delta=category(i)-category(i,old);if(horizontal)y+=delta;else x+=delta;}
   else{const a=valuePoint(isScatter?0:si,i,true),b=valuePoint(isScatter?0:si,i);
    if(a&&b){let alpha=1;
     if(t.role==='value'&&style(si).geometry==='bar'){
      const oldScale=ys(si,true),oldBase=oldScale(Math.max(oldScale.domain()[0],baseValue(si,i,old,old.barBaselines))),pos=horizontal?x:y,end=horizontal?a[0]:a[1];
      const ratio=(pos-oldBase)/(end-oldBase);if(valid(ratio)&&ratio>=0&&ratio<=.9)alpha=ratio<.12?0:ratio;
      const newBase=ys(si)(baseValue(si,i,c,f.barBaselines)),shift=newBase-oldBase;
      if(horizontal)x+=shift*(1-alpha);else y+=shift*(1-alpha);
     }
     x+=(b[0]-a[0])*(horizontal?alpha:1);y+=(b[1]-a[1])*(horizontal?1:alpha);
    }
   }
  }
  if(t.box){labels.append('rect').attr('x',px(t.box[0])).attr('y',py(t.box[1])).attr('width',px(t.box[2])).attr('height',py(t.box[3])).attr('fill',theme.colors.background).attr('stroke',theme.colors.primary).attr('stroke-width',1);}
  text(labels,t,value,x,y).attr('data-binding',[t.role,si,i??'',t.item??''].join(':'));
 }
 // Keep dense stacked labels legible after changing the font family. Their
 // source anchors stay fixed; only a lower label's type size can shrink to the
 // measured space under its neighbour. Never move a value to another segment.
 if(!horizontal&&!isPie&&c.kind==='stacked-bar'){
  const bounds=(node:SVGTextElement)=>{
   const size=Number(node.getAttribute('font-size')),y=Number(node.getAttribute('y'));
   fontMeasure.font=`${node.getAttribute('font-style')} ${node.getAttribute('font-weight')} ${size}px ${node.getAttribute('font-family')}`;
   const m=fontMeasure.measureText(node.textContent||'');return {top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent,ascent:m.actualBoundingBoxAscent,size,y};
  };
  for(let i=0;i<c.labels.length;i++){
   const ns=[...labels.node()!.querySelectorAll<SVGTextElement>('text[data-binding^="value:"]')].filter(n=>Number(n.getAttribute('data-binding')!.split(':')[2])===i).sort((a,b)=>bounds(a).y-bounds(b).y);
   for(let j=1;j<ns.length;j++){
    const a=bounds(ns[j-1]),b=bounds(ns[j]);
    if(a.bottom+1>b.top&&b.ascent>0){const size=Math.max(b.size*.6,b.size*(b.y-a.bottom-1.5)/b.ascent);if(size<b.size)select(ns[j]).attr('font-size',size).attr('data-label-fit','source-neighbour-spacing');}
   }
  }
 }
 const legends=svg.append('g').attr('data-layer','legends');
 for(const lge of l.legends){const i=lge.index,callout=lge.binding==='callout',name=callout?f.categoryCallouts?.[i]?.label:isPie?c.labels[i]:c.series[i]?.name;if(name===undefined)continue;const x=px(lge.x),y=py(lge.y),width=px(lge.width),height=py(lge.height),color=colors[i%colors.length];
  const g=legends.append('g').attr('data-legend-index',i);
  if(callout)g.append('rect').attr('x',x).attr('y',y).attr('width',width).attr('height',height).attr('fill','none').attr('stroke',theme.colors.ink).attr('stroke-width',1).attr('stroke-dasharray','3 2');
  else if(!isPie&&style(i).geometry==='line'){
   g.append('line').attr('x1',x).attr('x2',x+width).attr('y1',y+height/2).attr('y2',y+height/2).attr('stroke',color).attr('stroke-width',Math.max(1,py(style(i).lineWidth)));
   if(style(i).marker!=='none')point(g,style(i).marker,x+width/2,y+height/2,Math.min(py(style(i).markerSize),height*1.3),color);
  }
  else if(lge.symbol==='line')g.append('line').attr('x1',x).attr('x2',x+width).attr('y1',y+height/2).attr('y2',y+height/2).attr('stroke',color).attr('stroke-width',2);
  else if(lge.symbol==='rect')g.append('rect').attr('x',x).attr('y',y).attr('width',width).attr('height',height).attr('fill',fills[i%fills.length]);
  else point(g,lge.symbol,x+width/2,y+height/2,Math.min(width,height),fills[i%fills.length]);
  text(g,{fontSize:lge.fontSize,glyphBox:lge.glyphBox},name,px(lge.textX),py(lge.textY)).attr('data-legend',name);
 }
 return svg.node()!;
}

export const SourceLayoutFigure=forwardRef<SVGSVGElement,{figure:any;standalone?:boolean}>(function SourceLayoutFigure({figure,standalone=false},ref){
 const host=useRef<HTMLDivElement>(null),id=useId().replace(/:/g,'');
 useLayoutEffect(()=>{let active=true;const draw=()=>{if(!active||!host.current)return;host.current.replaceChildren();const svg=drawSourceLayout(host.current,figure,'source-'+id);svg.style.width='100%';svg.style.height=standalone?'auto':'100%';svg.style.display='block';svg.setAttribute('preserveAspectRatio','xMidYMin meet');if(typeof ref==='function')ref(svg);else if(ref)ref.current=svg;};draw();void document.fonts.ready.then(draw);return()=>{active=false;if(typeof ref==='function')ref(null);else if(ref)ref.current=null;};},[figure,id,standalone,ref]);
 return <div ref={host} style={{width:'100%',height:standalone?undefined:'100%'}}/>;
});
