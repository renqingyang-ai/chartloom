import { forwardRef, useLayoutEffect, useRef } from 'react';
import { path as d3Path, scaleLinear, select } from 'd3';
import { OM_COMPONENT_THEME as theme } from './theme';

/** Source geographic geometry + editable text. Shared by page/editor/export. */
export const GeographicMap=forwardRef<SVGSVGElement,{figure:any;standalone?:boolean}>(function GeographicMap({figure,standalone=false},ref){
 const host=useRef<SVGSVGElement>(null);
 useLayoutEffect(()=>{
  const svg=host.current;if(!svg)return;let active=true;
  const draw=()=>{
   if(!active)return;const geometry=figure.nativeGeography,region=geometry.region,[bx,by,bw,bh]=region;
   const w=1000,h=w*bh/bw/(figure.sourceAspect||16/9),heading=standalone?48:0;
   const x=scaleLinear().domain([bx,bx+bw]).range([0,w]),y=scaleLinear().domain([by,by+bh]).range([0,h]);
   const palette:any={ink:theme.colors.ink,neutral:'#E7E5DF',muted:'#87918A',accent:theme.colors.primary};
   const spatialPalette=['#D9E2DC','#D0B795','#E7E6E2','#B5C0B9','#A9ACA0','#DDD3C3','#E5DACE','#CAD4D1'];
   const spatial=geometry.geometryKind==='spatial';
   const root=select(svg);root.selectAll('*').remove();root.attr('viewBox',`0 0 ${w} ${h+heading}`).attr('width',w).attr('height',h+heading);
   root.append('title').text(figure.title||'Geographic map');
   root.append('rect').attr('width',w).attr('height',h+heading).attr('fill',theme.colors.background);
   if(heading)root.append('text').attr('x',14).attr('y',30).attr('font-size',25).attr('font-family',theme.font.heading.family).text(figure.title);
   const content=root.append('g').attr('transform',`translate(0,${heading})`);
   const pathFor=(shape:any)=>{
    const p=d3Path();let last:number[]|undefined;
    for(const command of shape.commands){
     const [kind,...points]=command;
     if(kind==='rect'){const [a,b,c,d]=points[0];p.rect(x(a),y(b),x(a+c)-x(a),y(b+d)-y(b));last=undefined;continue;}
     if(kind==='quad'){p.moveTo(x(points[0][0]),y(points[0][1]));for(const q of points.slice(1))p.lineTo(x(q[0]),y(q[1]));p.closePath();last=undefined;continue;}
     const start=points[0];if(!last||Math.abs(start[0]-last[0])>.003||Math.abs(start[1]-last[1])>.003)p.moveTo(x(start[0]),y(start[1]));
     if(kind==='l')p.lineTo(x(points[1][0]),y(points[1][1]));
     if(kind==='c')p.bezierCurveTo(x(points[1][0]),y(points[1][1]),x(points[2][0]),y(points[2][1]),x(points[3][0]),y(points[3][1]));
     last=points.at(-1);
    }
    if(shape.closed)p.closePath();return p.toString();
   };
   content.selectAll('path').data(geometry.shapes).join('path').attr('d',pathFor).attr('data-map-layer',(s:any)=>s.layer)
    .attr('fill',(s:any)=>s.fill?(spatial?(s.paletteIndex===undefined?theme.colors.background:spatialPalette[s.paletteIndex%spatialPalette.length]):palette[s.role]): 'none').attr('stroke',(s:any)=>spatial?(s.stroke?'#69756B':'none'):['geography','marker'].includes(s.layer)?theme.colors.background:s.layer==='leader'?(s.role==='accent'?'#A88B61':'#63736A'):palette[s.role])
    .attr('stroke-width',(s:any)=>spatial?1:s.layer==='marker'?3:s.layer==='geography'?1.4:1.8).attr('stroke-dasharray',(s:any)=>spatial?(s.dashes?.length?s.dashes.join(' '):null):s.layer==='leader'?'5 3':null);
   content.selectAll('text').data(figure.mapLabels||[]).join('text').attr('data-map-label',(l:any)=>l.id)
    .attr('x',(l:any)=>l.x/100*w).attr('y',(l:any)=>l.y/100*h+l.fontSize*.88)
    .attr('fill',(l:any)=>l.role==='accent'?'#856B48':theme.colors.ink).attr('font-family',theme.font.data.family)
    .attr('font-size',(l:any)=>l.fontSize).attr('font-weight',450).text((l:any)=>l.text);
   // Actual font metrics, not a fixed character count. Make source-line runs
   // fit their native slot; never compress below a readable source font.
   content.selectAll<SVGTextElement,any>('text').each(function(l){const width=Math.max(l.width/100*w,5),actual=this.getComputedTextLength();
    if(actual>width*1.06){const size=Math.max(l.fontSize*.8,l.fontSize*width/actual);select(this).attr('font-size',size);}
   });
  };
  draw();void document.fonts.ready.then(draw);return()=>{active=false;};
 },[figure,standalone]);
 return <svg ref={e=>{host.current=e;if(typeof ref==='function')ref(e);else if(ref)ref.current=e;}} data-testid="pipeline-figure" data-kind={figure.kind} data-map-component={figure.kind==='map'?'native-geography-v1':'native-spatial-v1'} xmlns="http://www.w3.org/2000/svg" style={{width:'100%',height:standalone?'auto':'100%',display:'block'}}/>;
});
