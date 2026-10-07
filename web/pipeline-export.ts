import { chartSvg, attachChartToPng } from '@/lib/chart-import/export';
import { validateImportedChart, type ImportedChart } from '@/types/chart-import';
import { chartExcelFile } from '@/lib/chart-import/excel';
import { parseChartNumber, type ChartWorkbook } from '@/lib/chart-import/spreadsheet';

function payload(chart:ImportedChart,figure:any){return {...validateImportedChart(chart),platformTheme:window.CHART_PLATFORM_THEME,pipelineFigure:{...figure,chart:validateImportedChart(chart)}};}

export async function pipelineSvg(svg:SVGSVGElement,chart:ImportedChart,figure:any,allowDraft=false){
 // The shared exporter requires a series name; an unlabelled source series is valid here.
 // Use the source title for that guard only, then store the exact unmodified source data.
 const compatible={...chart,labels:chart.labels.map((s,i)=>`${i+1} · ${s||'Category'}`),series:chart.series.map(s=>({...s,name:s.name||chart.title}))};
 const xml=new DOMParser().parseFromString(await chartSvg(svg,compatible,allowDraft),'image/svg+xml');
 const metadata=xml.querySelector('metadata');if(!metadata)throw new Error('导出数据不完整。');
 metadata.textContent=JSON.stringify(payload(chart,figure));
 return new XMLSerializer().serializeToString(xml);
}

export async function pipelineExcel(chart:ImportedChart,figure:any){
 // Number formats are part of the data contract: 0.47 with a percent format
 // means 47%, and must retain that meaning after appending our figure sheets.
 const XLSX=await import('xlsx'),book=XLSX.read(await (await chartExcelFile(chart)).arrayBuffer(),{type:'array',cellNF:true}),callouts=figure.categoryCallouts||[];
 const theme=window.CHART_PLATFORM_THEME;
 XLSX.utils.sheet_add_aoa(book.Sheets['Source and notes'],[['Rendering theme',theme.name],['Theme version',theme.version],['Theme SHA-256',theme.sha256]],{origin:-1});
 if(chart.unit==='%')for(let r=0;r<chart.labels.length;r++)for(let s=0;s<chart.series.length;s++){
  const cell=book.Sheets['Chart Data']?.[XLSX.utils.encode_cell({r:r+1,c:s+1})],value=chart.series[s].values[r];
  if(cell&&typeof value==='number'){const decimals=value.toFixed(8).replace(/0+$/,'').split('.')[1]?.length||0;cell.z='0'+(decimals?'.'+'0'.repeat(decimals):'')+'%';delete cell.w;}
 }
 if(figure.dataDesign)for(let s=0;s<chart.series.length;s++){
  const unit=figure.dataDesign.series[s]?.axis==='secondary'?figure.dataDesign.secondaryUnit:chart.unit;
  for(let r=0;r<chart.labels.length;r++){
   const cell=book.Sheets['Chart Data']?.[XLSX.utils.encode_cell({r:r+1,c:s+1})],value=chart.series[s].values[r];
   if(cell&&typeof value==='number'){cell.v=unit==='%'?value/100:value;cell.z=unit==='%'?'0.########%':'#,##0.########;[Red](#,##0.########)';delete cell.w;}
  }
  XLSX.utils.sheet_add_aoa(book.Sheets['Source and notes'],[[`Series unit: ${chart.series[s].name}`,unit]],{origin:-1});
 }
 const rows=[['Category','Printed total',...callouts.map((a:any)=>a.label)],...chart.labels.map((s,i)=>[s,figure.totals?.[i]??null,...callouts.map((a:any)=>a.values[i]??null)])];
 const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map(()=>({wch:28}));XLSX.utils.book_append_sheet(book,sheet,'Figure annotations');
 const caption=XLSX.utils.aoa_to_sheet([['Caption',figure.caption||''],['Series annotation title',figure.seriesAnnotationTitle||''],['Series annotation period',figure.seriesAnnotationPeriod||''],['Figure note',figure.note||''],['Instructions','Edit totals and callouts in Figure annotations. They are independent source annotations and are not automatically recalculated from the data.']]);caption['!cols']=[{wch:20},{wch:110}];XLSX.utils.book_append_sheet(book,caption,'Figure notes');
 const metrics=XLSX.utils.aoa_to_sheet([['Series','Metric','Printed value'],...(figure.seriesAnnotations||[]).map((a:any)=>[a.series,a.label,a.value])]);metrics['!cols']=[{wch:50},{wch:24},{wch:24}];XLSX.utils.book_append_sheet(book,metrics,'Series annotations');
 if(figure.errorBars?.length){const errorSheet=XLSX.utils.aoa_to_sheet([['Series index','Category index','Axis','Low endpoint','High endpoint'],...figure.errorBars.map((e:any)=>[e.series,e.index,e.axis,e.low,e.high])]);errorSheet['!cols']=[{wch:20},{wch:20},{wch:12},{wch:22},{wch:22}];XLSX.utils.book_append_sheet(book,errorSheet,'Error bars');}
 const json=JSON.stringify(figure),chunks=[['CRE Studio Figure v1']];for(let i=0;i<json.length;i+=30000)chunks.push([json.slice(i,i+30000)]);
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(chunks),'_CRE_Figure');book.Workbook={Sheets:book.SheetNames.map(name=>({name,Hidden:name.startsWith('_CRE_')?2:0}))};
 return new Blob([XLSX.write(book,{type:'array',bookType:'xlsx',compression:true})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

export async function figureFromVisibleCells(workbook:ChartWorkbook,figure:any,chart:ImportedChart){
 const XLSX=await import('xlsx'),sheet=workbook.book.Sheets['Figure annotations'];if(!sheet)return figure;
 const r=XLSX.utils.decode_range(sheet['!ref']||'A1:B1');if(r.e.r!==chart.labels.length||r.e.c>5)throw new Error('图中标注工作表的行数需与图表分类一致，最多四组标注。');
 const at=(row:number,col:number)=>sheet[XLSX.utils.encode_cell({r:row,c:col})],value=(row:number,col:number)=>{const cell=at(row,col);return cell?XLSX.utils.format_cell(cell):'';};
 const totals=chart.labels.map((_,i)=>{const cell=at(i+1,1);if(!cell||cell.v==='')return null;const n=typeof cell.v==='number'?cell.v:parseChartNumber(String(cell.v));if(n===null||!Number.isFinite(n))throw new Error('合计列仅支持数值或空白。');return n;});
 const callouts=Array.from({length:Math.max(0,r.e.c-1)},(_,k)=>({label:value(0,k+2),values:chart.labels.map((_,i)=>value(i+1,k+2)||null)}));
 const metricSheet=workbook.book.Sheets['Series annotations'];
 const seriesAnnotations=metricSheet?(XLSX.utils.sheet_to_json(metricSheet,{header:1,defval:''}) as any[][]).slice(1).filter(r=>r.some(v=>v!=='')).map(r=>{if(!chart.series.some(s=>s.name===String(r[0])))throw Error('系列标注须对应现有系列名称。');return {series:String(r[0]),label:String(r[1]),value:String(r[2])};}):figure.seriesAnnotations;
 const notes=workbook.book.Sheets['Figure notes'],noteRows=notes?XLSX.utils.sheet_to_json(notes,{header:1}) as any[][]:[],lookup=(label:string,fallback:any)=>noteRows.find(r=>r[0]===label)?.[1]??fallback;
 const errorSheet=workbook.book.Sheets['Error bars'];
 const errorBars=errorSheet?(XLSX.utils.sheet_to_json(errorSheet,{header:1,defval:''}) as any[][]).slice(1).filter(r=>r.some(v=>v!=='')).map(r=>{
  const [series,index,axis,low,high]=r;if(!Number.isInteger(series)||series<0||series>=chart.series.length||!Number.isInteger(index)||index<0||index>=chart.labels.length||!['x','y'].includes(axis)||!Number.isFinite(low)||!Number.isFinite(high)||low>high)throw Error('误差线需要有效的系列、分类行号和数值端点。');return {series,index,axis,low,high,valueStatus:'user-edited'};
 }):figure.errorBars;
 return {...figure,errorBars,seriesAnnotations,seriesAnnotationTitle:lookup('Series annotation title',figure.seriesAnnotationTitle),seriesAnnotationPeriod:lookup('Series annotation period',figure.seriesAnnotationPeriod),note:lookup('Figure note',figure.note),caption:String(workbook.book.Sheets['Figure notes']?.B1?.v??figure.caption??''),totals:totals.some(v=>v!==null)?totals:[],categoryCallouts:callouts};
}

export async function pipelinePng(svg:SVGSVGElement,chart:ImportedChart,figure:any,allowDraft=false){
 const markup=await pipelineSvg(svg,chart,figure,allowDraft),url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));
 try{
  const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('图表图片生成失败。'));image.src=url;});
  const canvas=document.createElement('canvas');canvas.width=Number(svg.getAttribute('width'))*2;canvas.height=Number(svg.getAttribute('height'))*2;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器绘图不可用。');
  ctx.fillStyle=svg.querySelector('[data-chart-background]')?.getAttribute('fill')||'#f8f7f5';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG 编码失败。')),'image/png'));
  const bytes=attachChartToPng(new Uint8Array(await png.arrayBuffer()),payload(chart,figure));
  return new Blob([bytes.buffer as ArrayBuffer],{type:'image/png'});
 }finally{URL.revokeObjectURL(url);}
}
