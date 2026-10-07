/** Geometry for source-bound labels; never changes a chart value or slice. */
export type InkBox = { left:number; top:number; right:number; bottom:number };
type Sector = { cx:number; cy:number; inner:number; outer:number; start:number; end:number };
const tau=Math.PI*2,mod=(v:number)=>(v%tau+tau)%tau;

export function inkInsideSector(box:InkBox,s:Sector,pad=1):boolean {
 const sign=s.end>=s.start?1:-1,sweep=Math.abs(s.end-s.start);
 const nearX=Math.max(box.left,Math.min(s.cx,box.right)),nearY=Math.max(box.top,Math.min(s.cy,box.bottom));
 if(Math.hypot(nearX-s.cx,nearY-s.cy)<s.inner+pad)return false;
 for(const x of [box.left,box.right])for(const y of [box.top,box.bottom]){
  const distance=Math.hypot(x-s.cx,y-s.cy);
  if(distance>s.outer-pad||sweep<tau-1e-6&&mod(sign*(Math.atan2(x-s.cx,s.cy-y)-s.start))>sweep)return false;
 }
 // A reflex sector is not convex: its excluded ray can cross a rectangle
 // whose four corners are all inside. Check the two boundary rays as well.
 if(sweep<tau-1e-6)for(const angle of [s.start,s.end]){
  let lo=s.inner,hi=s.outer;
  for(const [origin,direction,min,max] of [[s.cx,Math.sin(angle),box.left-pad,box.right+pad],[s.cy,-Math.cos(angle),box.top-pad,box.bottom+pad]]){
   if(Math.abs(direction)<1e-9){if(origin<min||origin>max){hi=-1;break;}}
   else{const a=(min-origin)/direction,b=(max-origin)/direction;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
  }
  if(hi>lo&&hi>0)return false;
 }
 return true;
}

const shift=(b:InkBox,x:number,y:number):InkBox=>({left:b.left+x,right:b.right+x,top:b.top+y,bottom:b.bottom+y});
const overlaps=(a:InkBox,b:InkBox)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+.5&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+.5;

/** Keep source placement when possible. Move within the bound sector before
 * reducing type size; return an explicit unresolved fit instead of hiding text. */
export function fitPieLabel(s:Sector,source:{x:number;y:number;font:number},
 measure:(font:number)=>InkBox,occupied:InkBox[]=[]) {
 const fits=(box:InkBox)=>inkInsideSector(box,s)&&!occupied.some(other=>overlaps(box,other));
 const first=measure(source.font),original=shift(first,source.x,source.y);
 if(fits(original))return {...source,box:original,fitted:true};
 const centerX=(original.left+original.right)/2,centerY=(original.top+original.bottom)/2;
 const radius=Math.hypot(centerX-s.cx,centerY-s.cy),direction=s.end>=s.start?1:-1,sweep=Math.abs(s.end-s.start);
 const mid=(s.start+s.end)/2,sourceAngle=Math.atan2(centerX-s.cx,s.cy-centerY);
 // Unwrap the source angle into the same revolution as the arc midpoint.
 const angle=mid+Math.atan2(Math.sin(sourceAngle-mid),Math.cos(sourceAngle-mid));
 const angles=[angle,mid,...Array.from({length:33},(_,i)=>s.start+direction*sweep*i/32)];
 const radii=[radius,...Array.from({length:13},(_,i)=>s.inner+(s.outer-s.inner)*(i+1)/14)];
 for(const factor of [1,.95,.9,.85,.8,.75,.7,.65,.6]){
  const font=source.font*factor,b=measure(font),ox=(b.left+b.right)/2,oy=(b.top+b.bottom)/2;
  let best:{x:number;y:number;font:number;box:InkBox;fitted:boolean;distance:number}|undefined;
  // Local offsets repair small OCR baseline drift without snapping labels to
  // the arc centre. Polar candidates cover genuinely changed slice geometry.
  const candidates:[number,number][]=[];
  for(const dx of [0,-.1,.1,-.25,.25,-.5,.5,-1,1])for(const dy of [0,-.1,.1,-.25,.25,-.5,.5,-1,1])candidates.push([centerX+dx*source.font,centerY+dy*source.font]);
  for(const a of angles)for(const r of radii)candidates.push([s.cx+Math.sin(a)*r,s.cy-Math.cos(a)*r]);
  for(const [cx,cy] of candidates){
   const x=cx-ox,y=cy-oy,box=shift(b,x,y),distance=Math.hypot(cx-centerX,cy-centerY);
   if((!best||distance<best.distance)&&fits(box))best={x,y,font,box,fitted:true,distance};
  }
  if(best)return best;
 }
 return {...source,box:original,fitted:false};
}
