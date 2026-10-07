import {platformUrl} from '@/lib/chart-platform-url';
/** Individual source assets in a reusable semantic group; no logo-wall bitmap. */
export function SourceAsset({item}:{item:any}){
 const assets=item.assets||[];
 if(!assets.length)return <span className="asset-unavailable" data-asset-missing="true">{item.name||item.title} · 素材待补充</span>;
 const x=Math.min(...assets.map((a:any)=>a.bbox[0])),y=Math.min(...assets.map((a:any)=>a.bbox[1]));
 const w=Math.max(...assets.map((a:any)=>a.bbox[0]+a.bbox[2]))-x,h=Math.max(...assets.map((a:any)=>a.bbox[1]+a.bbox[3]))-y,aspect=assets[0].pageAspect||16/9;
 return <svg viewBox={`0 0 ${w*aspect} ${h}`} className="source-asset" role="img" aria-label={item.name||item.title||'Source asset'} data-source-asset="true" preserveAspectRatio="xMidYMid meet">
  <title>{item.name||item.title}</title>{assets.map((a:any,i:number)=><image key={i} href={platformUrl(a.url)} x={(a.bbox[0]-x)*aspect} y={a.bbox[1]-y} width={a.bbox[2]*aspect} height={a.bbox[3]} data-source-sha256={a.sha256}/>)}
 </svg>;
}

export function LogoGroup({element,hideTitle=false}:{element:any;hideTitle?:boolean}){
 return <div className="logo-group" data-component-role="logo-group">{!hideTitle&&<h3>{element.title}</h3>}<div className="logo-group-items" style={{gridTemplateRows:`repeat(${element.items?.length||1},minmax(0,1fr))`}}>
  {(element.items||[]).map((item:any,i:number)=><div key={i} className="logo-item" data-entity-name={item.name}><SourceAsset item={item}/></div>)}
 </div></div>;
}
