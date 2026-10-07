/** Runs inside the browser; checks actual SVG geometry after the OM fonts load. */
export function ganttDomChecks() {
 const policy=globalThis.__chartValidation?.visual; if(!policy)throw new Error("Missing pinned visual validation rules");
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > policy.ganttCollisionPixels && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > policy.ganttCollisionPixels;
  return [...document.querySelectorAll('svg[data-component="shared-gantt-v1"]')].map(svg => {
    const bounds = svg.getBoundingClientRect();
    const labels = [...svg.querySelectorAll('[data-gantt-label]')].map(el => ({ text: el.textContent, role: el.getAttribute('data-gantt-label'), box: el.getBoundingClientRect() }));
    const issues = [];
    for (let i = 0; i < labels.length; i++) {
      const a = labels[i];
      if (a.box.left < bounds.left - policy.boundsTolerancePixels || a.box.right > bounds.right + policy.boundsTolerancePixels || a.box.top < bounds.top - policy.boundsTolerancePixels || a.box.bottom > bounds.bottom + policy.boundsTolerancePixels) issues.push(`Label out of bounds: ${a.text}`);
      for (let j = i + 1; j < labels.length; j++) if (overlaps(a.box, labels[j].box)) issues.push(`Overlapping ${a.role}/${labels[j].role}: ${a.text} / ${labels[j].text}`);
    }
    for (const box of svg.querySelectorAll('[data-gantt-annotation] > rect')) for (const bar of svg.querySelectorAll('[data-gantt-mark]')) if (overlaps(box.getBoundingClientRect(), bar.getBoundingClientRect())) issues.push('A callout obscures a task bar or milestone.');
    return { elementId: svg.closest('[data-element-id]')?.getAttribute('data-element-id'), component: svg.getAttribute('data-component'), tasks: svg.querySelectorAll('[data-gantt-task]').length, phases: svg.querySelectorAll('[data-gantt-phase]').length, ticks: svg.querySelectorAll('[data-gantt-tick]').length, annotations: svg.querySelectorAll('[data-gantt-annotation]').length, issues: [...new Set(issues)] };
  });
}

/** Shared SVG checks for all registered components, including live upload pages. */
export function componentDomChecks(){
 const policy=globalThis.__chartValidation?.visual; if(!policy)throw new Error("Missing pinned visual validation rules");
 const context=document.createElement('canvas').getContext('2d');
 // SVG text bounding boxes include font ascent/descent whitespace. Measure
 // painted glyphs so a serif font's empty em box is not reported as clipping.
 const glyphBounds=el=>{
  const nodes=[...el.querySelectorAll('tspan')];if(!nodes.length)nodes.push(el);
  const points=[],polygons=[];
  for(const n of nodes){if(!n.textContent?.trim()||!n.getNumberOfChars())continue;
   const style=getComputedStyle(n);context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
   const m=context.measureText(n.textContent),p=n.getStartPositionOfChar(0),matrix=n.getScreenCTM();if(!matrix)continue;
   const polygon=[[p.x-m.actualBoundingBoxLeft,p.y-m.actualBoundingBoxAscent],[p.x+m.actualBoundingBoxRight,p.y-m.actualBoundingBoxAscent],[p.x+m.actualBoundingBoxRight,p.y+m.actualBoundingBoxDescent],[p.x-m.actualBoundingBoxLeft,p.y+m.actualBoundingBoxDescent]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
   points.push(...polygon);polygons.push(polygon);
  }
  return points.length?{left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)),polygons}:el.getBoundingClientRect();
 };
 // Rotated labels have overlapping axis-aligned boxes even when the glyphs
 // are separate. Use their rotated rectangles for the actual collision test.
 const intersect=(a,b)=>[a,b].every(poly=>poly.every((p,i)=>{
  const q=poly[(i+1)%poly.length],length=Math.hypot(q.x-p.x,q.y-p.y);if(!length)return true;
  const nx=-(q.y-p.y)/length,ny=(q.x-p.x)/length,pa=a.map(v=>v.x*nx+v.y*ny),pb=b.map(v=>v.x*nx+v.y*ny);
  return Math.min(Math.max(...pa),Math.max(...pb))-Math.max(Math.min(...pa),Math.min(...pb))>policy.glyphCollisionPixels;
 }));
 return [...document.querySelectorAll('svg[data-component]')].map(svg=>{
  const bounds=svg.getBoundingClientRect(),texts=[...svg.querySelectorAll('text')].filter(e=>e.textContent?.trim()).map(e=>({text:e.textContent,box:glyphBounds(e)})),issues=[];
  for(let i=0;i<texts.length;i++){
   const a=texts[i],b=a.box;if(b.left<bounds.left-policy.boundsTolerancePixels||b.right>bounds.right+policy.boundsTolerancePixels||b.top<bounds.top-policy.boundsTolerancePixels||b.bottom>bounds.bottom+policy.boundsTolerancePixels)issues.push(`Label outside component: ${a.text}`);
   for(let j=i+1;j<texts.length;j++){const c=texts[j].box;if(Math.min(b.right,c.right)-Math.max(b.left,c.left)>policy.glyphCollisionPixels&&Math.min(b.bottom,c.bottom)-Math.max(b.top,c.top)>policy.glyphCollisionPixels&&(!b.polygons||!c.polygons||b.polygons.some(p=>c.polygons.some(q=>intersect(p,q)))))issues.push(`Overlapping labels: ${a.text} / ${texts[j].text}`);}
  }
  for(const e of svg.querySelectorAll('*'))for(const a of e.attributes)if(['d','x','y','width','height','cx','cy','transform','viewBox'].includes(a.name)&&/NaN|Infinity/.test(a.value))issues.push('Non-finite SVG geometry.');
  if(svg.getAttribute('data-layout-error'))issues.push(svg.getAttribute('data-layout-error'));
  if(svg.getAttribute('data-component')==='source-layout-v1'){
   const bars=[...svg.querySelectorAll('[data-layer="marks"] rect[data-mark]')].map(el=>({id:el.getAttribute('data-mark'),box:el.getBoundingClientRect()}));
   const overlap=(a,b)=>({width:Math.min(a.right,b.right)-Math.max(a.left,b.left),height:Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)});
   for(let i=0;i<bars.length;i++)for(let j=i+1;j<bars.length;j++){
    const a=bars[i],b=bars[j],crossCategory=a.id.split(':')[1]!==b.id.split(':')[1],v=overlap(a.box,b.box);
    if(v.width>policy.barOverlapPixels&&v.height>policy.barOverlapPixels&&(crossCategory||svg.getAttribute('data-chart-kind')!=='stacked-bar'))issues.push(`Overlapping data bars: ${a.id} / ${b.id}`);
   }
   for(const label of svg.querySelectorAll('[data-layer="axes"] text')){
    const b=glyphBounds(label),area=(b.right-b.left)*(b.bottom-b.top);
    if(area<=0)continue;
    for(const bar of bars){const v=overlap(b,bar.box);
     if(v.width>0&&v.height>0&&v.width*v.height/area>policy.axisObscuredFraction){issues.push(`Axis label obscured by data bar: ${label.textContent}`);break;}
    }
   }
  }
  if(svg.querySelector('image'))issues.push('A registered data figure contains a raster image.');
  return {elementId:svg.closest('[data-element-id]')?.getAttribute('data-element-id'),component:svg.getAttribute('data-component'),kind:svg.getAttribute('data-kind'),labels:texts.length,issues:[...new Set(issues)].slice(0,100)};
 });
}

/** Whole-page omissions and text collisions cannot pass as component success. */
export function pageFidelityChecks(){
 const policy=globalThis.__chartValidation?.visual; if(!policy)throw new Error("Missing pinned visual validation rules");
 const issues=[];
 for(const svg of document.querySelectorAll('[data-map-component]')){
  const elementId=svg.closest('[data-element-id]')?.getAttribute('data-element-id'),bounds=svg.getBoundingClientRect();
  const labels=[...svg.querySelectorAll('[data-map-label]')].map(e=>({text:e.textContent,box:e.getBoundingClientRect()}));
  for(let i=0;i<labels.length;i++){
   const a=labels[i],b=a.box;
   if(b.left<bounds.left-policy.boundsTolerancePixels||b.right>bounds.right+policy.boundsTolerancePixels||b.top<bounds.top-policy.boundsTolerancePixels||b.bottom>bounds.bottom+policy.boundsTolerancePixels)issues.push({elementId,kind:'layout',severity:'error',description:'地图文字超出边界：'+a.text});
   for(let j=i+1;j<labels.length;j++){const c=labels[j].box;
    if(Math.min(b.right,c.right)-Math.max(b.left,c.left)>policy.mapCollisionPixels&&Math.min(b.bottom,c.bottom)-Math.max(b.top,c.top)>policy.mapCollisionPixels)issues.push({elementId,kind:'layout',severity:'error',description:`地图文字重叠：${a.text} / ${labels[j].text}`});
   }
  }
 }
 for(const el of document.querySelectorAll('[data-asset-missing]'))issues.push({elementId:el.closest('[data-element-id]')?.getAttribute('data-element-id'),kind:'missing',severity:'error',description:el.textContent});
 return issues;
}
