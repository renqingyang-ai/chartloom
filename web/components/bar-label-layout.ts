import type {InkBox} from './pie-label-layout';

/** Fit painted glyphs, not SVG line-box whitespace. Preserve a usable source
 * anchor; repair a near-edge anchor before it shrinks a value into a dot. */
export function fitBarInk(rect:InkBox,source:{x:number;y:number;font:number},
 measure:(font:number)=>InkBox) {
 const padX=Math.min(1.5,(rect.right-rect.left)*.05),padY=Math.min(1.5,(rect.bottom-rect.top)*.05);
 const left=rect.left+padX,right=rect.right-padX,top=rect.top+padY,bottom=rect.bottom-padY;
 const ink=measure(source.font),width=ink.right-ink.left,height=ink.bottom-ink.top;
 const capacity=Math.max(0,Math.min(1,(right-left)/Math.max(1,width),(bottom-top)/Math.max(1,height)));
 const anchored=Math.max(0,Math.min(capacity,ink.left<0?(source.x-left)/-ink.left:1,ink.right>0?(right-source.x)/ink.right:1));
 // A normal source anchor keeps its exact coordinate. A large, avoidable
 // reduction means the anchor, rather than the segment, is the bottleneck.
 const translated=anchored<capacity*.6;
 const font=source.font*(translated?capacity:anchored),fitted=measure(font);
 const x=translated?Math.max(left-fitted.left,Math.min(source.x,right-fitted.right)):source.x;
 const y=Math.max(top-fitted.top,Math.min(source.y,bottom-fitted.bottom));
 return {x,y,font,translated,needsReview:font<source.font*.35};
}
