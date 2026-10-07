/* Source charts -> D3 7 -> configurable theme. No raster tracing or sampled bar heights. */
import * as d3 from 'd3';
export function renderReferenceFigure(host, figure, theme) {
const C=theme.colors, F=theme.font;
const fmt=(v,d=0)=>v===null?'—':v<0?'('+d3.format(',.'+d+'f')(-v)+')':d3.format(',.'+d+'f')(v);
function text(g,x,y,s,role='data',extra={}){
 const e=g.append('text').attr('x',x).attr('y',y).attr('fill',C.ink).attr('font-family',F[role].family).attr('font-size',F[role].size).attr('font-weight',F[role].weight).attr('data-role',role).text(s);
 if(F[role].style)e.attr('font-style',F[role].style);
 Object.entries(extra).forEach(([k,v])=>e.attr(k,v));return e;
}
function line(g,x1,y1,x2,y2,opacity=.18,width=1){return g.append('line').attr('x1',x1).attr('y1',y1).attr('x2',x2).attr('y2',y2).attr('stroke',C.ink).attr('stroke-opacity',opacity).attr('stroke-width',width)}
function wrap(g,x,y,s,width,role='data',leading=28,extra={}){
 const e=text(g,x,y,'',role,extra);let words=s.split(/\s+/),row=[],n=0,t=e.append('tspan').attr('x',x).attr('dy',0);
 words.forEach(w=>{row.push(w);t.text(row.join(' '));if(t.node().getComputedTextLength()>width&&row.length>1){row.pop();t.text(row.join(' '));row=[w];t=e.append('tspan').attr('x',x).attr('dy',leading).text(w);n++}});return {element:e,height:(n+1)*leading};
}
function fact(e,d,s,i,v){return e.attr('data-fact',JSON.stringify({chart:d.key,series:s,category:d.categories?.[i],value:v,sourcePage:d.page,sourceDate:d.source.asOf}))}
function rect(g,x,y,w,h,fill){return g.append('rect').attr('x',x).attr('y',y).attr('width',Math.max(0,w)).attr('height',Math.max(0,h)).attr('fill',fill)}
function base(d){
 const svg=d3.create('svg').attr('xmlns','http://www.w3.org/2000/svg').attr('width',d.width).attr('height',d.height).attr('viewBox',`0 0 ${d.width} ${d.height}`).attr('role','img').attr('aria-label',d.title).attr('data-chart',d.key);
 svg.append('title').text(d.title);svg.append('desc').text(`${d.source.document}; source page ${d.page}; as of ${d.source.asOf}; ${d.extractionMethod}`);
 svg.append('metadata').text(JSON.stringify(d));
 svg.append('style').text('');
 host.appendChild(svg.node());
 rect(svg,0,0,d.width,d.height,C.background).attr('data-chart-background','true');
 const defs=svg.append('defs');
 const pattern=(id,bg,type)=>{const p=defs.append('pattern').attr('id',d.key+'-'+id).attr('patternUnits','userSpaceOnUse').attr('width',8).attr('height',8);rect(p,0,0,8,8,bg);if(type==='dot')p.append('circle').attr('cx',4).attr('cy',4).attr('r',1.15).attr('fill',C.ink).attr('opacity',.7);else p.append('path').attr('d','M-2,2L2,-2 M0,8L8,0 M6,10L10,6').attr('stroke',C.ink).attr('stroke-width',1).attr('opacity',.42);};
 pattern('hatch',C.secondary,'hatch');pattern('dots',C.tertiary,'dot');
 const fills=[C.ink,C.secondary,`url(#${d.key}-hatch)`,C.primary,C.tertiary,`url(#${d.key}-dots)`];
 return {svg,fills};
}
function axis(g,x,y,xd,yd,xTicks,yTicks,opt={}){
 const {left,right,top,bottom}=opt;
 yTicks.forEach(v=>{line(g,left,y(v),right,y(v),v===0?.45:.12,v===0?1.1:.8);text(g,left-10,y(v)+6,opt.yFormat?opt.yFormat(v):fmt(v),'data',{'text-anchor':'end','font-size':opt.fontSize||20});});
 xTicks.forEach(v=>{text(g,x(v),bottom+26,opt.xFormat?opt.xFormat(v):String(v),'data',{'text-anchor':'middle','font-size':opt.fontSize||20});});
}




function scatter(d){
 const {svg}=base(d),w=d.width,h=d.height;
 const box={left:60,right:w-20,top:22,bottom:h-64};
 const x=d3.scaleLinear().domain([Math.min(d.xDomain[0],...(d.points||[]).map(p=>p.year),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.year))),Math.max(d.xDomain[1],...(d.points||[]).map(p=>p.year),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.year)))]).range([box.left,box.right]);const y=d3.scaleLinear().domain([Math.min(d.yDomain[0],...(d.points||[]).map(p=>p.value),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.value))),Math.max(d.yDomain[1],...(d.points||[]).map(p=>p.value),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.value)))]).range([box.bottom,box.top]);
 axis(svg,x,y,d.xDomain,d.yDomain,d.xTicks,d.yTicks,{...box,fontSize:17,yFormat:v=>d.key.includes('model')?String(v)+'B':fmt(v)});
 // Source label names stay verbatim. Anchors are deliberate and do not move observations.
 const chip={
  'TOASTER':[-2,-13,'middle'], 'NVDA P100':[18,-13,'end'], 'NVDA V100':[0,21,'middle'],
  'NVDA A100':[-20,-14,'end'], 'NVDA H100':[-10,0,'end'], 'INTC PONTE VECCHIO':[-8,-25,'end'],
  'NVDA B200':[60,24,'end'], 'NVDA B300, AMD MI355X':[-10,-10,'end'], 'NVDA R100':[-13,4,'end']};
 const model={
  'Megatron-Turing':[12,-13,'start'],'Jurassic-1':[12,13,'start'],'PaLM':[10,5,'start'],
  'GPT-4':[-7,-14,'end'],'GPT-4 Turbo':[0,-14,'middle'],'Grok-4':[-11,3,'end'],
  'Claude 4':[-11,4,'end'],'Gemini 2.5':[-11,5,'end'],'DeepSeek V4':[5,-27,'end']};
 d.points.forEach(p=>{const xx=x(p.year),yy=y(p.value),[dx,dy,anchor]=((d.page===12&&d.key.includes('chip')?chip:model)[p.label] || [0,-12,'middle']);
  svg.append('path').attr('d',d3.symbol().type(d3.symbolSquare).size(72)()).attr('transform',`translate(${xx},${yy}) rotate(45)`).attr('fill',d.key.includes('chip')?C.ink:C.primary).attr('stroke',C.ink).attr('stroke-width',.7).attr('data-observation',p.pdfVectorId);
  text(svg,xx+dx,yy+dy,p.label,'note',{'text-anchor':anchor,'font-style':'normal','font-weight':400}).attr('data-point-label',p.label);
 });
 text(svg,0,h-7,'Approximate readings reconstructed from the source plot.','note');
 return svg;
}
function curves(d){
 const {svg}=base(d),w=d.width,h=d.height,box={left:64,right:w-21,top:23,bottom:h-64};
 const x=d3.scaleLinear().domain([Math.min(d.xDomain[0],...(d.points||[]).map(p=>p.year),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.year))),Math.max(d.xDomain[1],...(d.points||[]).map(p=>p.year),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.year)))]).range([box.left,box.right]),y=d3.scaleLinear().domain([Math.min(d.yDomain[0],...(d.points||[]).map(p=>p.value),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.value))),Math.max(d.yDomain[1],...(d.points||[]).map(p=>p.value),...(d.curves||[]).flatMap(c=>c.annualKnots.map(p=>p.value)))]).range([box.bottom,box.top]);
 axis(svg,x,y,d.xDomain,d.yDomain,d.xTicks,d.yTicks,{...box,fontSize:17});
 d.curves.forEach((s,j)=>{const p=d3.path();p.moveTo(x(s.segments[0][0].year),y(s.segments[0][0].value));s.segments.forEach(a=>p.bezierCurveTo(x(a[1].year),y(a[1].value),x(a[2].year),y(a[2].value),x(a[3].year),y(a[3].value)));
  svg.append('path').attr('d',d.curvesEdited ? d3.line().x(p=>x(p.year)).y(p=>y(p.value)).curve(d3.curveMonotoneX)(s.annualKnots) : p.toString()).attr('fill','none').attr('stroke',j===0?C.ink:C.primary).attr('stroke-width',3).attr('data-curve',s.name);
  const k=s.annualKnots[j===0?8:7];text(svg,x(k.year)-8,y(k.value)-13,s.name,'note',{'text-anchor':'middle','font-weight':400});
  const end=s.annualKnots.at(-1);text(svg,w-1,y(end.value)-12,s.cagr+' CAGR','note',{'text-anchor':'end','font-weight':400});
 });
 text(svg,0,h-7,'Curve positions are reconstructed; values are approximate.','note');return svg;
}


function arrow(g,x1,y1,x2,y2,label,size=18){
 line(g,x1,y1,x2,y2,.85,1.4);
 const a=Math.atan2(y2-y1,x2-x1),s=10;
 g.append('path').attr('d',`M${x2},${y2}L${x2-s*Math.cos(a-.45)},${y2-s*Math.sin(a-.45)}L${x2-s*Math.cos(a+.45)},${y2-s*Math.sin(a+.45)}Z`).attr('fill',C.ink);
 text(g,(x1+x2)/2,(y1+y2)/2-12,label,'data',{'text-anchor':'middle','font-size':size,'font-style':'italic','font-weight':600});
}
function legendItem(g,x,y,label,fill,size=16,dashed=false){
 const sw=rect(g,x,y-12,13,13,fill);if(dashed)sw.attr('fill','none').attr('stroke',C.ink).attr('stroke-dasharray','4 3');
 text(g,x+21,y,label,'data',{'font-size':size});
}
function stacked(d){
 const {svg}=base(d),w=d.width,h=d.height,infra=d.page===14;
 const fills=infra?[C.ink,C.secondary,`url(#${d.key}-hatch)`,C.primary]:[C.ink,C.secondary,`url(#${d.key}-hatch)`,C.primary,C.tertiary,`url(#${d.key}-dots)`];
 const left=10,right=infra?w-154:w-28,bottom=infra?h-42:h-54,top=infra?58:37;
 const x=d3.scaleBand().domain(d.categories).range([left,right]).paddingInner(infra?.40:.45).paddingOuter(.15);
 const max=d3.max(d.categories,(_,i)=>d3.sum(d.series,s=>s.values[i])) || 1;
 const y=d3.scaleLinear().domain([0,max]).range([bottom,top]);
 line(svg,left,bottom,right,bottom,.3);
 d.categories.forEach((cat,i)=>{
  let cum=0;const col=[];
  d.series.forEach((s,j)=>{const v=s.values[i],yb=y(cum),yt=y(cum+v),hh=yb-yt;
   rect(svg,x(cat),yt,x.bandwidth(),hh,fills[j]).attr('stroke',C.background).attr('stroke-width',.7).attr('data-series',s.name);
   let xx=x(cat)+x.bandwidth()/2,yy=(yb+yt)/2+5,anchor='middle',outside=false;
   if(!infra&&j===1){xx=x(cat)+x.bandwidth()+3;anchor='start';yy=(yb+yt)/2+5;outside=true;}
   if(infra&&i===0&&j===3){xx=x(cat)+x.bandwidth()+4;anchor='start';outside=true;}
   // Thin printed slices keep their original location, with a small same-color halo.
   const label=text(svg,xx,yy,(infra?'$':'')+fmt(v,infra?1:0),'data',{'text-anchor':anchor,'font-size':infra?18:15,'font-weight':600,'fill':!outside&&j===0?C.background:C.ink});
   if(hh<17&&!outside)label.attr('paint-order','stroke').attr('stroke',j===0?C.ink:C.background).attr('stroke-width',1.5);
   fact(label,d,s.name,i,v);col.push({j,yt,yb});cum+=v;
  });
  fact(text(svg,x(cat)+x.bandwidth()/2,y(cum)-11,(infra?'$':'')+fmt(d.reportedTotals[i],infra?1:0),'data',{'text-anchor':'middle','font-size':infra?19:16,'font-weight':600}),d,'Printed total',i,d.reportedTotals[i]);
  text(svg,x(cat)+x.bandwidth()/2,bottom+27,cat,'data',{'text-anchor':'middle','font-size':infra?18:15});
  if(infra&&i===d.categories.length-1){
   text(svg,w-67,22,'Segment CAGR','data',{'text-anchor':'middle','font-size':16,'font-weight':600});
   text(svg,w-67,44,'(’25–’30E)','note',{'text-anchor':'middle','font-size':16});
   line(svg,w-132,8,w-132,bottom+4,.16);
   col.forEach(({j,yt,yb})=>{const yy=(yt+yb)/2,xx=w-113;
    rect(svg,xx,yy-12,96,25,fills[j]);text(svg,xx+48,yy+6,d.series[j].cagr || '','data',{'text-anchor':'middle','font-size':18,'font-style':'italic','font-weight':600,'fill':j===0?C.background:C.ink});
   });
  }
 });
 if(infra){
  d.series.forEach((s,j)=>legendItem(svg,7,22+j*25,s.name,fills[j],16));
  rect(svg,193,88,278,96,C.tertiary).attr('rx',8).attr('stroke',C.primary).attr('stroke-dasharray','5 4');
  wrap(svg,332,110,d.note,254,'data',21,{'text-anchor':'middle','font-size':16,'font-style':'italic','font-weight':600});
 }else{
  const positions=[0,145,305,390,540,708];d.series.forEach((s,j)=>legendItem(svg,positions[j],h-5,s.name,fills[j],15));
 }
 return svg;
}
function grouped(d){
 const {svg}=base(d),w=d.width,h=d.height,left=10,right=w-10,bottom=h-82;
 const x=d3.scaleBand().domain(d.categories).range([left,right]).paddingInner(.21).paddingOuter(.05);
 const sub=d3.scaleBand().domain(d.series.map(s=>s.name)).range([0,x.bandwidth()]).padding(.16);
 const vs=d.series.flatMap(s=>s.values).filter(v=>v!==null);const y=d3.scaleLinear().domain([Math.min(-300,d3.min(vs)*1.1),Math.max(1650,d3.max(vs)*1.1)]).range([bottom,105]);
 d.categories.forEach((c,i)=>{const cx=x(c)+x.bandwidth()/2;
  rect(svg,cx-41,4,82,35,'none').attr('stroke',C.ink).attr('stroke-dasharray','6 4').attr('stroke-width',1.2);
  text(svg,cx,27,d.margins[i],'data',{'text-anchor':'middle','font-size':18,'font-weight':600});
 });
 arrow(svg,x(d.categories[0])+x.bandwidth()/2,146,x(d.categories.at(-1))+x.bandwidth()/2,67,d.cagr,18);
 line(svg,left,y(0),right,y(0),.28);
 d.series.forEach((s,j)=>s.values.forEach((v,i)=>{
  if(v===null)return;const xx=x(d.categories[i])+sub(s.name);rect(svg,xx,Math.min(y(v),y(0)),sub.bandwidth(),Math.abs(y(v)-y(0)),j===0?C.ink:C.primary);
  fact(text(svg,xx+sub.bandwidth()/2,v<0?y(0)-6:y(v)-9,(v<0?'($'+fmt(-v)+')':'$'+fmt(v)),'data',{'text-anchor':'middle','font-size':18,'font-weight':600}),d,s.name,i,v);
 }));
 d.categories.forEach(c=>text(svg,x(c)+x.bandwidth()/2,h-46,c,'data',{'text-anchor':'middle','font-size':18,'font-weight':600}));
 legendItem(svg,58,h-8,d.series[0].name,C.ink,16);legendItem(svg,279,h-8,d.series[1].name,C.primary,16);legendItem(svg,543,h-8,'LQA Adj. EBITDA Margin (%)',C.ink,16,true);
 return svg;
}
function balance(d){
 const {svg}=base(d),w=d.width,h=d.height,[notes,lease,cash,net]=d.series.map(s=>s.values.find(v=>v!==null)),gross=d.reportedTotals[0],stackTotal=notes+lease;
 const bottom=302,top=36,y=d3.scaleLinear().domain([0,Math.max(10000,stackTotal*1.05,gross*1.05,cash*1.05,net*1.05)]).range([bottom,top]),xs=[42,158,274],bw=66;
 line(svg,8,bottom,w-7,bottom,.32);
 rect(svg,xs[0],y(notes),bw,bottom-y(notes),C.ink);rect(svg,xs[0],y(stackTotal),bw,y(notes)-y(stackTotal),C.secondary);
 rect(svg,xs[1],y(cash),bw,bottom-y(cash),C.primary);rect(svg,xs[2],y(net),bw,bottom-y(net),C.tertiary).attr('stroke',C.ink).attr('stroke-width',.8);
 fact(text(svg,xs[0]+bw/2,(bottom+y(notes))/2+6,'$'+fmt(notes),'data',{'text-anchor':'middle','font-size':18,'font-weight':600,'fill':C.background}),d,d.series[0].name,0,notes);
 fact(text(svg,xs[0]+bw/2,(y(stackTotal)+y(notes))/2+6,'$'+fmt(lease),'data',{'text-anchor':'middle','font-size':18,'font-weight':600}),d,d.series[1].name,0,lease);
 rect(svg,xs[0]-7,y(gross)-38,bw+14,29,'none').attr('stroke',C.ink).attr('stroke-dasharray','5 4');
 fact(text(svg,xs[0]+bw/2,y(gross)-17,'$'+fmt(gross),'data',{'text-anchor':'middle','font-size':18,'font-weight':600}),d,'Printed total',0,gross);
 fact(text(svg,xs[1]+bw/2,(bottom+y(cash))/2+6,'$'+fmt(cash),'data',{'text-anchor':'middle','font-size':18,'font-weight':600}),d,d.series[2].name,1,cash);
 fact(text(svg,xs[2]+bw/2,y(net)-12,'$'+fmt(net)+'†','data',{'text-anchor':'middle','font-size':18,'font-weight':600}),d,d.series[3].name,2,net);
 rect(svg,xs[2]-1,221,bw+2,29,'none').attr('stroke',C.primary).attr('stroke-dasharray','5 4');text(svg,xs[2]+bw/2,242,d.multiple.split(':').at(-1).trim(),'data',{'text-anchor':'middle','font-size':18,'font-weight':600});
 // Preserve the original legend arrangement while explicitly flagging the source mismatch.
 legendItem(svg,8,331,d.series[1].name+'†',C.secondary,15);legendItem(svg,194,331,d.series[0].name,C.ink,15);
 legendItem(svg,8,355,d.series[2].name,C.primary,15);legendItem(svg,194,355,d.series[3].name+'†',C.tertiary,15);
 legendItem(svg,8,379,'Total Gross Debt',C.ink,15,true);legendItem(svg,194,379,'Net Debt / LQA Adj. EBITDA',C.ink,14,true);
 wrap(svg,8,411,d.legendFootnote,w-14,'note',19,{'font-size':15});
 return svg;
}
function single(d){
 const {svg}=base(d),w=d.width,h=d.height,vs=d.series[0].values,left=12,right=w-12;
 const x=d3.scaleBand().domain(d.categories).range([left,right]).paddingInner(.43).paddingOuter(.20);
 const neg=d3.min(vs.filter(v=>v!==null))<0,max=Math.max(0,d3.max(vs)||0),min=Math.min(0,d3.min(vs)||0),bottom=h-37;
 const y=d3.scaleLinear().domain([neg?min*1.15:0,neg?Math.max(max*3.9,Math.abs(min)*.3):Math.max(1,max*(d.cagr?1.22:1.15))]).range([bottom,d.cagr?79:20]);
 line(svg,left,y(0),right,y(0),.25);
 vs.forEach((v,i)=>{if(v===null)return;const xx=x(d.categories[i]);rect(svg,xx,Math.min(y(v),y(0)),x.bandwidth(),Math.abs(y(v)-y(0)),C.primary);
  fact(text(svg,xx+x.bandwidth()/2,v<0?y(v)+23:y(v)-12,v<0?'($'+fmt(-v,1)+')':'$'+fmt(v,1),'data',{'text-anchor':'middle','font-size':19,'font-weight':600}),d,d.series[0].name,i,v);
 });
 d.categories.forEach(c=>text(svg,x(c)+x.bandwidth()/2,h-7,c,'data',{'text-anchor':'middle','font-size':18,'font-weight':600}));
 if(d.cagr)arrow(svg,x(d.categories[1])+x.bandwidth()/2,77,x(d.categories.at(-1))+x.bandwidth()/2,21,d.cagr,18);
 return svg;
}
function tiers(d){
 const {svg}=base(d),w=d.width,h=d.height,ox=8,oy=h-8,R=w-24;
 // Concentric quarter-circles and source city order, not a replacement table.
 const band=(r0,r1,fill)=>svg.append('path').attr('d',`M${ox},${oy-r1}A${r1},${r1} 0 0 1 ${ox+r1},${oy}L${ox+r0},${oy}A${r0},${r0} 0 0 0 ${ox},${oy-r0}Z`).attr('fill',fill).attr('stroke',C.ink).attr('stroke-width',1.4);
 band(0,R*.48,C.ink);band(R*.48,R*.76,C.secondary);band(R*.76,R,C.primary);
 const angles=[[69,49,24],[77,61,45,29,17,9],[78,64,52,42,34,25,17,8]],radii=[.48,.76,1];
 const shifts=[[[0,25],[-5,25],[-12,23]],[[0,26],[0,26],[-8,25],[-26,24],[-14,23],[-12,13]],[[0,27],[0,26],[-8,24],[-13,24],[-24,24],[-22,23],[-30,11],[-23,14]]];
 d.tiers.forEach((t,j)=>{const r=R*radii[j];t.cities.forEach((city,i)=>{const a=angles[j][i]*Math.PI/180,cx=ox+r*Math.cos(a),cy=oy-r*Math.sin(a),highlight=city===d.highlight;
  svg.append('path').attr('d',d3.symbol().type(highlight?d3.symbolStar:d3.symbolCircle).size(highlight?255:64)()).attr('transform',`translate(${cx},${cy})`).attr('fill',j===0?C.secondary:C.ink);
  const [dx,dy]=shifts[j][i];const labelX=city==='New York City'?92:city==='Hillsborough'?106:cx+dx;const labelWidth=city==='New York City'?70:city==='Los Angeles'?82:city==='Salt Lake City'?73:94;wrap(svg,labelX,cy+dy,city,labelWidth,'data',19,{'text-anchor':'end','font-size':15,'font-weight':highlight?600:400,'fill':j===0?C.background:C.ink});
 });});
 text(svg,16,h-27,d.tiers[0].name,'data',{'font-size':15,'fill':C.background});text(svg,16,h-R*.54,d.tiers[1].name,'data',{'font-size':15});text(svg,16,h-R*.85,d.tiers[2].name,'data',{'font-size':15});
 text(svg,w-2,18,d.direction,'note',{'text-anchor':'end','font-size':15,'font-style':'normal'});
 return svg;
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
 const {svg}=base(d),w=d.width,h=d.height,phaseW=w/3,cols=[C.ink,C.primary,C.secondary];
 d.phases.forEach((p,i)=>{const x=i*phaseW;svg.append('path').attr('d',`M${x},0H${x+phaseW-20}L${x+phaseW},26L${x+phaseW-20},52H${x}L${x+20},26Z`).attr('fill',cols[i]);text(svg,x+phaseW/2,34,p.title,'data',{'text-anchor':'middle','font-size':24,'font-weight':600,'fill':i===0?C.background:C.ink});});
 const events=d.phases.flatMap((p,j)=>p.events.map(e=>({...e,phase:j}))),step=(w-200)/8;
 // Keep nine milestones in their original alternating top/bottom reading order.
 const centers=events.map((_,i)=>[100+step*i,i%2?403:327]);
 svg.append('path').attr('d',d3.line()(centers)).attr('fill','none').attr('stroke',C.secondary).attr('stroke-width',5);
 events.forEach((e,i)=>{const [cx,cy]=centers[i],top=i%2===0,color=cols[e.phase];
  svg.append('circle').attr('cx',cx).attr('cy',cy).attr('r',47).attr('fill',C.background).attr('stroke',color).attr('stroke-width',7);glyph(svg,cx,cy,i,C.ink);
  svg.append('path').attr('d',d3.symbol().type(d3.symbolTriangle).size(135)()).attr('transform',`translate(${cx},${top?268:472}) rotate(${top?0:180})`).attr('fill',C.ink);
  const tx=Math.min(w-161,Math.max(161,cx));text(svg,tx,top?95:518,e.date,'heading',{'text-anchor':'middle','font-size':30});
  const eText=wrap(svg,tx,top?129:554,e.description,316,'data',24,{'text-anchor':'middle','font-size':20}).element;
  eText.selectAll('tspan').each(function(){const parts=this.textContent.split(/(C[1-5])/g);if(parts.length<2)return;this.textContent='';parts.forEach(s=>{const el=document.createElementNS('http://www.w3.org/2000/svg','tspan');el.textContent=s;if(/^C[1-5]$/.test(s)){el.setAttribute('fill','#84601E');el.setAttribute('font-size','13');el.setAttribute('baseline-shift','super');el.setAttribute('data-evidence',s);}this.appendChild(el)});});
 });return svg;
}
function gantt(d){
 const {svg,fills}=base(d),w=d.width,h=d.height,phaseW=158,taskW=480,left=phaseW+taskW,right=w-4,top=55,rowH=23.4,bottom=top+26*rowH;
 const x=d3.scaleLinear().domain([0,1]).range([left,right]);
 d.ticks.forEach((m,i)=>{const xc=x((i+.5)/19),parts=m.match(/^(\w+)’(\d+)\s*\((M\d+)\)$/);rect(svg,x(i/19),0,(right-left)/19-1,top-2,i%2?C.background:C.tertiary);text(svg,xc,21,parts ? parts[1]+'’'+parts[2] : m,'data',{'text-anchor':'middle','font-size':15,'font-weight':600});text(svg,xc,44,parts ? '('+parts[3]+')' : '','data',{'text-anchor':'middle','font-size':15});});
 rect(svg,phaseW+12,top,taskW-12,bottom-top,C.tertiary).attr('opacity',.23);
 d.phases.forEach((p,j)=>{const yy=top+p.firstRow*rowH,hh=p.rowCount*rowH,fill=fills[j%fills.length];
  rect(svg,0,yy,phaseW-7,hh-1,fill);const light=j%fills.length===0;const icon=svg.append('g').attr('transform',`translate(${(phaseW-7)/2},${yy+hh/2-15}) scale(.62)`);glyph(icon,0,0,j+2,light?C.background:C.ink);
  wrap(svg,(phaseW-7)/2,yy+hh/2+21,p.label,phaseW-15,'data',17,{'text-anchor':'middle','font-size':15,'font-weight':600,'fill':light?C.background:C.ink});
 });
 d.tasks.forEach((t,i)=>{const yy=top+i*rowH,j=d.phases.findIndex(p=>i>=p.firstRow&&i<p.firstRow+p.rowCount),fill=fills[j%fills.length];
  text(svg,phaseW+12,yy+16,t.label,'data',{'font-size':15,'font-style':'italic'});line(svg,phaseW+12,yy,w,yy,.38,.8).attr('stroke-dasharray','6 4');
  if(t.milestone)svg.append('path').attr('d',d3.symbol().type(d3.symbolDiamond).size(78)()).attr('transform',`translate(${x(t.start)},${yy+rowH/2})`).attr('fill',fill).attr('stroke',C.ink).attr('stroke-width',.7);
  else{const a=x(t.start),b=x(t.end),y=yy+4,z=rowH-8;svg.append('path').attr('d',`M${a},${y}H${b-8}L${b},${y+z/2}L${b-8},${y+z}H${a}Z`).attr('fill',fill).attr('stroke',C.ink).attr('stroke-opacity',.25).attr('stroke-width',.5);}
 });
 const label=(xx,yy,s,width)=>{const t=wrap(svg,xx,yy+23,s,width-16,'data',21,{'text-anchor':'middle','font-size':17,'font-style':'italic','font-weight':600});const height=t.height+17;svg.insert('rect',()=>t.element.node()).attr('x',xx-width/2).attr('y',yy).attr('width',width).attr('height',height).attr('rx',6).attr('fill',C.background).attr('stroke',C.primary).attr('stroke-width',1.5);return height;};
 line(svg,x(d.tasks[0].start),top+13,x(d.tasks[0].start),top+54,.8,1.5).attr('stroke-dasharray','4 3');label(x(d.tasks[0].start),top+55,'Project Start Date',198);
 const endX=x(d.tasks.at(-1).end),endY=top+21.25*rowH;const hh=label(Math.min(endX,w-95),endY,'Projected Project End Date',172);line(svg,endX,endY+hh,endX,top+25.5*rowH,.8,1.5).attr('stroke-dasharray','4 3');
 return svg;
}

const renderers={stacked,grouped,balance,single,scatter,curves,timeline,gantt,tiers};
return renderers[figure.kind](figure).node();
}
