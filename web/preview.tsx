import {platformUrl, embeddedEditor} from '@/lib/chart-platform-url';
import {ValidationWorkspace} from './validation-workspace';
import './validation-client';
/** Standalone editor. Callers supply their file and a versioned theme. */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UploadWorkspace } from './upload';
import {DataWorkspace} from './data-workspace';
import { FigureAnnotationFields } from './components/annotation-fields';

import { pipelinePng, pipelineSvg, pipelineExcel, figureFromVisibleCells } from './pipeline-export';
import { ChartDataEditor } from '@/components/chart-import/ChartDataEditor';
import { TrialChartFigure as ImportedChartFigure } from './components/trial-chart';
import { ReferenceFigureEditor } from '@/components/chart-import/ReferenceFigureEditor';
import { chartExcelFile, chartFromWorkbook, chartWorksheetNames } from '@/lib/chart-import/excel';
import { readChartWorkbook } from '@/lib/chart-import/spreadsheet';
import { chartSvg, chartPngFile, downloadChartFile } from '@/lib/chart-import/export';
import { validateImportedChart, type ImportedChart } from '@/types/chart-import';

const keyOf = (c: ImportedChart) => c.referenceFigure?.key || `uploaded-chart-${c.source.sha256.slice(0,12)}`;
const quality = (c:ImportedChart) => [...c.warnings,...(c.series.some(s=>s.values.includes(null))?['Unknown values remain blank.']:[])].join(' ') || 'Compare source values, units and annotations before accepting.';

function Editor({ chart, onApply, onClose, sourceImage, sourceContent, footerText, applyLabel, renderChart, pipelineFigure }: { chart: ImportedChart; onApply: (chart: ImportedChart,figure?:any) => void | Promise<void>; onClose: () => void; sourceImage?: string; sourceContent?: React.ReactNode; footerText?: string; applyLabel?: string; renderChart?: (chart:ImportedChart,ref:React.Ref<SVGSVGElement>,figure?:any)=>React.ReactNode;pipelineFigure?:any }) {
  const [draft,setDraft] = useState(() => structuredClone(chart));
  const [valid,setValid] = useState(true);
  const [draftFigure,setDraftFigure]=useState(()=>pipelineFigure?structuredClone(pipelineFigure):null);
  const changeChart=(next:ImportedChart)=>{
    if(draftFigure)setDraftFigure((f:any)=>{
      const mapValues=(values:any[])=>next.labels.map((label,i)=>{const old=next.labels.length===draft.labels.length?i:draft.labels.indexOf(label);return old<0?null:values[old]??null;});
      const rename=(name:string)=>next.series.length===draft.series.length?next.series[draft.series.findIndex(s=>s.name===name)]?.name:next.series.find(s=>s.name===name)?.name;
      f={...f,legendOrder:(f.legendOrder||[]).flatMap((name:string)=>{const replacement=f.kind==='pie'?(next.labels.length===draft.labels.length?next.labels[draft.labels.indexOf(name)]:next.labels.find(label=>label===name)):rename(name);return replacement!==undefined?[replacement]:(f.categoryCallouts||[]).some((a:any)=>a.label===name)?[name]:[];}),barBaselines:(f.barBaselines||[]).flatMap((b:any)=>{const series=rename(b.series),oldIndex=b.categoryIndex??draft.labels.indexOf(b.category),index=next.labels.length===draft.labels.length?oldIndex:next.labels.findIndex(label=>label===draft.labels[oldIndex]);return series!==undefined&&index>=0&&index<next.labels.length?[{...b,series,category:next.labels[index],categoryIndex:index}]:[];})};
      return {...f,title:next.title,totals:f.totals?.length?mapValues(f.totals):[],categoryCallouts:(f.categoryCallouts||[]).map((a:any)=>({...a,values:mapValues(a.values)})),seriesAnnotations:(f.seriesAnnotations||[]).flatMap((a:any)=>{const index=draft.series.findIndex(s=>s.name===a.series),name=next.series.length===draft.series.length?next.series[index]?.name:next.series.find(s=>s.name===a.series)?.name;return name===undefined?[]:[{...a,series:name}];})};
    });
    setDraft(next);
  };

  const [epoch,setEpoch] = useState(0);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const [prepared,setPrepared] = useState<{url:string;name:string}|null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{const kind=pipelineFigure?.kind;if(!['pie','scatter','curves','heatmap','boxplot','candlestick','bubble'].includes(kind))return;const root=dialog.current;const type=root?.querySelector<HTMLSelectElement>('[aria-label="Chart type"]');if(type){type.disabled=true;type.selectedOptions[0].text=kind==='pie'?'Pie / Donut':kind==='scatter'?'Scatter (X / Y)':kind==='curves'?'Curves':kind;}if(kind!=='curves')root?.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{if(b.textContent==='+ Series'||b.getAttribute('aria-label')?.startsWith('Remove series'))b.disabled=true;});},[draft,pipelineFigure]);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => () => { if(prepared) URL.revokeObjectURL(prepared.url); }, [prepared]);
  const prepareDownload = async (blob:Blob,name:string) => {
    if(prepared)URL.revokeObjectURL(prepared.url);
    setPrepared({url:URL.createObjectURL(blob),name});setMessage('文件已生成，请点击下方下载链接保存。');
  };
  const task = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await fn(); } catch(e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const importExcel = async (file: File) => task(async () => {
    const book = await readChartWorkbook(file);
    const sheet=chartWorksheetNames(book)[0],range=book.book.Sheets[sheet]?.['!ref']||'';
    const next = await chartFromWorkbook(book,sheet,range,draft);
    if(draftFigure?.dataDesign?.kind==='combo')next.warnings=next.warnings.filter(w=>!w.startsWith('Mixed percentage'));
    if(draftFigure)setDraftFigure(await figureFromVisibleCells(book,draftFigure,next));
    setDraft(next); setEpoch(x=>x+1); setMessage('已读入 Excel 的可见单元格，右侧为更新后的预览。');
  });
  return <dialog ref={dialog} className="editor-dialog" aria-label="编辑图表数据" onCancel={onClose}>
    <div className="editor-top"><div><span className="eyebrow">EDIT DATA / LIVE D3</span><h2>{draft.title}</h2></div><button onClick={onClose} aria-label="关闭编辑器">关闭 ×</button></div>
    <div className="editor-grid">
      <section className="editor-data">
        <div className="section-heading"><h3>数据与标注</h3><div className="button-row"><button disabled={busy || !valid} onClick={()=>task(async()=>downloadChartFile(await (draftFigure?pipelineExcel(draft,draftFigure):chartExcelFile(draft)),`${keyOf(draft)}.chart.xlsx`))}>导出 Excel</button><button disabled={busy} onClick={()=>file.current?.click()}>导入 Excel</button></div></div>
        <input type="file" hidden ref={file} accept=".xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f) void importExcel(f);e.target.value='';}} />
        <div className="native-editor"><>{draft.referenceFigure?<ReferenceFigureEditor key={epoch} chart={draft} onChange={changeChart} onValidityChange={setValid} />:<ChartDataEditor key={epoch} chart={draft} onChange={changeChart} onValidityChange={setValid} fixedGeometryLabel={draftFigure?.dataDesign&&['combo','pie','donut','scatter','area'].includes(draftFigure.dataDesign.kind)?({combo:'组合图 / 双轴',pie:'饼图',donut:'环形图',scatter:'散点图',area:'面积图'} as Record<string,string>)[draftFigure.dataDesign.kind]:undefined} />}</></div>
        {draftFigure&&!draftFigure.dataDesign&&<FigureAnnotationFields figure={draftFigure} chart={draft} onChange={f=>{setDraftFigure(f);setDraft({...draft,reviewed:false,userEdited:true});}}/>}
        <p className="editor-help">{draft.referenceFigure?'数值、系列名称、合计、利润率、CAGR 各有对应工作表。修改基础数据后，请一并核对这些标注。':'直接改单元格，或粘贴 Excel 数据。空白保留为未知；修改后请核对脚注与 CAGR，它们不会自动重算。'}</p>
      </section>
      <section className="editor-preview"><div className="section-heading"><h3>D3 实时预览</h3><span className="badge">{draft.userEdited?(draft.reviewed?'已修改 · 已核对':'已修改 · 待核对'):'原始提取数据'}</span></div>
        <div className="live-chart">{renderChart?renderChart(draft,svg,draftFigure):<ImportedChartFigure ref={svg} chart={draft} />}</div>
        <p className="quality-note">{quality(draft)}</p>
        <details className="source-detail"><summary>{sourceContent?"查看输入数据":"查看原稿"}</summary>{sourceContent||<img src={sourceImage||`original/${keyOf(draft)}.png`} alt={`原稿 ${draft.title}`} />}</details>
        <label className="review-check"><input type="checkbox" checked={draft.reviewed} onChange={e=>setDraft({...draft,reviewed:e.target.checked})} />我已核对本次数据、来源和标注</label>
        <div className="button-row"><button disabled={busy || !valid || !draft.reviewed} onClick={()=>task(async()=>prepareDownload(await (pipelineFigure?pipelinePng(svg.current!,draft,draftFigure):chartPngFile(svg.current!,draft)),`${keyOf(draft)}.png`))}>导出 PNG（含数据）</button><button disabled={busy || !valid || !draft.reviewed} onClick={()=>task(async()=>prepareDownload(new Blob([await (pipelineFigure?pipelineSvg(svg.current!,draft,draftFigure):chartSvg(svg.current!,draft))],{type:'image/svg+xml'}),`${keyOf(draft)}.svg`))}>导出 SVG</button></div>
        {prepared&&<p className="download-ready"><a href={prepared.url} download={prepared.name}>下载 {prepared.name} ↓</a><span>生成时的数据快照</span></p>}
      </section>
    </div>
    {message && <p role="status" className="editor-message">{message}</p>}
    <footer className="editor-footer"><p>{footerText||"仅应用到本次对比预览。刷新恢复原始数据，整页快照与 OM 不随此处修改。"}</p><button className="primary" disabled={!valid || busy} onClick={()=>void task(async()=>{await onApply(draft,draftFigure);})}>{applyLabel||"应用到对比预览"}</button></footer>
  </dialog>;
}

function App(){
 const embedded=embeddedEditor();
 const requestedMode=new URLSearchParams(location.search).get('mode')||'upload';
 const mode=embedded&&requestedMode!=='data'?'upload':requestedMode;
 const theme=window.CHART_PLATFORM_THEME;
 return <>{!embedded&&<><header className="platform-header"><div><span className="eyebrow dark">CHARTLOOM</span><h1>让图表变成可编辑的数据。</h1><p>上传原图重绘，或直接用数据和需求生成图表。</p></div><label>预览主题 <select aria-label="Chart theme" defaultValue={theme.id} onChange={e=>{const q=new URLSearchParams(location.search);q.set('theme',e.target.value);location.search=q.toString();}}><option value="om">浅色编辑主题</option><option value="neutral">通用蓝色</option></select><small style={{display:'block',marginTop:8,color:'#7c857e'}}>新任务使用所选主题</small></label></header>
 <nav className="toolbar"><div className="mode-switch"><a className={mode==='upload'?'active':''} href="?mode=upload">上传并转换</a><a className={mode==='data'?'active':''} href="?mode=data">用数据生成</a><a className={mode==='rules'?'active':''} href="?mode=rules">动态校验与纠错</a><a className={mode==='components'?'active':''} href="?mode=components">图表组件</a><a href={platformUrl("/api/v1/capabilities")} target="_blank">接口说明 ↗</a></div></nav></>}
 <main>{mode==='data'?<DataWorkspace Editor={Editor}/>:mode==='rules'?<ValidationWorkspace/>:mode==='components'?<section className="component-catalog"><h2>可复用的 D3 图表组件</h2><p>固定组件按每次提取的数据与结构绘制，同一份数据可以使用不同主题。</p><div className="catalog-grid">{['柱状 / 分组 / 堆叠','折线 / 面积 / 混合 / 双轴','饼图 / 环形','散点 / 气泡','曲线 / 误差线','热力图','箱线图','K 线图','甘特 / 日程','时间轴','层级图','原生矢量结构图'].map(name=><article key={name}><h3>{name}</h3><p>数据、原图结构、标签、注释与主题。</p></article>)}</div><p>组件支持不等于所有截图都已通过还原验收。原图保留，便于逐项核对。</p></section>:<UploadWorkspace Editor={Editor}/>}</main>
 <footer className="site-footer"><span>Chartloom · 图表转换与编辑</span><span>识别 → 复核 → D3 → 编辑 · 结果待核对</span></footer></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
