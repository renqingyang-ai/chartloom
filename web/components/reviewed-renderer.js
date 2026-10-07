/* Local shared component library. Visual rules derived from the reviewed D3 baseline; arrays and geometry are input-driven. */
import * as d3 from 'd3';
export function renderReferenceFigure(host, figure, theme) {
const C=theme.colors, F=theme.font;
const measure=(s,size=16)=>{const c=document.createElement("canvas").getContext("2d");c.font=`${size}px ${F.data.family}`;return c.measureText(String(s)).width;};
const numberLabel=(d,v,i,j)=>d.valueLabels?.[j]?.[i]?.value===v?d.valueLabels[j][i].text:v===null?"—":(v<0?"(":"")+((d.unit||"").includes("$")?"$":"")+fmt(Math.abs(v),d.decimals??(Number.isInteger(v)?0:1))+((d.unit||"")==="%"?"%":"")+(v<0?")":"");
const fitSize=(s,width,size=18)=>Math.max(9,Math.min(size,size*width/Math.max(1,measure(s,size))));
const fmt=(v,d=0)=>v===null?'—':v<0?'('+d3.format(',.'+d+'f')(-v)+')':d3.format(',.'+d+'f')(v);
function text(g,x,y,s,role='data',extra={}){
 const e=g.append('text').attr('x',x).attr('y',y).attr('fill',C.ink).attr('font-family',F[role].family).attr('font-size',F[role].size).attr('font-weight',F[role].weight).attr('data-role',role).text(s);
 if(F[role].style)e.attr('font-style',F[role].style);
 Object.entries(extra).forEach(([k,v])=>e.attr(k,v));return e;
}
function line(g,x1,y1,x2,y2,opacity=.18,width=1){return g.append('line').attr('x1',x1).attr('y1',y1).attr('x2',x2).attr('y2',y2).attr('stroke',C.ink).attr('stroke-opacity',opacity).attr('stroke-width',width)}
function wrap(g,x,y,s,width,role='data',leading=28,extra={}){
 const e=text(g,x,y,'',role,extra);let row='',n=0,t=e.append('tspan').attr('x',x).attr('dy',0);
 const next=()=>{t.text(row.trimEnd());t=e.append('tspan').attr('x',x).attr('dy',leading);row='';n++;};
 const add=token=>{const old=row;row+=token;t.text(row);if(t.node().getComputedTextLength()>width&&old.trim()){row=old;next();row=token.trimStart();t.text(row);}if(t.node().getComputedTextLength()>width&&Array.from(row).length>1){const chars=Array.from(row);row='';t.text('');for(const ch of chars){const prior=row;row+=ch;t.text(row);if(t.node().getComputedTextLength()>width&&prior){row=prior;next();row=ch;t.text(row);}}}};
 for(const token of String(s).match(/[\u2e80-\u9fff]|[^\u2e80-\u9fff\s]+|\s+/gu)||[])add(token);
 t.text(row.trimEnd());return {element:e,height:(n+1)*leading};
}
function fact(e,d,s,i,v){return e.attr('data-value',v).attr('data-fact',JSON.stringify({chart:d.key,series:s,category:d.categories?.[i],value:v,sourcePage:d.page,sourceDate:d.source?.asOf}))}
function rect(g,x,y,w,h,fill){return g.append('rect').attr('x',x).attr('y',y).attr('width',Math.max(0,w)).attr('height',Math.max(0,h)).attr('fill',fill)}
function base(d){
 const svg=d3.create('svg').attr('xmlns','http://www.w3.org/2000/svg').attr('width',d.width).attr('height',d.height).attr('viewBox',`0 0 ${d.width} ${d.height}`).attr('role','img').attr('aria-label',d.title).attr('data-chart',d.key);
 svg.append('title').text(d.title);svg.append('desc').text(`${d.source.document}; source page ${d.page}; as of ${d.source.asOf}; ${d.extractionMethod}`);
 svg.append('metadata').text(JSON.stringify(d));
 svg.append('style').text('');
 host.appendChild(svg.node());
 rect(svg,0,0,d.width,d.height,C.background).attr('data-chart-background','true');
 const defs=svg.append('defs');
 const pattern=(id,bg,type)=>{const p=defs.append('pattern').attr('id',(d.renderId||d.key)+'-'+id).attr('patternUnits','userSpaceOnUse').attr('width',8).attr('height',8);rect(p,0,0,8,8,bg);if(type==='dot')p.append('circle').attr('cx',4).attr('cy',4).attr('r',1.15).attr('fill',C.ink).attr('opacity',.7);else p.append('path').attr('d','M-2,2L2,-2 M0,8L8,0 M6,10L10,6').attr('stroke',C.ink).attr('stroke-width',1).attr('opacity',.42);};
 pattern('hatch',C.secondary,'hatch');pattern('dots',C.tertiary,'dot');
 const fills=[C.ink,C.secondary,`url(#${d.renderId||d.key}-hatch)`,C.primary,C.tertiary,`url(#${d.renderId||d.key}-dots)`];
 return {svg,fills};
}
function axis(g,x,y,xd,yd,xTicks,yTicks,opt={}){
 const {left,right,top,bottom}=opt;
 yTicks.forEach(v=>{line(g,left,y(v),right,y(v),v===0?.45:.12,v===0?1.1:.8);text(g,left-10,y(v)+6,opt.yFormat?opt.yFormat(v):fmt(v),'data',{'text-anchor':'end','font-size':opt.fontSize||20});});
 xTicks.forEach(v=>{text(g,x(v),bottom+33,opt.xFormat?opt.xFormat(v):String(v),'data',{'text-anchor':'middle','font-size':opt.fontSize||20});});
}





function arrow(g,x1,y1,x2,y2,label,size=18){
 line(g,x1,y1,x2,y2,.85,1.4);const a=Math.atan2(y2-y1,x2-x1),s=10;
 g.append('path').attr('d',`M${x2},${y2}L${x2-s*Math.cos(a-.45)},${y2-s*Math.sin(a-.45)}L${x2-s*Math.cos(a+.45)},${y2-s*Math.sin(a+.45)}Z`).attr('fill',C.ink);
 text(g,(x1+x2)/2,(y1+y2)/2-12,label,'data',{'text-anchor':'middle','font-size':size,'font-style':'italic','font-weight':600});
}
function legend(g,items,w,y,size=15,cols){
 if(figure.legendOrder?.length){const order=name=>{const index=figure.legendOrder.indexOf(name);return index<0?figure.legendOrder.length:index;};items=[...items].sort((a,b)=>order(a.name)-order(b.name));}
 let xx=8,yy=y; const columns=cols||Math.max(1,Math.floor(w/(Math.max(...items.map(s=>measure(s.name,size)),100)+32))),cw=(w-16)/columns;
 items.forEach((s,i)=>{if(i&&i%columns===0){xx=8;yy+=23;}const sw=rect(g,xx,yy-12,12,12,s.fill||C.background);if(s.dashed)sw.attr('stroke',C.ink).attr('stroke-dasharray','4 3');text(g,xx+19,yy,s.name,'data',{'font-size':fitSize(s.name,cw-25,size)}).attr('data-legend',s.name);xx+=cw;});return yy+8;
}
function categoryLabels(svg,d,x,y,size=18){
 d.categories.forEach((c,i)=>{const s=fitSize(c,x.step()-4,size);text(svg,x(String(i))+x.bandwidth()/2,y,c,'data',{'text-anchor':'middle','font-size':s,'font-weight':600}).attr('data-category',i);});
}
function single(d){
 const {svg}=base(d),w=d.width,h=d.height,vs=d.series[0].values,left=12,right=w-12;
 const x=d3.scaleBand().domain(d.categories.map((_,i)=>String(i))).range([left,right]).paddingInner(.43).paddingOuter(.20);
 const values=vs.filter(v=>v!==null),max=Math.max(0,...values),min=Math.min(0,...values),bottom=h-57;
 const y=d3.scaleLinear().domain([min<0?min*1.15:0,min<0?Math.max(max*3.9,Math.abs(min)*.3,1):Math.max(1,max*(d.cagr?1.22:1.15))]).range([bottom,d.cagr?79:20]);
 line(svg,left,y(0),right,y(0),.25);
 vs.forEach((v,i)=>{if(v===null)return;const xx=x(String(i)),label=numberLabel(d,v,i,0),fs=fitSize(label,x.step()-4,19);
  rect(svg,xx,Math.min(y(v),y(0)),x.bandwidth(),Math.abs(y(v)-y(0)),C.primary).attr('data-value',v).attr('data-series',d.series[0].name);
  fact(text(svg,xx+x.bandwidth()/2,v<0?y(v)+fs+4:y(v)-10,label,'data',{'text-anchor':'middle','font-size':fs,'font-weight':600}),d,d.series[0].name,i,v);
 });
 categoryLabels(svg,d,x,h-7,18);
 const first=vs.findIndex(v=>v!==null);if(d.cagr&&first>=0&&d.categories.length>1)arrow(svg,x(String(first))+x.bandwidth()/2,77,x(String(d.categories.length-1))+x.bandwidth()/2,21,d.cagr,fitSize(d.cagr,w*.7,18));
 return svg;
}
function stacked(d){
 const {svg,fills:standardFills}=base(d),w=d.width,h=d.height,summary=d.series.some(s=>s.cagr),compact=d.kind==='balance',fills=compact?[C.ink,C.secondary,C.primary,C.tertiary]:standardFills;
 const legends=d.series.map((s,j)=>({name:s.name,fill:fills[j%fills.length]}));
 const inline=(d.categoryCallouts||[]).filter(r=>r.values.filter(v=>v!==null&&v!=='').length===1);
 const perCategory=(d.categoryCallouts||[]).filter(r=>r.values.filter(v=>v!==null&&v!=='').length>1);
 const legendCols=compact?2:Math.max(1,Math.floor(w/(Math.max(...legends.map(l=>measure(l.name,15)))+38)));
 const legendHeight=Math.ceil((legends.length+inline.length)/legendCols)*23;
 const noteHeight=d.legendFootnote?Math.ceil(measure(d.legendFootnote,14)/(w-24))*19+18:0;
 const left=10,right=w-(summary?154:28),bottom=h-38-legendHeight-noteHeight,top=(compact?110:summary?72:40)+perCategory.length*46+(d.note?56:0);
 const x=d3.scaleBand().domain(d.categories.map((_,i)=>String(i))).range([left,right]).paddingInner(compact?.40:.45).paddingOuter(.15);
 const values=d.categories.map((_,i)=>d.series.map(s=>s.values[i]));
 const layers=d3.stack().keys(d.series.map((_,i)=>i)).value((row,j)=>row[j]??0).offset(d3.stackOffsetDiverging)(values);
 for(const b of d.barBaselines||[]){const j=d.series.findIndex(s=>s.name===b.series),i=Number.isInteger(b.categoryIndex)?b.categoryIndex:d.categories.indexOf(b.category);if(j>=0&&i>=0&&i<d.categories.length&&d.series[j].values[i]!==null){layers[j][i][0]=b.value;layers[j][i][1]=b.value+d.series[j].values[i];}}
 const all=layers.flatMap(layer=>layer.flatMap(v=>[v[0],v[1]]));const lo=Math.min(0,...all),hi=Math.max(1,...all,...(d.reportedTotals||[]).filter(v=>v!==null));
 const y=d3.scaleLinear().domain([lo<0?lo*1.14:0,hi*1.04]).range([bottom,top]);line(svg,left,y(0),right,y(0),.3);
 d.categories.forEach((cat,i)=>{
  const small=[];const xx=x(String(i)),bw=x.bandwidth();
  d.series.forEach((s,j)=>{const v=s.values[i];if(v===null)return;const seg=layers[j][i],yt=y(Math.max(...seg)),hh=Math.abs(y(seg[1])-y(seg[0]));
   rect(svg,xx,yt,bw,hh,fills[j%fills.length]).attr('stroke',C.background).attr('stroke-width',.7).attr('data-series',s.name).attr('data-value',v);
   const label=numberLabel(d,v,i,j),fs=fitSize(label,bw+5,compact?18:15);
   if(compact&&hh<26){fact(text(svg,xx+bw/2,yt-10,label,'data',{'text-anchor':'middle','font-size':fs,'font-weight':600}),d,s.name,i,v);return;}
   if(hh<Math.max(22,fs*1.65)){small.push({j,v,label,y:yt+hh/2,fs:Math.min(fs,12)});return;}
   fact(text(svg,xx+bw/2,yt+hh/2+fs*.35,label,'data',{'text-anchor':'middle','font-size':fs,'font-weight':600,'fill':j%fills.length===0?C.background:C.ink}),d,s.name,i,v);
  });
  small.sort((a,b)=>a.y-b.y);let last=-Infinity;small.forEach(a=>{a.yy=Math.max(a.y,last+21);last=a.yy;});if(small.length){const offset=small.reduce((sum,a)=>sum+a.yy-a.y,0)/small.length;small.forEach(a=>{a.yy-=offset;line(svg,xx+bw,a.y,xx+bw+5,a.yy,.6,.7);fact(text(svg,xx+bw+6,a.yy+4,a.label,'data',{'font-size':a.fs,'font-weight':600}),d,d.series[a.j].name,i,a.v);});}
  const total=d.reportedTotals?.[i],totalInline=inline.some(r=>Number(String(r.values[i]).replace(/[^\d.\-]/g,''))===total);
  if(total!==undefined&&total!==null&&!totalInline&&!(compact&&d.series.filter(s=>s.values[i]!==null).length===1))fact(text(svg,xx+bw/2,y(Math.max(0,...layers.map(l=>l[i][1])))-11,numberLabel(d,total),'data',{'text-anchor':'middle','font-size':fitSize(numberLabel(d,total),x.step()-4,compact?18:16),'font-weight':600}),d,'Printed total',i,total);
 });
 if(!compact)categoryLabels(svg,d,x,bottom+25,16);
 if(summary){text(svg,w-70,21,d.seriesAnnotationTitle||'Segment CAGR','data',{'text-anchor':'middle','font-size':15,'font-weight':600});if(d.seriesAnnotationPeriod)text(svg,w-70,42,d.seriesAnnotationPeriod,'note',{'text-anchor':'middle','font-size':15});line(svg,w-136,8,w-136,bottom,.16);const i=d.categories.length-1;const summaries=d.series.map((s,j)=>({s,j,yy:(y(layers[j][i][0])+y(layers[j][i][1]))/2})).filter(a=>a.s.cagr).sort((a,b)=>a.yy-b.yy);let last=-99;summaries.forEach(a=>{a.yy=Math.max(a.yy,last+28);last=a.yy;});const extra=Math.max(0,last-bottom+14);summaries.forEach(({s,j,yy})=>{yy-=extra;rect(svg,w-120,yy-12,100,24,fills[j%fills.length]);text(svg,w-70,yy+6,s.cagr,'data',{'text-anchor':'middle','font-size':17,'font-weight':600,'fill':j%fills.length===0?C.background:C.ink});});}
 if(d.note){rect(svg,left+140,43,Math.min(310,w*.42),50,C.tertiary).attr('rx',6).attr('stroke',C.primary).attr('stroke-dasharray','4 3');wrap(svg,left+150,61,d.note,Math.min(290,w*.42-20),'note',17,{'font-size':14});}
 inline.forEach(r=>r.values.forEach((value,i)=>{if(value===null||value==='')return;const xx=x(String(i))+x.bandwidth()/2,yy=y(Math.max(0,...layers.map(l=>l[i][1])))-(compact?72:42),bw=Math.max(55,Math.min(x.step()-4,measure(value,17)+18));rect(svg,xx-bw/2,yy,bw,27,C.background).attr('stroke',C.primary).attr('stroke-dasharray','5 4');text(svg,xx,yy+19,value,'data',{'text-anchor':'middle','font-size':fitSize(value,bw-8,17),'font-weight':600});}));
 perCategory.forEach((r,k)=>r.values.forEach((value,i)=>{if(value===null||value==='')return;const xx=x(String(i))+x.bandwidth()/2;rect(svg,xx-x.bandwidth()/2,8+k*42,x.bandwidth(),29,C.background).attr('stroke',C.ink).attr('stroke-dasharray','5 4');text(svg,xx,28+k*42,value,'data',{'text-anchor':'middle','font-size':fitSize(value,x.bandwidth()-6,17)});}));
 const end=legend(svg,[...legends,...inline.map(r=>({name:r.label,dashed:true}))],w,bottom+49,compact?14:15,legendCols);
 if(d.legendFootnote)wrap(svg,8,end+16,d.legendFootnote,w-20,'note',18,{'font-size':14});
 return svg;
}
function balance(d){return stacked({...d,kind:'balance'});}
function grouped(d){
 const {svg,fills}=base(d),w=d.width,h=d.height,left=10,right=w-10,annotations=d.categoryCallouts||[],legendItems=d.series.map((s,j)=>({name:s.name,fill:fills[j%fills.length]}));
 const cols=Math.max(1,Math.floor(w/230)),legendH=Math.ceil((legendItems.length+annotations.length)/cols)*23,hasNegative=d.series.some(s=>s.values.some(v=>v<0)),bottom=h-(hasNegative?72:35)-legendH;
 const x=d3.scaleBand().domain(d.categories.map((_,i)=>String(i))).range([left,right]).paddingInner(.21).paddingOuter(.05),sub=d3.scaleBand().domain(d.series.map((_,i)=>String(i))).range([0,x.bandwidth()]).padding(.16);
 const vs=d.series.flatMap(s=>s.values).filter(v=>v!==null),lo=Math.min(0,...vs),hi=Math.max(1,...vs),top=25+annotations.length*42+(d.cagr?66:0),y=d3.scaleLinear().domain([lo<0?lo*1.18:0,hi*1.05]).range([bottom,top]);
 annotations.forEach((r,k)=>d.categories.forEach((_,i)=>{const v=r.values[i];if(v===null||v===undefined||v==='')return;const cx=x(String(i))+x.bandwidth()/2,bw=Math.min(90,x.bandwidth());rect(svg,cx-bw/2,4+k*42,bw,31,'none').attr('stroke',C.ink).attr('stroke-dasharray','6 4');text(svg,cx,25+k*42,v,'data',{'text-anchor':'middle','font-size':fitSize(v,bw-6,18),'font-weight':600});}));
 if(d.cagr&&d.categories.length>1)arrow(svg,x('0')+x.bandwidth()/2,top-40,x(String(d.categories.length-1))+x.bandwidth()/2,top-64,d.cagr,fitSize(d.cagr,w*.6,18));
 line(svg,left,y(0),right,y(0),.28);
 d.series.forEach((s,j)=>s.values.forEach((v,i)=>{if(v===null)return;const xx=x(String(i))+sub(String(j)),label=numberLabel(d,v,i,j),fs=fitSize(label,sub.step()-4,18);rect(svg,xx,Math.min(y(v),y(0)),sub.bandwidth(),Math.abs(y(v)-y(0)),fills[j%fills.length]).attr('data-value',v).attr('data-series',s.name);fact(text(svg,xx+sub.bandwidth()/2,v<0?y(v)+fs+4:y(v)-8,label,'data',{'text-anchor':'middle','font-size':fs,'font-weight':600}),d,s.name,i,v);}));
 categoryLabels(svg,d,x,h-11-legendH,18);legend(svg,[...legendItems,...annotations.map(a=>({name:a.label,dashed:true}))],w,h+14-legendH,15,cols);return svg;
}
function scatter(d){
 const {svg}=base(d),w=d.width,h=d.height,box={left:64,right:w-25,top:22,bottom:h-62};
 const x=d3.scaleLinear().domain([Math.min(d.xDomain[0],...d.points.map(p=>p.year)),Math.max(d.xDomain[1],...d.points.map(p=>p.year))]).range([box.left,box.right]),y=d3.scaleLinear().domain([Math.min(d.yDomain[0],...d.points.map(p=>p.value)),Math.max(d.yDomain[1],...d.points.map(p=>p.value))]).range([box.bottom,box.top]);
 axis(svg,x,y,d.xDomain,d.yDomain,d.xTicks,d.yTicks,{...box,fontSize:15,yFormat:v=>fmt(v)+(d.axisSuffix||'')});
 const used=[],marks=d.points.map(p=>({x:x(p.year)-7,y:y(p.value)-7,w:14,h:14})),overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 d.points.forEach((p,i)=>{const xx=x(p.year),yy=y(p.value),tw=measure(p.label,15)+4,th=25,hint=p.labelOffset;const initial=hint?{x:xx+hint.dx,y:yy+hint.dy-19}:{x:xx-tw/2,y:yy-35};
  const candidates=[initial,...[0,-28,28,-55,55,-82,82,-109,109].flatMap(dy=>[-tw-12,12,-tw/2].map(dx=>({x:xx+dx,y:yy+dy-23})))].map(a=>({x:Math.max(box.left,Math.min(w-tw-2,a.x)),y:Math.max(1,Math.min(box.bottom-th,a.y)),w:tw,h:th}));
  const cost=a=>used.reduce((n,b)=>n+overlap(a,b)*100,0)+marks.reduce((n,b)=>n+overlap(a,b)*100,0)+2*Math.hypot(Math.max(a.x,Math.min(a.x+a.w,xx))-xx,Math.max(a.y,Math.min(a.y+a.h,yy))-yy)+.15*Math.hypot(a.x-initial.x,a.y-initial.y);candidates.sort((a,b)=>cost(a)-cost(b));const q=candidates[0];used.push(q);
  svg.append('path').attr('d',d3.symbol().type(d3.symbolDiamond).size(80)()).attr('transform',`translate(${xx},${yy})`).attr('fill',C.ink).attr('data-observation',p.nativeId||i).attr('data-value',p.value);
  line(svg,xx,yy,Math.max(q.x,Math.min(q.x+tw,xx)),q.y+9,.25,.7);text(svg,q.x,q.y+19,p.label,'data',{'font-size':15}).attr('data-point-label',p.label);
 });
 text(svg,0,h-7,'Approximate readings reconstructed from the source plot.','note',{'font-size':13});return svg;
}
function curves(d){
 const {svg}=base(d),w=d.width,h=d.height,box={left:64,right:w-26,top:25,bottom:h-63};
 const all=d.curves.flatMap(c=>c.annualKnots).filter(p=>p.value!==null),x=d3.scaleLinear().domain([Math.min(d.xDomain[0],...all.map(p=>p.year)),Math.max(d.xDomain[1],...all.map(p=>p.year))]).range([box.left,box.right]),y=d3.scaleLinear().domain([Math.min(d.yDomain[0],...all.map(p=>p.value)),Math.max(d.yDomain[1],...all.map(p=>p.value))]).range([box.bottom,box.top]);
 axis(svg,x,y,d.xDomain,d.yDomain,d.xTicks,d.yTicks,{...box,fontSize:15});
 const colors=[C.ink,C.primary,C.secondary];d.curves.forEach((s,j)=>{let path='';if(!d.curvesEdited&&s.segments?.length){const p=d3.path();p.moveTo(x(s.segments[0][0].year),y(s.segments[0][0].value));s.segments.forEach(a=>p.bezierCurveTo(x(a[1].year),y(a[1].value),x(a[2].year),y(a[2].value),x(a[3].year),y(a[3].value)));path=p.toString();}else path=d3.line().defined(p=>p.value!==null).x(p=>x(p.year)).y(p=>y(p.value)).curve(d3.curveMonotoneX)(s.annualKnots);
  svg.append('path').attr('d',path).attr('stroke',colors[j%3]).attr('stroke-width',3).attr('fill','none').attr('data-curve',s.name);
  s.annualKnots.forEach(p=>{if(p.value!==null)svg.append('circle').attr('cx',x(p.year)).attr('cy',y(p.value)).attr('r',d.curvesEdited?2:0).attr('data-value',p.value);});
  const values=s.annualKnots.filter(p=>p.value!==null),p=values[Math.floor((values.length-1)*.56)],end=values.at(-1);if(p)text(svg,x(p.year),Math.max(16,y(p.value)-14-j*8),s.name,'note',{'text-anchor':'middle','font-size':16,'fill':C.ink});if(end&&s.cagr)text(svg,w-3,Math.max(17+j*20,y(end.value)-13),s.cagr,'note',{'text-anchor':'end','font-size':15});
 });text(svg,0,h-7,'Curve positions are reconstructed; values are approximate.','note',{'font-size':13});return svg;
}
function nativeTiers(d){
 const {svg}=base(d),g=d.nativeGeometry,[bx,by,bw,bh]=g.region,x=v=>(v-bx)/bw*d.width,y=v=>(v-by)/bh*d.height;
 const palette=[C.ink,C.secondary,C.primary,C.tertiary],fill=color=>{if(color===null)return 'none';if(g.fillTiers?.[color]!==undefined)return palette[g.fillTiers[color]%palette.length];if(color==='#ffffff')return C.background;const rgb=color?.match(/[a-f\d]{2}/gi)?.map(c=>parseInt(c,16))||[0,0,0];return Math.max(...rgb)-Math.min(...rgb)<15&&Math.min(...rgb)>150?C.secondary:C.ink;};
 svg.attr('data-native-geometry','source-tier-paths');
 for(const shape of g.paths){const path=d3.path();let last;
  for(const [kind,...points] of shape.commands){if(kind==='rect'){const [a,b,c,e]=points[0];path.rect(x(a),y(b),x(a+c)-x(a),y(b+e)-y(b));last=null;continue;}if(kind==='quad'){path.moveTo(x(points[0][0]),y(points[0][1]));for(const p of points.slice(1))path.lineTo(x(p[0]),y(p[1]));path.closePath();last=null;continue;}const first=points[0];if(!last||Math.abs(first[0]-last[0])>.003||Math.abs(first[1]-last[1])>.003)path.moveTo(x(first[0]),y(first[1]));if(kind==='l')path.lineTo(x(points[1][0]),y(points[1][1]));if(kind==='c')path.bezierCurveTo(x(points[1][0]),y(points[1][1]),x(points[2][0]),y(points[2][1]),x(points[3][0]),y(points[3][1]));last=points.at(-1);}
  if(shape.closed)path.closePath();svg.append('path').attr('d',path.toString()).attr('fill',fill(shape.fill)).attr('stroke',shape.stroke?C.ink:'none').attr('stroke-width',Math.max(.5,(shape.width||.6)*d.width/(g.pageWidth*bw/100)));
 }
 for(const l of g.labels){const value=l.ref.reduce((v,key)=>v?.[key],d);if(value===undefined)continue;const [lx,ly,lw,lh]=l.bbox,fs=l.size*d.width/(g.pageWidth*bw/100),color=l.ref[0]==='tiers'&&l.ref[1]===0?C.background:C.ink;
  const lines=value===l.text&&l.lines?.length?l.lines:[String(value)],label=text(svg,x(lx),y(ly)+fs*.83,'','data',{'font-size':fs,'fill':color,'font-weight':500});
  lines.forEach((line,i)=>label.append('tspan').attr('x',x(lx)).attr('dy',i?Math.max(fs*1.1,lh/bh*d.height/lines.length):0).text(line));
  const actual=label.node().getBBox().width,slot=lw/bw*d.width;if(actual>slot*1.08)label.attr('font-size',Math.max(fs*.76,fs*slot/actual));
  if(l.ref[2]==='cities')label.attr('data-tier-member',value);
 }
 return svg;
}
function tiers(d){
 if(d.nativeGeometry?.fillTiers)return nativeTiers(d);
 const {svg}=base(d),w=d.width,h=d.height,ox=9,oy=h-10,R=Math.min(w-26,h-42),n=d.tiers.length;
 const colors=[C.ink,C.secondary,C.primary,C.tertiary],radii=d.tiers.map((_,i)=>Math.pow((i+1)/n,.72));
 d.tiers.forEach((t,j)=>{const r=R*radii[j],r0=j?R*radii[j-1]:0;svg.append('path').attr('d',`M${ox},${oy-r}A${r},${r} 0 0 1 ${ox+r},${oy}L${ox+r0},${oy}A${r0},${r0} 0 0 0 ${ox},${oy-r0}Z`).attr('fill',colors[j%colors.length]).attr('stroke',C.ink).attr('stroke-width',1.2);});
 const used=[];
 d.tiers.forEach((t,j)=>{const r=R*radii[j],r0=j?R*radii[j-1]:0,color=j%colors.length===0?C.background:C.ink,yy=j===0?oy-12:oy-(r+r0)/2;const label=text(svg,16,yy,t.name,'data',{'font-size':14,'fill':color});const b=label.node().getBBox();used.push({x:b.x,y:b.y,width:b.width,height:b.height});});
 d.tiers.forEach((t,j)=>{const r=R*radii[j],color=j%colors.length===0?C.background:C.ink;t.cities.forEach((city,i)=>{const a=(80-i*72/Math.max(1,t.cities.length-1))*Math.PI/180,cx=ox+r*Math.cos(a),cy=oy-r*Math.sin(a),highlight=city===d.highlight;
  svg.append('path').attr('d',d3.symbol().type(highlight?d3.symbolStar:d3.symbolCircle).size(highlight?180:48)()).attr('transform',`translate(${cx},${cy})`).attr('fill',j===0?C.secondary:C.ink);
  const labelWidth=Math.max(55,Math.min(92,r*.34)),lx=Math.max(labelWidth+14,cx-7),ly=cy+24;
  const label=wrap(svg,lx,ly,city,labelWidth,'data',16,{'text-anchor':'end','font-size':14,'font-weight':highlight?600:400,'fill':color}).element,b=label.node().getBBox(),overlap=(q,o)=>Math.max(0,Math.min(q.x+q.width,o.x+o.width)-Math.max(q.x,o.x))*Math.max(0,Math.min(q.y+q.height,o.y+o.height)-Math.max(q.y,o.y));
  const options=[0,-16,16,-32,32,-48,48].flatMap(dy=>[0,-12,12,-24,24].map(dx=>({x:Math.max(14,Math.min(w-b.width-8,b.x+dx)),y:Math.max(25,Math.min(oy-b.height-3,b.y+dy)),width:b.width,height:b.height})));
  const cost=q=>used.reduce((sum,o)=>sum+overlap(q,o)*100,0)+Math.hypot(q.x-b.x,q.y-b.y);options.sort((a,b)=>cost(a)-cost(b));const q=options[0];label.attr('transform',`translate(${q.x-b.x},${q.y-b.y})`).attr('data-tier-member',city);used.push(q);
 });});
 text(svg,w-2,18,d.direction||d.title||'','note',{'text-anchor':'end','font-size':14,'font-style':'normal'});return svg;
}

function glyph(g,cx,cy,index,color){
 const paths=[
 'M-9,-19V19M-16,-12H5C21,-12 21,0 5,0H-9M-9,0H7C24,0 24,14 7,14H-16M-3,-19V-12M-3,14V19',
 'M-20,-15H-3V0H-20ZM3,0H20V15H3ZM-3,-6L9,6M-8,8L-1,1',
 'M-21,-20V19H23M-14,8L-2,-4L8,2L20,-14M10,-14H20V-4',
 'M-16,-23H16V23H-16ZM-8,-12H-4M4,-12H8M-8,0H-4M4,0H8M-8,12H-4M4,12H8',
 'M-23,-15H23V19H-23ZM-6,-15V-23H6V-15M-12,-5V2M-18,12Q-12,1 -6,12M3,-3H16M3,5H16M3,13H12',
 'M-22,20L-16,5L9,-20L20,-9L-5,16ZM-16,5L-5,16M6,-17L17,-6M-22,20L-5,16',
 'M-23,16V-9L0,-24L23,-9V16ZM-12,16V-1H1V16M8,-3H16M8,5H16',
 'M-23,21V-6L6,-18V21ZM6,-4L23,3V21M-15,0V6M-4,-5V2M-15,12V18M-4,10V18M13,7V13',
 'M-17,-23H17V23H-17ZM-9,-12H9M-9,-5H9M-9,2H9M-9,9H1M-7,15L0,20L10,10'
 ];
 g.append('path').attr('d',paths[index%paths.length]).attr('transform',`translate(${cx},${cy})`).attr('fill','none').attr('stroke',color).attr('stroke-width',2.5).attr('stroke-linecap','round').attr('stroke-linejoin','round');
}
function timeline(d){
 const events=d.phases.flatMap((p,j)=>p.events.map(e=>({...e,phase:j}))),w=d.width,step=(w-200)/Math.max(1,events.length-1),tw=Math.min(316,Math.max(110,step*1.7));
 const longest=Math.max(1,...events.map(e=>Math.ceil(measure(e.description,20)/tw)));
 d={...d,height:Math.max(d.height,260+longest*50)};
 const {svg}=base(d),h=d.height,cols=[C.ink,C.primary,C.secondary,C.tertiary];
 let firstEvent=0;
 d.phases.forEach((p,i)=>{const x=i===0?0:100+step*(firstEvent-.5);firstEvent+=p.events.length;const end=i===d.phases.length-1?w:100+step*(firstEvent-.5),pw=end-x;
  svg.append('path').attr('data-timeline-phase',i).attr('data-phase-left',x).attr('data-phase-right',end).attr('d',`M${x},0H${end-20}L${end},26L${end-20},52H${x}L${x+20},26Z`).attr('fill',cols[i%cols.length]);text(svg,x+pw/2,34,p.title,'data',{'text-anchor':'middle','font-size':fitSize(p.title,pw-54,24),'font-weight':600,'fill':i%cols.length===0?C.background:C.ink});});
 const centers=events.map((_,i)=>[100+step*i,h*.52+(i%2?38:-38)]),radius=Math.min(47,step*.3);
 svg.append('path').attr('d',d3.line()(centers)).attr('fill','none').attr('stroke',C.secondary).attr('stroke-width',5);
 events.forEach((e,i)=>{const [cx,cy]=centers[i],top=i%2===0,color=cols[e.phase%cols.length],tx=Math.min(w-tw/2-3,Math.max(tw/2+3,cx));
  svg.append('circle').attr('cx',cx).attr('cy',cy).attr('r',radius).attr('fill',C.background).attr('stroke',color).attr('stroke-width',7).attr('data-event',i).attr('data-event-phase',e.phase);
  const icon=svg.append('g').attr('transform',`translate(${cx},${cy}) scale(${radius/47})`);glyph(icon,0,0,i,C.ink);
  const arrowY=cy+(top?-1:1)*(radius+19);svg.append('path').attr('d',d3.symbol().type(d3.symbolTriangle).size(135)()).attr('transform',`translate(${cx},${arrowY}) rotate(${top?0:180})`).attr('fill',C.ink);
  const dateY=top?95:arrowY+43;text(svg,tx,dateY,e.date,'heading',{'text-anchor':'middle','font-size':fitSize(e.date,tw-8,30)});
  const eText=wrap(svg,tx,dateY+34,e.description,tw,'data',24,{'text-anchor':'middle','font-size':20}).element;
  eText.attr('data-event-copy',i);
 });return svg;
}

const renderers={stacked,grouped,balance,single,scatter,curves,timeline,tiers};
return renderers[figure.kind](figure).node();
}
