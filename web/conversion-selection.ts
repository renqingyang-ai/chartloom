export function selectedPages(value:string,total:number):number[]|null {
  if(!value.trim())return null;
  const pages=new Set<number>();
  for(const token of value.trim().split(/[,，\s]+/)) {
    const match=token.match(/^(\d+)(?:[-–](\d+))?$/);
    if(!match)throw new Error('页码请写成 1-3, 5 这样的格式。');
    const first=Number(match[1]),last=Number(match[2]||match[1]);
    if(first<1||last>total||last<first)throw new Error(`页码需在 1–${total} 之间，且范围从小到大。`);
    for(let n=first;n<=last;n++)pages.add(n);
  }
  return [...pages].sort((a,b)=>a-b);
}
