import {useResultExport} from './result-export';
import {platformUrl, embeddedEditor} from '@/lib/chart-platform-url';
import {useValidationSnapshot} from './validation-client';
import {figureExcel} from './figure-excel';
import React, { useEffect, useRef, useState } from 'react';
import { ImportedChartFigure } from '@/templates/asset-noir/components/charts/ImportedChartFigure';
import { chartExcelFile } from '@/lib/chart-import/excel';
import { downloadChartFile } from '@/lib/chart-import/export';
import { validateImportedChart, type ImportedChart } from '@/types/chart-import';
import { PipelinePage, PipelineFigure } from './pipeline-view';
import {pipelineExcel,pipelineSvg,pipelinePng} from './pipeline-export';
import {fontStyles} from '@/lib/chart-import/export';
import {StructureEditor} from './structure-editor';
import {selectedPages} from './conversion-selection';
import {ConversionCost, FileCost, type Billing} from './billing-view';

export interface Element { id: string; type: string; title: string; text?: string; chart?: ImportedChart; figure?: any; columns?: string[]; rows?: string[][]; bbox: number[] }
interface Result { title: string; subtitle: string; footnotes: string[]; warnings: string[]; elements: Element[]; revision: number; source: ImportedChart['source']; timing: { totalMs: number; modelMs: number; responseModel: string }; mode: string; pipelineVersion?:string; audit?:any; quality?:any; validation?:any; aspect?:number }
interface Page { number: number; title: string; width: number; height: number; status: string; stage?: string; error?: string; result?: Result; candidate?:Result; startedAt?: string; counts?: Record<string,number>; billing?:Billing; costRuns?:Record<string,Billing> }
interface Job { derivedFrom?:{jobId:string;page:number;elementId:string;revision:number}; id: string; fileName: string; status: string; stage?: string; error?: string; pages: Page[]; prepareMs: number; createdAt: string; conversion?:{total:number;generated:number;queued:number;running:number;failed:number;review:number}; billing?:Billing }
interface Recent { inputKind?:string; id: string; fileName: string; status: string; pageCount: number; completedPages: number[] }
export interface EditorProps { chart: ImportedChart; onApply: (c: ImportedChart,figure?:any) => void; onClose: () => void; sourceImage?: string; sourceContent?: React.ReactNode; footerText?: string; applyLabel?: string; pipelineFigure?:any; renderChart?:(chart:ImportedChart,ref:React.Ref<SVGSVGElement>,figure?:any)=>React.ReactNode }
async function api(path: string, data?: unknown): Promise<any> {
  const res = await fetch(platformUrl(path), data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : undefined);
  const body = await res.json();
  if(!res.ok) throw new Error(body.error || '请求未完成，请重试。');
  return body;
}
const asset=(job:Job,page:Page,kind='page')=>platformUrl(`/api/asset/${job.id}/${kind}-${page.number}.png`);
const seconds=(ms:number)=>`${(ms/1000).toFixed(2)} 秒`;
const labels:Record<string,string>={idle:'待转换',queued:'排队中',converting:'转换中',done:'可查看',partial:'待核对',failed:'需重试'};

// Preserve reading order and column groups while letting content determine height; no screenshot underlay.
function rowsOf(elements:Element[]) {
  const rows: Element[][]=[];
  for(const element of [...elements].sort((a,b)=>a.bbox[1]-b.bbox[1]||a.bbox[0]-b.bbox[0])) {
    const row=rows.at(-1);
    if(row&&Math.abs(row[0].bbox[1]-element.bbox[1])<7&&row.every(e=>e.bbox[0]+e.bbox[2]<=element.bbox[0]+3||element.bbox[0]+element.bbox[2]<=e.bbox[0]+3))row.push(element);
    else rows.push([element]);
  }
  return rows.map(row=>row.sort((a,b)=>a.bbox[0]-b.bbox[0]));
}

function ThemePage({result,onEdit}:{result:Result;onEdit:(id:string)=>void}) {
  if(result.pipelineVersion)return <PipelinePage result={result} onEdit={onEdit}/>;
  return <article className="converted-sheet" data-testid="converted-page">
    <div className="sheet-brand"><span>REFERENCE · {window.CHART_PLATFORM_THEME.name}</span></div>
    <h2>{result.title||'原图未标注标题'}</h2>{result.subtitle&&<p className="sheet-subtitle">{result.subtitle}</p>}
    <div className="sheet-content">{rowsOf(result.elements).map((row,i)=><div className="semantic-row" key={i} style={{gridTemplateColumns:row.map(e=>`${Math.max(e.bbox[2],15)}fr`).join(' ')}}>{row.map(e=><section key={e.id} className={`semantic-element semantic-${e.type}`} data-element-id={e.id}>
      {e.type==='chart'&&e.chart?<button className="chart-edit-surface" title="点击编辑这张图表的数据" onClick={()=>onEdit(e.id)}><ImportedChartFigure chart={e.chart}/><span className="hover-edit">编辑数据 ↗</span></button>:<>
        {e.title&&<h3>{e.title}</h3>}
        {e.type==='text'&&<p>{e.text}</p>}
        {e.type==='table'&&<div className="semantic-table-scroll"><table><thead><tr>{e.columns?.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{e.rows?.map((r,i)=><tr key={i}>{r.map((c,k)=><td key={k}>{c}</td>)}</tr>)}</tbody></table></div>}
        {e.type==='gap'&&<div className="conversion-gap"><span>待补充</span><p>{e.text}</p></div>}
      </>}
    </section>)}</div>)}</div>
    <footer className="sheet-footnotes">{result.footnotes.map((f,i)=><p key={i}>{f}</p>)}<p>Reference · {result.source.fileName} · {result.source.locator}{result.source.asOf?` · as of ${result.source.asOf}`:''}</p></footer>
  </article>;
}

export function UploadWorkspace({Editor}:{Editor:React.ComponentType<EditorProps>}) {
  const [job,setJob]=useState<Job|null>(null);
  const [recent,setRecent]=useState<Recent[]>([]);
  const [selected,setSelected]=useState(1);
  const [pageRange,setPageRange]=useState('');
  const [mode,setMode]=useState('charts');
  const [view,setView]=useState('charts');
  const [busy,setBusy]=useState(false);
  const [uploadPercent,setUploadPercent]=useState(0);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [editing,setEditing]=useState<string|null>(null);
  const [drag,setDrag]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const [model,setModel]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const strip=useRef<HTMLDivElement>(null);
  const chosenId=useRef<string|null>(null);
  const independent=Boolean(job?.derivedFrom);
  const embedded=embeddedEditor();
  const visiblePages=job?.derivedFrom?job.pages.filter(p=>p.number===job.derivedFrom!.page):job?.pages||[];
  const page=visiblePages.find(p=>p.number===selected)||visiblePages[0];
  const auditMode=new URLSearchParams(location.search).get('audit')==='1';
  const result=auditMode?(page?.candidate||page?.result):page?.result;
  useResultExport(result);
  useValidationSnapshot(result);
  const selectedElement=result?.elements.find(e=>e.id===editing);
  const working=busy||job?.status==='preparing'||['queued','converting'].includes(page?.status||'');
  const refreshRecent=async()=>{if(embedded)return;const data=await api('/api/jobs');setRecent(data.jobs.filter((j:Recent)=>j.inputKind!=='data'));setModel(data.model.replace('gemini/',''));};
  const adopt=(next:Job)=>{if((next as any).inputKind==='data'){const q=new URLSearchParams(location.search);q.set('mode','data');q.set('job',next.id);location.search=q.toString();return;}const wanted=(next as any).theme||'om';if(!new URLSearchParams(location.search).has('theme')&&wanted!==window.CHART_PLATFORM_THEME.id){location.search=`mode=upload&job=${next.id}&page=1`;return;}chosenId.current=next.id;setJob(next);setPageRange('');!embedded&&localStorage.setItem('chart-upload-last-job',next.id);};
  const load=async(id:string,number?:number)=>{setError('');try{const next=await api(`/api/job?id=${id}`);adopt(next);setSelected(number&&next.pages.some((p:Page)=>p.number===number)?number:next.pages.find((p:Page)=>p.result)?.number||1);}catch(e){setError((e as Error).message);}};
  useEffect(()=>{const q=new URLSearchParams(location.search);const last=q.get('job')||(!embedded?localStorage.getItem('chart-upload-last-job'):null);
    if(!embedded&&!auditMode)void api('/api/jobs').then(data=>{setRecent(data.jobs.filter((j:Recent)=>j.inputKind!=='data'));setModel(data.model.replace('gemini/',''));if(!last){const ready=data.jobs.find((j:Recent)=>j.inputKind!=='data'&&j.completedPages?.length);if(ready)void load(ready.id,ready.completedPages[0]);}}).catch(e=>setError(e.message));
    if(last)void load(last,Number(q.get('page'))||undefined);
  },[]);
  // Audit/export reads the published candidate once. Progress clocks and job
  // polling must not replace its D3 nodes while Chromium captures them.
  useEffect(()=>{if(auditMode||!job||(job.status!=='preparing'&&!job.pages.some(p=>['queued','converting'].includes(p.status))))return;
    const id=job.id;let active=true,inflight=false;
    const timer=setInterval(async()=>{if(inflight)return;inflight=true;try{const next=await api(`/api/job?id=${id}`);if(active&&chosenId.current===id){setJob(next);if(next.status!=='preparing'&&!next.pages.some((p:Page)=>['queued','converting'].includes(p.status)))void refreshRecent();}}catch(e){if(active)setError((e as Error).message);}finally{inflight=false;}},850);
    return()=>{active=false;clearInterval(timer);};
  },[auditMode,job?.id,job?.status,job?.pages.map(p=>p.status).join(',')]);
  useEffect(()=>{if(auditMode||page?.status!=='converting'||!page.startedAt)return;const start=Date.parse(page.startedAt);const timer=setInterval(()=>setElapsed(Math.max(0,(Date.now()-start)/1000)),200);return()=>clearInterval(timer);},[auditMode,page?.status,page?.startedAt]);
  useEffect(()=>{if(page?.result?.mode){setMode(page.result.mode==='chart'?'charts':page.result.mode);setView(page.result.mode==='charts'||page.result.mode==='chart'?'charts':'compare');}const el=strip.current?.querySelector<HTMLElement>('[aria-pressed=true]');if(el&&strip.current)strip.current.scrollLeft=el.offsetLeft-strip.current.offsetLeft-(strip.current.clientWidth-el.clientWidth)/2;},[job?.id,selected,job?.status]);
  useEffect(()=>{if(job&&!auditMode){const q=new URLSearchParams(location.search);q.set('job',job.id);q.set('page',String(selected));q.delete('sourcePage');history.replaceState(null,'',`${location.pathname}?${q}${location.hash}`);}},[job?.id,selected]);

  useEffect(()=>{if(job&&location.hash==='#conversion-log')requestAnimationFrame(()=>document.getElementById('conversion-log')?.scrollIntoView({block:'start'}));},[job?.id,selected]);

  const upload=async(file:File)=>{
    if(!/\.(pptx?|pdf|png|jpe?g|webp)$/i.test(file.name)||file.size>50*1024*1024){setError('请选择 50 MB 以内的 PPT、PPTX、PDF 或 PNG/JPG/WebP 图片。');return;}
    setBusy(true);setError('');setNotice('');setUploadPercent(0);
    try{
      const next:Job=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',`/api/upload?name=${encodeURIComponent(file.name)}&theme=${window.CHART_PLATFORM_THEME.id}`);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.upload.onprogress=e=>{if(e.lengthComputable)setUploadPercent(Math.round(e.loaded/e.total*100));};xhr.onload=()=>{try{const data=JSON.parse(xhr.responseText);xhr.status<300?resolve(data):reject(new Error(data.error));}catch{reject(new Error('上传响应无法读取。'));}};xhr.onerror=()=>reject(new Error('上传中断，请重试。'));xhr.send(file);});
      adopt(next);setSelected(1);setEditing(null);setMode('charts');setView('charts');void refreshRecent();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const convert=async()=>{if(!job||!page)return;setBusy(true);setError('');setNotice('');setElapsed(0);try{setEditing(null);setJob(await api('/api/convert',{id:job.id,page:page.number,mode}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const convertDocument=async()=>{if(!job)return;setBusy(true);setError('');setNotice('');try{
    const pages=selectedPages(pageRange,job.pages.length);
    const targets=job.pages.filter(p=>(!pages||pages.includes(p.number))&&!['queued','converting'].includes(p.status)&&(!p.result||p.status==='failed'));
    if(!targets.length){setNotice('所选页面已有结果或正在处理。要重做某页，请选择它后点“重新转换本页”。');return;}
    setEditing(null);setJob(await api('/api/convert-document',{id:job.id,pages:targets.map(p=>p.number),mode}));
    setSelected(targets[0].number);setNotice(`已加入 ${targets.length} 页转换任务。关闭此页面也会继续处理，可以随时回来查看。`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const cancelPending=async()=>{if(!job)return;setBusy(true);try{setJob(await api('/api/cancel-pending',{id:job.id}));setNotice('已取消尚未开始的页面；正在转换的页面会完成，已有结果保留。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const downloadDocument=async()=>{if(!job)return;try{const data=await api(`/api/document-data?id=${job.id}`);downloadChartFile(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`${job.fileName.replace(/\.[^.]+$/,'')}-editable-data.json`);}catch(e){setError((e as Error).message);}};
  const save=async(chart:ImportedChart,figure?:any)=>{if(!job||!page||!result||!editing)return;
    try{const clean=validateImportedChart(chart);const next=await api('/api/save-chart',{id:job.id,page:page.number,elementId:editing,revision:result.revision,chart:clean,figure});setJob(next);setEditing(null);setNotice('图表数据已保存，整页预览已更新。刷新后仍可继续编辑。');}catch(e){setError((e as Error).message);throw e;}
  };
  const saveFigure=async(figure:any)=>{if(!job||!page||!result||!editing)return;setJob(await api('/api/save-figure',{id:job.id,page:page.number,elementId:editing,revision:result.revision,figure}));setEditing(null);setNotice('图形结构已保存并重绘。');};
  if(auditMode)return result?<div className="audit-surface">{result.mode==='charts'?<div className="chart-audit-surface" style={{width:1400,padding:24,background:'#f8f7f5'}}>{result.elements.filter(e=>e.figure).map(e=><section key={e.id} data-element-id={e.id} style={{marginBottom:24}}><PipelineFigure element={e} aspect={result.aspect||16/9} standalone/></section>)}</div>:<PipelinePage result={result}/>}</div>:<p>正在准备绘制检查…</p>;
  return <section className="upload-workspace">
    {embedded&&!independent&&<div className="upload-intro"><h2>Reference Library 图表与数据</h2><p>当前任务的来源权限由调用方管理。转换操作请返回调用方的来源库。</p></div>}
    {independent&&<div className="upload-intro"><div><h2>编辑当前文档的图表</h2><p>这是文档专属副本。保存后回到调用方应用更新文档图表。来源库原图与其他文档保持不变。</p></div></div>}
    {!independent&&!embedded&&<>
    <div className="upload-intro"><div><span className="eyebrow dark">UPLOAD → DATA → EDITABLE CHART</span><h2>把文件里的图表，转成可编辑数据。</h2><p>上传 PDF、PPT 或图片，自动找出每张图表，提取数字和图例，再按所选主题重绘。编辑表格数据后，图表同步更新。</p></div><span className="model-label">{model}</span></div>
    <div className={`upload-drop ${drag?'dragging':''}`} onDragOver={e=>{e.preventDefault();if(!working)setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!working&&e.dataTransfer.files[0])void upload(e.dataTransfer.files[0]);}}>
      <div className="upload-symbol">↑</div><div><strong>{busy?`正在处理文件… ${uploadPercent?`${uploadPercent}%`:''}`:'把文件拖到这里'}</strong><p>PPT / PPTX / PDF / PNG / JPG / WebP · 最大 50 MB，80 页</p></div><button className="primary" disabled={Boolean(working)} onClick={()=>input.current?.click()}>选择文件</button>
      <input ref={input} type="file" hidden aria-label="上传 PPT PDF 或图表图片" accept=".ppt,.pptx,.pdf,.png,.jpg,.jpeg,.webp" onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);e.target.value='';}}/>
    </div>
    <p className="upload-privacy">文件与编辑结果保存在本机；点击转换后，所选页面会发送给已配置的模型服务识别。</p>
    {recent.length>0&&<label className="recent-picker">最近上传 <select aria-label="最近上传的文件" value={job?.id||''} disabled={busy} onChange={e=>void load(e.target.value)}><option value="" disabled>选择文件</option>{recent.map(j=><option key={j.id} value={j.id}>{j.fileName} · {j.pageCount} 页{j.status==='failed'?' · 读取失败':''}</option>)}</select></label>}
    </>}
    {error&&<p role="alert" className="upload-error">{error}</p>}{notice&&<p role="status" className="status-line">{notice}</p>}
    {job?.status==='preparing'&&<div className="upload-progress" role="status"><span className="spinner"/>{job.stage}…</div>}
    {job?.status==='failed'&&<p role="alert" className="upload-error">{job.error}</p>}
    {job?.status==='ready'&&<>
      <div className="upload-document-title"><h3>{job.fileName}</h3><span>{independent?`原稿第 ${job.derivedFrom!.page} 页 · 单张图表副本`:`${job.pages.length} 页 · 文件读取 ${seconds(job.prepareMs)}`}</span></div>
      {!independent&&!embedded&&<><FileCost billing={job.billing}/>
      <div className="document-conversion" data-testid="document-conversion">
        <div><strong>转换这份文件</strong><p>留空会处理所有未完成页；已有结果保留。单页重做请使用下方按钮。</p></div>
        <label>指定页码<input aria-label="指定转换页码" placeholder="全部未完成页，或填写 1-3, 5" value={pageRange} onChange={e=>setPageRange(e.target.value)} disabled={busy}/></label>
        <button className="primary" disabled={busy} onClick={()=>void convertDocument()}>{mode==='charts'?(pageRange.trim()?'转换指定页中的图表':'转换文件中的全部图表'):(pageRange.trim()?'转换指定页':'转换全部未完成页')}</button>
        {Boolean(job.conversion?.queued)&&<button disabled={busy} onClick={()=>void cancelPending()}>取消等待中的页面</button>}
      </div>
      {job.conversion&&<div className="document-progress" role="status"><progress aria-label="文件转换进度" max={job.conversion.total||1} value={job.conversion.generated}/><span>已处理 {job.conversion.generated}/{job.conversion.total} 页 · 转换中 {job.conversion.running} · 排队 {job.conversion.queued} · 待核对 {job.conversion.review} · 需重试 {job.conversion.failed}</span>{Boolean(job.conversion.generated)&&<button onClick={()=>void downloadDocument()}>下载整份可编辑数据 ↓</button>}</div>}
      </>}
      <div ref={strip} className="upload-page-strip" aria-label="选择上传文件中的页面">{visiblePages.map(p=><button key={p.number} aria-pressed={p.number===selected} onClick={()=>{setSelected(p.number);setEditing(null);setError('');setNotice('');}}><img src={asset(job,p,'thumb')} alt={`第 ${p.number} 页缩略图`} loading="lazy"/><span>第 {p.number} 页 <i className={p.status}>{p.result?.audit?.status==='no-charts'?'无图表':labels[p.status]}</i></span></button>)}</div>
      {page&&<>
        {!independent&&!embedded&&<><ConversionCost key={`${job.id}-${page.number}`} billing={page.billing} working={['queued','converting'].includes(page.status)} runs={page.costRuns} configuredModel={model} pageStage={page.stage} pageStatus={page.status} resultQuality={page.result?.quality}/>
        <div className="convert-toolbar"><div className="convert-options"><label><input type="radio" name="extract-mode" checked={mode==='charts'} onChange={()=>{setMode('charts');setView('charts');}} disabled={Boolean(working)}/>提取并转换图表<span>自动识别本页所有图表 · 默认</span></label><label><input type="radio" name="extract-mode" checked={mode==='page'} onChange={()=>{setMode('page');setView('compare');}} disabled={Boolean(working)}/>完整页面试验<span>保留原有整页功能</span></label></div><button className="primary" disabled={Boolean(working)} onClick={()=>void convert()}>{page.status==='queued'?'已排队，等待转换':page.status==='converting'?`转换中 · ${elapsed.toFixed(1)} 秒`:result?'重新转换本页':'转换这一页 →'}</button></div>
        </>}
        {page.status==='converting'&&<div className="upload-progress" role="status"><span className="spinner"/><div><strong>{page.stage}</strong><p>完成后会自动显示结果。其他页面转换失败也不会影响已完成的内容。</p></div><b>{elapsed.toFixed(1)}s</b></div>}
        {page.status==='queued'&&<div className="upload-progress" role="status"><span className="spinner"/>这一页已排队，轮到后会自动转换。</div>}
        {page.status==='failed'&&<p role="alert" className="upload-error">{page.error}</p>}
        {!independent&&!embedded&&result&&<div className="conversion-summary"><div><b>{page.counts?.chart||0}</b> 张数据图表 {Boolean(page.counts?.diagram)&&<><b>{page.counts?.diagram}</b> 个结构图</>}{result.mode!=='charts'&&<><b>{page.counts?.text||0}</b> 组文字 <b>{page.counts?.table||0}</b> 张表格</>}{Boolean(page.counts?.gap)&&<span className="gap-count">{page.counts?.gap} 处待补充</span>}</div><div>全流程 {seconds(result.timing.totalMs)}<span className="badge">{result.audit?.status==='no-charts'?'此页未发现图表':result.audit?.status==='machine-checked'?'自动复核完成 · 待人工确认':'仍需核对'}</span></div></div>}
        {!independent&&!embedded&&result?.quality&&<div className={`page-quality ${result.quality.status==='source-checks-passed'?'passed':''}`}><strong>{result.quality.status==='incomplete'?'这页还原未完成':result.quality.status==='needs-review'?'内容仍有待核对项':'内容完整性检查通过 · 效果待确认'}</strong><p>图形 {result.quality.renderedFigures}/{result.quality.expectedFigures}{result.mode!=='charts'&&<> · 独立素材 {result.quality.assetItemsReady}/{result.quality.assetItems} · 矢量地图 {result.quality.vectorMaps}</>}</p>{result.quality.issues.map((issue:any,i:number)=><p key={i}>{issue.description}</p>)}</div>}
        {!independent&&!embedded&&result?.validation&&<details className="pipeline-audit"><summary>校验规则 · {result.validation.bundle.version} · {result.validation.checks} 次检查 · {result.validation.milliseconds} ms</summary><p>失败次数包含已修复的过程问题；规则通过不等于原图还原验收。</p><a href="?mode=rules" target="_blank" rel="noreferrer">查看规则与格式试验 ↗</a>{result.validation.rules.filter((r:any)=>r.failures).map((r:any)=><p key={r.id}>{r.id} · 触发 {r.failures} 次</p>)}</details>}
        {!independent&&!embedded&&result?.audit&&<details className="pipeline-audit"><summary>查看提取与复核记录 · {result.audit.sourceReviews.length} 个图形复核 · {result.audit.renderReviews.length} 轮绘制检查</summary><p>原生资料：{result.audit.native.spans} 段文字、{result.audit.native.paths} 个矢量路径、{result.audit.native.chartCaches} 个原生图表数据缓存。</p>{result.audit.sourceReviews.map((r:any,i:number)=><p key={i}>{r.elementId}：{r.reviewStatus} {(r.issues||[]).join('；')} {(r.remaining||[]).join('；')}</p>)}{result.audit.renderReviews.map((r:any,i:number)=><div key={i}><strong>第 {i+1} 轮效果检查</strong><p>{r.summary}</p>{r.issues.map((s:any,j:number)=><p key={j}>{s.elementId} · {s.description}</p>)}</div>)}<p>自动检查不代表人工验收。矢量地图和统计图由数据绘制；logo 按独立素材保留，不使用整面 logo 墙贴图。</p></details>}
        {result&&<div className="result-controls"><div className="tabs"><button className={view==='compare'?'active':''} onClick={()=>setView('compare')}>原页 ↔ 转换结果</button><button className={view==='result'?'active':''} onClick={()=>setView('result')}>放大看结果</button><button className={view==='charts'?'active':''} onClick={()=>setView('charts')}>逐张图表与数据</button></div><a href={platformUrl(`/api/asset/${job.id}/result-${page.number}.json`)}>下载本页数据 ↓</a></div>}
        {view==='charts'&&result?<div className="upload-chart-list">{result.elements.filter(e=>e.chart||e.figure).map(e=>{const b=(e as any).sourceBBox||e.bbox;return <section className="upload-chart-card" key={e.id}><div className="section-heading"><h3>{e.chart?.title||e.figure?.title||e.title||'图表'}</h3><div className="button-row">{e.chart&&<button onClick={()=>void (e.figure?pipelineExcel(e.chart!,e.figure):chartExcelFile(e.chart!)).then(blob=>downloadChartFile(blob,`page-${page.number}-${e.id}.xlsx`)).catch(e=>setError(e.message))}>Excel ↓</button>}<button className="primary" disabled={Boolean(working)} onClick={()=>setEditing(e.id)}>{e.chart?'编辑数据 ↗':'编辑结构 ↗'}</button></div></div><div className="chart-conversion-pair"><div><p className="chart-panel-label">原图 · 仅用于对照</p><div className="chart-source-crop" style={{aspectRatio:`${b[2]*(result.aspect||16/9)}/${b[3]}`}}><img src={asset(job,page)} alt={`${e.title||'图表'}的原图区域`} style={{width:`${10000/b[2]}%`,left:`${-b[0]/b[2]*100}%`,top:`${-b[1]/b[3]*100}%`}}/></div></div><div><p className="chart-panel-label">D3 重绘 · 数据可编辑</p>{e.figure?<PipelineFigure element={e} aspect={result.aspect||16/9} standalone onEdit={setEditing}/>:<ImportedChartFigure chart={e.chart!}/>}</div></div>{(e.chart?.warnings||e.figure?.notes||[]).map((w:string,i:number)=><p className="quality-note" key={i}>{w}</p>)}</section>;})}{!result.elements.some(e=>e.chart||e.figure)&&<p className="empty">{result.audit?.status==='no-charts'?'已检查两次，这一页未发现可转换的图表。其他页面会继续处理。':'此页图表尚未完成提取，请查看识别提示或重试。'}</p>}</div>:<div className={view==='result'&&result?'upload-result-only':'upload-page-pair'}>
          {(view!=='result'||!result)&&<div className="comparison-panel"><div className="panel-label">01 / 上传原页 · 第 {page.number} 页</div><img className="uploaded-source" src={asset(job,page)} alt={`上传文件第 ${page.number} 页原图`}/></div>}
          <div className="comparison-panel"><div className="panel-label"><span>02 / {window.CHART_PLATFORM_THEME.name} · 文字、表格与 D3 图表</span>{result&&<span className="live-dot">点击图表编辑</span>}</div>{result?<ThemePage result={result} onEdit={setEditing}/>:<div className="conversion-empty"><span>DATA → D3</span><h3>{page.status==='converting'?'正在识别这一页…':'准备好，看一次真实转换'}</h3><p>选择提取图表或完整页面，点击转换。<br/>结果会出现在这里。</p></div>}</div>
        </div>}
        {result&&<><div className="result-notes"><p>印出的数值优先保留。带清晰坐标刻度的截图或 PDF 可换算近似值，会明确标记；没有可靠依据的数值留空。右侧图表均由数据绘制。</p><p>当前主题：{window.CHART_PLATFORM_THEME.name}。导出保留数据与来源，业务文档由调用方接入。</p></div>{result.warnings.length>0&&<details className="result-warnings"><summary>查看识别提示（{result.warnings.length}）</summary>{result.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}</>}
      </>}
    </>}
    {selectedElement?.chart&&page&&job&&<Editor chart={selectedElement.chart} pipelineFigure={selectedElement.figure} renderChart={selectedElement.figure?(chart,ref,figure)=><PipelineFigure element={{...selectedElement,figure:{...(figure||selectedElement.figure),chart}}} aspect={result?.aspect||16/9} svgRef={ref} standalone/>:undefined} sourceImage={asset(job,page)} onClose={()=>setEditing(null)} onApply={(c,f)=>save(c,f)} applyLabel={result?.mode==='charts'?'保存数据并更新图表':'保存数据并更新整页'} footerText="修改会保存到本机并更新本页图表，刷新后仍保留。"/>}
    {selectedElement?.figure&&!selectedElement.chart&&<StructureEditor element={selectedElement} aspect={result?.aspect||16/9} source={result?.source} onClose={()=>setEditing(null)} onSave={saveFigure}/>}
  </section>;
}
