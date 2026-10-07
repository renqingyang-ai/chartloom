import { OM_COMPONENT_THEME } from './theme';

/** Title and caption are part of the exported SVG, using the same measured layout as preview. */
export function addFigureHeading(svg:SVGSVGElement,header?:{title?:string;caption?:string}){
 if(!header?.title&&!header?.caption)return;
 const NS='http://www.w3.org/2000/svg',w=Number(svg.getAttribute('width')),h=Number(svg.getAttribute('height'));
 const content=document.createElementNS(NS,'g'),group=document.createElementNS(NS,'g');
 for(const child of [...svg.children])if(!['title','desc','metadata','style','defs'].includes(child.tagName)&&!child.hasAttribute('data-chart-background'))content.append(child);
 svg.append(content,group);let y=8;
 for(const [copy,size,family,weight] of [[header.title,30,OM_COMPONENT_THEME.font.heading.family,500],[header.caption,20,OM_COMPONENT_THEME.font.note.family,400]] as const){
  if(!copy)continue;const text=document.createElementNS(NS,'text');text.setAttribute('x','14');text.setAttribute('y',String(y+size));text.setAttribute('fill',OM_COMPONENT_THEME.colors.ink);text.setAttribute('font-family',family);text.setAttribute('font-size',String(size));text.setAttribute('font-weight',String(weight));text.setAttribute('data-figure-heading','true');group.append(text);
  let row='',line=0,span=document.createElementNS(NS,'tspan');span.setAttribute('x','14');text.append(span);
  for(const word of copy.split(/\s+/)){const before=row;row+=(row?' ':'')+word;span.textContent=row;if(span.getComputedTextLength()>w-28&&before){span.textContent=before;span=document.createElementNS(NS,'tspan');span.setAttribute('x','14');span.setAttribute('dy',String(size*1.35));text.append(span);row=word;span.textContent=row;line++;}}
  y+=(line+1)*size*1.35;
 }
 const offset=y+10;content.setAttribute('transform',`translate(0,${offset})`);svg.setAttribute('height',String(h+offset));svg.setAttribute('viewBox',`0 0 ${w} ${h+offset}`);svg.querySelector('[data-chart-background]')?.setAttribute('height',String(h+offset));
}
