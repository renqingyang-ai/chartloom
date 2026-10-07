import { useEffect, useRef, useState } from 'react';
import { PipelineFigure } from './pipeline-view';
import { ganttErrors } from './components/gantt';
import { GanttFields } from './components/gantt-fields';
import { ganttCarrier, ganttExcel, ganttFromExcel } from './components/gantt-export';
import { pipelineSvg, pipelinePng } from './pipeline-export';
import { downloadChartFile } from '@/lib/chart-import/export';

export function StructureEditor({element,aspect,source,onSave,onClose}:{element:any;aspect:number;source?:any;onSave:(figure:any)=>Promise<void>;onClose:()=>void}){
 const [figure,setFigure]=useState(()=>structuredClone(element.figure)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 const svg=useRef<SVGSVGElement>(null),file=useRef<HTMLInputElement>(null),[reviewed,setReviewed]=useState(false);
 const problems=figure.kind==='gantt'?ganttErrors(figure):[];
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 const update=(fn:(f:any)=>void)=>{setReviewed(false);setFigure((old:any)=>{const next=structuredClone(old);fn(next);return next;});};
 const field=(label:string,value:any,change:(v:string)=>void,multi=false)=><label className="structure-field">{label}{multi?<textarea aria-label={label} value={value||''} onChange={e=>change(e.target.value)}/>:<input aria-label={label} value={value??''} onChange={e=>change(e.target.value)}/>}</label>;
 const preview=structuredClone(figure);
 if(preview.kind==='tiers'&&JSON.stringify(preview.tiers.map((t:any)=>t.cities.length))!==JSON.stringify(element.figure.tiers.map((t:any)=>t.cities.length)))delete preview.nativeGeometry;
 return <dialog ref={dialog} className="editor-dialog structure-dialog" aria-label="编辑图形结构" onCancel={onClose}>
  <div className="editor-top"><div><span className="eyebrow">STRUCTURE / LIVE PREVIEW</span><h2>编辑图形内容</h2></div><button onClick={onClose} aria-label="关闭结构编辑器">关闭 ×</button></div>
  <div className="editor-grid"><section className="editor-data">
   {field('图形标题',figure.title,v=>update(f=>{f.title=v;}))}
   {figure.kind==='gantt'&&source&&<div className="button-row"><button disabled={busy||!!problems.length} onClick={()=>void action(async()=>downloadChartFile(await ganttExcel(figure,source),'schedule.xlsx'))}>导出 Excel</button><button disabled={busy} onClick={()=>file.current?.click()}>导入 Excel</button><input type="file" accept=".xlsx" hidden ref={file} onChange={e=>{const next=e.target.files?.[0];if(next)void action(async()=>{setFigure(await ganttFromExcel(next,figure));setReviewed(false);});e.target.value='';}}/></div>}
   {figure.kind==='timeline'&&<>{figure.phases.map((p:any,i:number)=><fieldset key={i}><legend>阶段 {i+1}</legend>
    {field(`阶段 ${i+1} 标题`,p.title,v=>update(f=>{f.phases[i].title=v;}))}
    {p.events.map((e:any,j:number)=><div className="structure-item" key={j}>
     {field(`阶段 ${i+1} 事件 ${j+1} 日期`,e.date,v=>update(f=>{f.phases[i].events[j].date=v;}))}
     {field(`阶段 ${i+1} 事件 ${j+1} 说明`,e.description,v=>update(f=>{f.phases[i].events[j].description=v;}),true)}
     <button disabled={p.events.length===1} onClick={()=>update(f=>{f.phases[i].events.splice(j,1);})}>删除事件 {j+1}</button>
    </div>)}<div className="button-row"><button disabled={p.events.length>=30} onClick={()=>update(f=>{f.phases[i].events.push({date:'',description:''});})}>添加事件</button><button disabled={figure.phases.length===1} onClick={()=>update(f=>{f.phases.splice(i,1);})}>删除阶段</button></div>
   </fieldset>)}<button disabled={figure.phases.length>=12} onClick={()=>update(f=>{f.phases.push({title:'新阶段',events:[{date:'',description:''}]});})}>添加阶段</button></>}
   {figure.kind==='tiers'&&<><p>每行一个成员。增加或删除成员时会重新安排位置。</p>{figure.tiers.map((t:any,i:number)=><fieldset key={i}><legend>层级 {i+1}</legend>
    {field(`层级 ${i+1} 名称`,t.name,v=>update(f=>{f.tiers[i].name=v;}))}
    {field(`层级 ${i+1} 成员`,t.cities.join('\n'),v=>update(f=>{f.tiers[i].cities=v.split('\n');}),true)}
    <button disabled={figure.tiers.length===1} onClick={()=>update(f=>{f.tiers.splice(i,1);})}>删除层级</button>
   </fieldset>)}<button disabled={figure.tiers.length>=10} onClick={()=>update(f=>{f.tiers.push({name:'新层级',cities:['新成员']});})}>添加层级</button></>}
   {figure.nativeGeography&&<><p>图形由 PDF 矢量路径绘制；以下每行文字都能修改并即时重绘。</p>{figure.mapLabels.map((label:any,i:number)=><div key={label.id}>{field(`图形文字 ${i+1}`,label.text,v=>update(f=>{f.mapLabels[i].text=v;}))}</div>)}</>}
   {['map','diagram'].includes(figure.kind)&&!figure.nativeGeography&&<><p>横向、纵向位置均为图内的百分比（0–100），不是经纬度。</p>{figure.nodes.map((n:any,i:number)=><fieldset key={n.id}><legend>节点 {i+1}</legend>
    {field(`节点 ${i+1} 文字`,n.label,v=>update(f=>{f.nodes[i].label=v;}),true)}
    <div className="structure-coordinates">{(['x','y'] as const).map(k=><label key={k}>{k==='x'?'横向':'纵向'}位置<input aria-label={`节点 ${i+1} ${k}`} type="number" min="0" max="100" value={n[k]} onChange={e=>update(f=>{f.nodes[i][k]=Number(e.target.value);})}/></label>)}</div>
   </fieldset>)}{(figure.edges||[]).map((e:any,i:number)=>field(`连线 ${i+1} 标注`,e.label,v=>update(f=>{f.edges[i].label=v;})))}</>}
   {figure.kind==='gantt'&&<GanttFields figure={figure} update={update}/>}
  </section><section className="editor-preview"><h3>实时预览</h3><PipelineFigure element={{...element,figure:preview}} aspect={aspect} svgRef={svg} standalone/><p>图形由这些内容重新绘制。修改后仍需核对原始资料。</p>{figure.kind==='gantt'&&source&&<><label className="review-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已核对本次数据、来源和标注</label><div className="button-row">{['SVG','PNG'].map(format=><button key={format} disabled={!reviewed||busy||!!problems.length} onClick={()=>void action(async()=>{const c=ganttCarrier(figure,source,reviewed),blob=format==='SVG'?new Blob([await pipelineSvg(svg.current!,c,figure)],{type:'image/svg+xml'}):await pipelinePng(svg.current!,c,figure);downloadChartFile(blob,'schedule.'+format.toLowerCase());})}>导出 {format}</button>)}</div></>}</section></div>
  {problems.length>0&&<p role="alert" className="editor-message">{problems.join(' ')}</p>}
  {error&&<p role="alert" className="editor-message">{error}</p>}
  <footer className="editor-footer"><p>保存在本机，刷新后继续保留。</p><button className="primary" disabled={busy||!!problems.length} onClick={async()=>{setBusy(true);setError('');try{await onSave(figure);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'保存中…':'保存并重绘'}</button></footer>
 </dialog>;
}
