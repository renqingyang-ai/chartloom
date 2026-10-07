import React, {useEffect, useRef, useState} from 'react';
import {platformUrl} from '@/lib/chart-platform-url';
import {readChartWorkbook, type ChartWorkbook} from '@/lib/chart-import/spreadsheet';
import {downloadChartFile} from '@/lib/chart-import/export';
import {validateImportedChart, type ImportedChart} from '@/types/chart-import';
import type {EditorProps} from './upload';
import {PipelineFigure} from './pipeline-view';
import {ConversionCost} from './billing-view';
import {useResultExport} from './result-export';

type Table={columns:string[];rows:(string|number|null)[][]};
async function api(path:string,body?:unknown){const r=await fetch(platformUrl('/api/v1/'+path),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const v=await r.json();if(!r.ok)throw new Error(v.error||'请求失败');return v;}
export function DataTable({table}:{table:Table}){
 const [page,setPage]=useState(0),pages=Math.ceil(table.rows.length/15),current=Math.min(page,pages-1);
 return <div className="data-table"><div className="data-table-scroll"><table><thead><tr><th>行</th>{table.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.slice(current*15,current*15+15).map((row,i)=><tr key={i}><th>{current*15+i+2}</th>{row.map((v,j)=><td key={j}>{v===null||v===''?<span className="data-null">空白</span>:String(v)}</td>)}</tr>)}</tbody></table></div><div className="data-table-pager"><span>{table.rows.length} 行 · {table.columns.length} 列</span>{pages>1&&<><button disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {pages}</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>下一页</button></>}</div></div>;
}

export function DataWorkspace({Editor}:{Editor:React.ComponentType<EditorProps>}){
 const [data,setData]=useState(''),[requirements,setRequirements]=useState(''),[fileName,setFileName]=useState('输入数据'),[units,setUnits]=useState<Record<string,string>>({}),[locator,setLocator]=useState('Provided data');
 const [book,setBook]=useState<ChartWorkbook|null>(null),[sheet,setSheet]=useState(''),[notes,setNotes]=useState<string[]>([]);
 const [job,setJob]=useState<any>(null),[recent,setRecent]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState(false);
 const file=useRef<HTMLInputElement>(null),requestSequence=useRef(0),activeId=useRef('');
 const page=job?.pages?.[0],result=page?.result,element=result?.elements?.[0],working=busy||['queued','converting'].includes(page?.status);
 useResultExport(result);
 const refreshRecent=()=>api('jobs').then(v=>setRecent(v.jobs.filter((j:any)=>j.inputKind==='data')));
 const putJob=(v:any)=>{activeId.current=v.id;setJob(v);const q=new URLSearchParams(location.search);q.set('mode','data');q.set('job',v.id);history.replaceState(null,'','?'+q);};
 const load=async(id:string)=>{setError('');try{const v=await api('job?id='+encodeURIComponent(id));if(v.inputKind!=='data')throw new Error('这份任务来自图片，请到“上传并转换”查看。');if(window.CHART_PLATFORM_THEME.id!==v.theme){location.search=`mode=data&job=${v.id}`;return;}putJob(v);setData(JSON.stringify(v.inputData,null,2));setRequirements(v.requirements);setFileName(v.fileName);setUnits(v.columnUnits||{});setLocator(v.sourceLocator||'Provided data');setNotes(v.inputNotes||[]);setBook(null);}catch(e){setError((e as Error).message);}};
 useEffect(()=>{const id=new URLSearchParams(location.search).get('job');if(id)void load(id);void refreshRecent().catch(()=>{});},[]);
 useEffect(()=>{if(!job||!['queued','converting'].includes(page?.status))return;let alive=true,pending=false;const id=job.id;const timer=setInterval(async()=>{if(pending)return;pending=true;try{const next=await api('job?id='+id);if(alive&&activeId.current===id)setJob(next);}catch(e){if(alive)setError((e as Error).message);}finally{pending=false;}},1000);return()=>{alive=false;clearInterval(timer);};},[job?.id,page?.status]);
 const generate=async()=>{setBusy(true);setError('');setNotice('');setEditing(false);try{const next=await api('create-chart',{data,requirements,theme:window.CHART_PLATFORM_THEME.id,fileName,sourceLocator:locator,columnUnits:units,inputNotes:notes});putJob(next);void refreshRecent();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const selectSheet=async(workbook:ChartWorkbook,name:string)=>{
  const XLSX=await import('xlsx'),ws=workbook.book.Sheets[name],range=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
  if(range.e.c-range.s.c<1||range.e.r-range.s.r<1)throw new Error('工作表需有表头和至少一行数据、两列。');
  const cols=Array.from({length:range.e.c-range.s.c+1},(_,i)=>String(ws[XLSX.utils.encode_cell({r:range.s.r,c:range.s.c+i})]?.v??''));
  const rows:Table['rows']=[],unit:Record<string,string>={},warnings=new Set<string>();
  for(let r=range.s.r+1;r<=range.e.r;r++){
   const row=cols.map((column,i)=>{const cell=ws[XLSX.utils.encode_cell({r,c:range.s.c+i})];if(cell?.f)warnings.add(cell.v===undefined?'公式缺少已保存的计算结果，保留为空。':'公式使用 Excel 已保存的值，未重新计算。');if(!cell||cell.v===undefined||cell.t==='e'){if(cell?.t==='e')warnings.add('Excel 错误单元格保留为空。');return null;}if(cell.t==='n'&&typeof cell.z==='string'&&cell.z.includes('%')){unit[column]='%';return String(Number((cell.v*100).toPrecision(15)))+'%';}if(cell.t==='n'&&XLSX.SSF.is_date(cell.z||''))return XLSX.utils.format_cell(cell);if(cell.t==='b')throw new Error(`“${column}”包含布尔值，请改为明确的分类或数值。`);return cell.v as string|number;});rows.push(row);
  }
  setSheet(name);setData(JSON.stringify({columns:cols,rows},null,2));setUnits(unit);setNotes([...warnings]);setFileName(workbook.fileName);setLocator(`${name}!${ws['!ref']}`);
 };
 const importFile=async(f:File)=>{const seq=++requestSequence.current;setBusy(true);setError('');try{if(/\.xlsx?$/i.test(f.name)){const workbook=await readChartWorkbook(f);if(seq!==requestSequence.current)return;await selectSheet(workbook,workbook.book.SheetNames[0]);setBook(workbook);}else{if(f.size>1_000_000)throw new Error('文本数据请控制在 1 MB 内。');const text=await f.text();if(seq!==requestSequence.current)return;setData(text);setBook(null);setUnits({});setNotes([]);setFileName(f.name);setLocator('Provided data');}}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const sample=()=>{setData('季度,收入（万元）,利润率\nQ1,128.5,18.2%\nQ2,145.75,20.4%\nQ3,139.25,19.6%\nQ4,172.8,23.1%');setRequirements('展示各季度收入与利润率。收入用柱状图，利润率用折线和右侧百分比坐标轴，显示数值。标题为“季度收入与利润率”。');setFileName('示例数据 · 季度经营');setLocator('Provided example');setUnits({});setNotes([]);setBook(null);};
 const save=async(chart:ImportedChart,figure?:any)=>{const next=await api('save-chart',{id:job.id,page:1,elementId:element.id,revision:result.revision,chart:validateImportedChart(chart),figure});setJob(next);setEditing(false);setNotice('修改已保存，图表已更新；刷新后仍可继续编辑。');};
 const exportFile=async(format:string)=>{setBusy(true);setError('');try{const r=await fetch(platformUrl(`/api/v1/artifact?id=${job.id}&page=1&elementId=${element.id}&format=${format}&revision=${result.revision}`));if(!r.ok){const e=await r.json();throw new Error(e.error||'导出失败');}downloadChartFile(await r.blob(),`chartloom-${job.id.slice(0,8)}-v${result.revision}.${format}`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="data-workspace">
  <div className="data-intro"><div><span className="eyebrow">DATA → CHART</span><h2>给数据，说需求，就能画图。</h2><p>粘贴表格或导入 Excel，用一句话说明想比较什么、看什么趋势。</p></div><button onClick={sample} disabled={working}>填入示例数据</button></div>
  <div className="data-create-grid">
   <section className="data-panel"><div className="data-panel-heading"><h3><span>1</span> 提供数据</h3><button onClick={()=>file.current?.click()} disabled={working}>导入 Excel / CSV / JSON</button></div><input type="file" accept=".xlsx,.xls,.csv,.tsv,.json,.txt" ref={file} hidden onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value='';}}/>
    {book&&<label className="data-sheet">工作表 <select aria-label="选择工作表" value={sheet} disabled={working} onChange={e=>void selectSheet(book,e.target.value).catch(e=>setError(e.message))}>{book.book.SheetNames.map(n=><option key={n}>{n}</option>)}</select></label>}
    <label className="sr-only" htmlFor="chart-input-data">输入数据</label><textarea id="chart-input-data" value={data} spellCheck={false} onChange={e=>{setData(e.target.value);setUnits({});setNotes([]);setBook(null);setFileName('粘贴数据');setLocator('Provided data');}} placeholder={'月份,收入,成本\n一月,120,80\n二月,145,92\n三月,168,108'}/>
    <p className="data-hint">第一行作为表头。支持 CSV、Excel 粘贴、JSON 对象数组。空白保留为空。</p>{notes.map(n=><p className="data-note" key={n}>{n}</p>)}
   </section>
   <section className="data-panel data-requirements"><h3><span>2</span> 描述你想要的图表</h3><label className="sr-only" htmlFor="chart-requirements">图表需求</label><textarea id="chart-requirements" maxLength={4000} value={requirements} onChange={e=>setRequirements(e.target.value)} placeholder="例如：按月份比较收入与成本，用分组柱状图；或收入用柱状图，利润率用折线和右轴。"/><div className="data-theme-note"><strong>{window.CHART_PLATFORM_THEME.name}</strong><span>沿用所选主题的字体和配色</span></div><button className="primary data-generate" onClick={()=>void generate()} disabled={working||!data.trim()||!requirements.trim()}>{working?page?.stage||'正在处理…':job?'按当前数据和需求重新生成':'生成可编辑图表'}</button><p className="data-hint">重新生成会保留已有结果和调用记录。</p></section>
  </div>
  {(error||page?.error)&&<p className="data-error" role="alert">{error||page.error}</p>}{notice&&<p className="data-success" role="status">{notice}</p>}
  {job&&<details className="data-run-log" open={!!working}><summary>运行记录 · {result?`${(result.timing.totalMs/1000).toFixed(2)} 秒 · `:""}模型、用量与费用</summary><ConversionCost billing={page?.billing} working={!!working} runs={page?.costRuns} pageStage={page?.stage} pageStatus={page?.status}/></details>}
  {element&&<section className="data-result" data-element-id={element.id}><div className="data-result-heading"><div><span className="eyebrow">可编辑图表 · V{result.revision}</span><h3>{element.chart.title}</h3></div><div className="button-row"><button onClick={()=>void exportFile('xlsx')} disabled={working}>Excel ↓</button><button onClick={()=>void exportFile('svg')} disabled={working}>SVG ↓</button><button onClick={()=>void exportFile('png')} disabled={working}>PNG ↓</button><button className="primary" onClick={()=>setEditing(true)} disabled={working}>编辑数据 ↗</button></div></div>
   <PipelineFigure element={element} aspect={1000/620} standalone onEdit={()=>setEditing(true)}/>
   <p className="data-rationale">{element.figure.dataDesign.rationale}</p>{element.chart.warnings.map((s:string)=><p className="data-note" key={s}>{s}</p>)}
   <details className="data-source"><summary>查看输入数据、需求与字段对应</summary><p><strong>生成时的需求：</strong>{job.requirements}</p><p>分类 / X 轴：{element.figure.dataDesign.category} · 数值列：{element.figure.dataDesign.series.map((s:any)=>s.column).join('、')} · {element.figure.dataDesign.aggregation==='none'?'逐行读取原值':`按分类${element.figure.dataDesign.aggregation==='sum'?'求和':'求平均'}`}</p><DataTable table={job.inputData}/><button onClick={()=>downloadChartFile(new Blob([JSON.stringify(job,null,2)],{type:'application/json'}),`chartloom-${job.id}-record.json`)}>下载完整生成记录 ↓</button></details>
  </section>}
  {recent.length>0&&<section className="data-history"><h3>最近的数据生成任务</h3><div>{recent.map(j=><button key={j.id} disabled={working} onClick={()=>void load(j.id)}>{j.fileName} · {new Date(j.createdAt).toLocaleString('zh-CN')}</button>)}</div></section>}
  {editing&&element&&<Editor chart={element.chart} pipelineFigure={element.figure} onApply={save} onClose={()=>setEditing(false)} sourceContent={<DataTable table={job.inputData}/>} applyLabel="保存图表数据" footerText="保存后更新此任务的图表，原始输入与历史版本仍会保留。" renderChart={(chart,ref,figure)=><PipelineFigure element={{...element,chart,figure:{...(figure||element.figure),chart}}} aspect={1000/620} standalone svgRef={ref}/>}/>}
 </section>;
}
