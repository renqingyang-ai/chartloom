import {platformUrl} from '@/lib/chart-platform-url';
import {Fragment, useEffect, useState} from 'react';

export interface Billing {
  status:string; complete:boolean; estimatedCostUsd:number|null; knownCostUsd:number;
  apiCalls:number; localCacheHits:number; unknownCalls:number; unknownProviderAttempts:number;
  runs?:number; unmeteredPages?:number[]; records?:any[]; errors?:string[];
  tokens?:Record<string,number>; runId?:string; startedAt?:string; finishedAt?:string;
  runStatus?:string; phases?:{at:string;name:string}[]; runInfo?:Record<string,any>;
}
const usd=(v:number)=>v>0&&v<.00000001?'< $0.00000001':`$${v.toFixed(8).replace(/0+$/,'').replace(/\.$/,'.00')}`;
const summaryUsd=(v:number)=>v>0&&v<.0001?'< $0.0001':`$${v.toFixed(4)}`;
const count=(v:unknown)=>typeof v==='number'?v.toLocaleString():'—';
const duration=(ms?:number)=>typeof ms==='number'?`${(ms/1000).toFixed(2)} s`:'—';
const stamp=(s?:string)=>s?new Date(s).toLocaleTimeString('zh-CN',{hour12:false}):'—';
const friendly=(m:string)=>m.replace(/^gemini\//,'').replace(/^gemini-(\d+\.\d+)-flash$/,'Gemini $1 Flash');
const amount=(b?:Billing)=>!b||b.status==='unrecorded'?'未记录费用':b.complete?`估算 ${usd(b.estimatedCostUsd!)}`:`已知 ${usd(b.knownCostUsd)} · 未统计完整`;
const steps:[string,string,string][]=[
  ['data-design','设计图表','根据需求选择图型、字段与坐标轴，数值由程序从输入表格读取。'],
  ['region-coordinate-check','重新定位区域','对照整张原图，纠正图表裁切区域的坐标。'],
  ['chart-discovery-check','补查遗漏图表','再次检查原图，确认是否漏掉独立图表。'],
  ['inventory','识别图表区域','找出页面里有几张图、分别是什么类型、位于哪里。'],
  ['format-rule','提出格式规则','识别特殊数字写法并提出规则候选，供程序验证。'],
  ['repair-text','修正文字','对照原稿纠正文字或表格，保留数字与脚注。'],
  ['visual-review','检查绘制结果','同时看原图与 D3 结果，查找漏图、漏字、错位和数字差异。'],
  ['measure','测量图形位置','按图形位置和坐标轴恢复未印出的值，保留近似标记。'],
  ['extract','提取图表数据','读取分类、系列、数字、图例、单位和注释，转为可编辑数据。'],
  ['check','核对图表数据','对照原图复核刚提取的数据，检查遗漏和对应关系。'],
  ['layout','提取图内布局','读取坐标轴、柱宽、图例与标签的位置，供固定 D3 组件使用。'],
  ['repair','修正提取结果','根据检查发现的问题，再对照原图修正数据或结构。'],
];
const purpose=(stage:string)=>stage.includes('-repair')?['针对问题修正',stage.startsWith('layout-')?'根据上轮检查的问题，重新读取图内布局后再绘制。':'对照原图重新提取有问题的数据或结构。']:steps.find(([id])=>stage===id||stage.startsWith(id+'-'))?.slice(1)??[stage,'本次转换的模型处理步骤。'];
const fieldNames:Record<string,string>={mode:'转换模式',nativeText:'PDF 原生文字',nativeCharts:'PPT 原生图表',nativeImages:'原生图片索引',nativeVectorCount:'PDF 矢量数量',region:'图表区域',nativeEvidence:'原生文字与图形证据',rasterTextMeasurements:'OCR 文字坐标',pageContext:'整页上下文',repairInstruction:'修正要求',candidate:'待核对的数据',deterministicIssues:'程序检查发现的问题',figure:'图表数据与结构',sourceText:'来源文字',previousLayout:'上轮布局',validationIssues:'布局问题',missing:'未识别的数据位置',elements:'已提取图形',domChecks:'浏览器绘制检查',sourceCompleteness:'内容完整性检查',nativeSourceText:'原稿文字',nativeNumberColors:'原生数字与颜色对应'};
function outputText(r:any) {
  const s=r.structuredResponse;
  if(r.status==='pending')return '等待模型返回';
  if(r.outcome==='error')return `请求失败 · ${r.errorType||'未返回完整响应'}`;
  if(s?.status==='invalid')return `响应格式不可读 · ${s.errorType||'格式错误'}`;
  if(!s)return '历史记录未保存返回摘要';
  const v=s.summary||{},parts=[];
  for(const [key,label] of [['elementsCount','个页面区域'],['categoryCount','个分类'],['seriesCount','个系列'],['valueCount','个数据格'],['issuesCount','个检查问题'],['warningsCount','条提示']] as const)if(v[key]!==undefined)parts.push(`${v[key]} ${label}`);
  return parts.length?parts.join(' · '):`已解析结构数据${v.fields?.length?' · '+v.fields.join(' / '):''}`;
}
function state(r:any) {
  if(r.status==='pending')return ['running','等待响应'];
  if(r.outcome==='error')return ['error','请求失败'];
  if(r.structuredResponse?.status==='invalid')return ['error','格式错误'];
  if(r.localCache)return ['cache','本地复用'];
  return ['done',r.structuredResponse?'已返回 · 已解析':'已返回'];
}
function download(value:unknown,name:string){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function FileCost({billing}:{billing?:Billing}) {
  return <p className="billing-file" data-testid="file-cost">文件累计：<strong>{amount(billing)}</strong>
    {Boolean(billing?.runs)&&<span> · {billing!.runs} 次转换记录（含重做和失败）</span>}
    {Boolean(billing?.unmeteredPages?.length)&&<span> · {billing!.unmeteredPages!.length} 页有历史用量缺失</span>}
  </p>;
}

export function ConversionCost({billing,working,runs={},configuredModel='',pageStage='',pageStatus='',resultQuality}:{billing?:Billing;working:boolean;runs?:Record<string,Billing>;configuredModel?:string;pageStage?:string;pageStatus?:string;resultQuality?:any}) {
  const [prices,setPrices]=useState<any>(null),[priceError,setPriceError]=useState('');
  const [selected,setSelected]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(1),[expanded,setExpanded]=useState<string|null>(null);
  useEffect(()=>{let active=true;fetch(platformUrl('/api/pricing')).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(p=>{if(active)setPrices(p);}).catch(()=>{if(active)setPriceError('当前价格表暂时不可用；已有记录仍保留当时价格。');});return()=>{active=false;};},[]);
  const current=selected?runs[selected]:billing;
  const records=[...(current?.records||[])].sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const tokens=records.some(r=>r.localCache||r.usage?.valid)?current?.tokens:undefined,actualModels=[...new Set(records.map(r=>r.responseModel).filter(Boolean))] as string[];
  const requested=[...new Set(records.map(r=>r.requestedModel).filter(Boolean))] as string[];
  const historical=Boolean(selected&&selected!==billing?.runId),live=working&&!historical;
  const first=current?.startedAt||records[0]?.startedAt,last=current?.finishedAt||records.at(-1)?.finishedAt;
  const wallMs=first?(live?Date.now():last?Date.parse(last):Date.parse(first))-Date.parse(first):undefined;
  const usedPrices=Array.from(new Map(records.filter(r=>r.price).map(r=>[r.price.sha256,r.price])).values()) as any[];
  const pendingPrice=prices?.rates?.filter((p:any)=>p.provider==='google-gemini'&&p.models.includes(configuredModel)&&p.mode==='standard'&&Date.parse(p.effectiveFrom)<=Date.now()&&(!p.effectiveUntil||Date.now()<Date.parse(p.effectiveUntil)))||[];
  const visiblePrices=usedPrices.length?usedPrices:pendingPrice;
  const filtered=records.filter(r=>filter==='all'||filter==='retry'&&(r.attempt>1||r.unknownProviderAttempts>0||r.outcome==='error'||r.structuredResponse?.status==='invalid'||r.stage.includes('-repair'))||filter==='unknown'&&r.estimatedCostUsd==null);
  const pages=Math.max(1,Math.ceil(filtered.length/8)),pageNo=Math.min(page,pages),visible=filtered.slice((pageNo-1)*8,pageNo*8);
  const history=Object.values(runs).sort((a,b)=>Number(b.runId?.split('-').at(-1)||0)-Number(a.runId?.split('-').at(-1)||0));
  const inputCost=records.reduce((n,r)=>n+(r.usage?.valid&&r.price?(r.usage.inputTokens-r.usage.cachedInputTokens)*Number(r.price.inputPerMillion)/1e6+r.usage.cachedInputTokens*Number(r.price.cachedInputPerMillion)/1e6:0),0);
  const outputCost=records.reduce((n,r)=>n+(r.usage?.valid&&r.price?r.usage.outputTokens*Number(r.price.outputPerMillion)/1e6:0),0);
  const quality=current?.runInfo?.result||(!historical&&!live?resultQuality:null);
  const qualityStatus=quality?.qualityStatus||quality?.status;
  const stateText=historical?'历史运行':live?'实时更新':current?.runStatus==='failed'?'运行中断':pageStatus==='failed'?'本页未完成':pageStatus==='partial'?'执行结束 · 图表待核对':records.length?'执行记录已保存':'尚无用量记录';
  return <section className="billing-panel observation-panel" data-testid="conversion-cost" id="conversion-log">
    <header className="observation-heading"><div><span className="observation-eyebrow">CONVERSION LOG</span><h3>运行观测 <span className={'observation-state '+(live?'is-live':'')}>{stateText}</span></h3><p>每一步在做什么、模型返回什么，以及时间和费用花在哪里。</p></div><div className="observation-actions">
      {history.length>0&&<label>运行记录<select aria-label="选择运行记录" value={selected} onChange={e=>{setSelected(e.target.value);setPage(1);setExpanded(null);}}><option value="">本页最新运行</option>{history.map(b=><option value={b.runId} key={b.runId}>{new Date(b.startedAt||b.records?.[0]?.startedAt||0).toLocaleString('zh-CN')} · {amount(b)}</option>)}</select></label>}
      <button disabled={!current} onClick={()=>download(current,'conversion-run-log.json')}>下载本次日志 ↓</button>
    </div></header>
    <div className="observation-model"><strong>{actualModels.length?actualModels.map(friendly).join(' / '):live?friendly(configuredModel||'等待模型响应'):'实际模型未记录'}</strong><span>{actualModels.length?'实际响应模型':'尚未取得实际响应'}</span><code>{actualModels.join(' · ')||'—'}</code><small>{requested.length?'请求模型：':'当前配置模型：'}{requested.join(' / ')||configuredModel||'未取得配置'}</small></div>
    <div className="observation-metrics">
      <div><span>输入 token</span><strong>{count(tokens?.inputTokens)}</strong><small>其中缓存 {count(tokens?.cachedInputTokens)}</small></div>
      <div><span>输出 token（含思考）</span><strong>{count(tokens?.outputTokens)}</strong><small>其中思考 {count(tokens?.thinkingTokens)}{records.some(r=>!r.localCache&&typeof r.usage?.thinkingTokens!=='number')?' · 部分未返回':''}</small></div>
      <div><span>模型费用 · USD</span><strong title={current?usd(current.knownCostUsd):undefined}>{current?.status==='unrecorded'||!current?'未知':summaryUsd(current.knownCostUsd)}</strong><small>{live?'截至目前的已知费用':current?.complete?'按本次价格估算':'已知部分，尚未统计完整'}</small></div>
      <div><span>{current?.startedAt?'本次经过时间':'模型请求时段'}</span><strong>{duration(wallMs)}</strong><small>{!current||current.status==='unrecorded'?'调用次数未记录':`${current.apiCalls} 次模型请求 · ${current.localCacheHits} 次本地复用`}</small></div>
    </div>
    <div className="observation-prices">{visiblePrices.map((p:any)=><div key={p.sha256||p.id}><strong>{usedPrices.length?'本次采用价格':'当前配置价格 · 不补算历史'} · {p.mode}</strong><span>每百万 token：输入 <b>${p.inputPerMillion}</b> / 缓存 <b>${p.cachedInputPerMillion}</b> / 输出 <b>${p.outputPerMillion}</b></span><a href={p.source} target="_blank" rel="noreferrer">官方来源 ↗</a><small>有效期 {p.effectiveFrom.slice(0,10)} → {p.effectiveUntil?.slice(0,10)||'后续'} · {p.catalogVersion||prices?.version}</small></div>)}{!visiblePrices.length&&<p>没有匹配的价格记录，不套用其他模型单价。</p>}</div>
    {live&&<p className="observation-live" role="status"><span className="spinner"/>{pageStage||'正在处理'} · 用量在每次响应后更新，等待中的请求不会记成零元。</p>}
    {!live&&(!current||current.status==='unrecorded')&&<p className="quality-note">这次运行没有保存 token 用量与调用日志。历史费用未知；新的转换会记录完整过程。</p>}
    {current?.runInfo?.errorType&&<p className="quality-note">运行中断：{current.runInfo.errorType}。已返回的用量与先前结果保留。</p>}
    {Boolean(current?.unknownCalls||current?.unknownProviderAttempts)&&<p className="quality-note">{current!.unknownCalls} 次请求正在等待或缺少用量/价格；{current!.unknownProviderAttempts} 次底层请求的费用未取得。总额尚不完整。</p>}
    {Boolean(current?.errors?.length)&&<p className="quality-note">部分统计记录不完整；已有图表和已知费用仍保留。</p>}
    {Boolean(current?.phases?.length)&&<details className="observation-phases" open><summary>执行路径 · 包含本地程序与 D3</summary><ol>{current!.phases!.map((p,i)=><li key={i}><time>{stamp(p.at)}</time><span>{p.name}</span></li>)}</ol><small>这里是流程事件；模型费用只统计下面的实际请求。D3 绘制和数据编辑本身不调用模型。</small></details>}
    {quality&&<div className={'observation-quality '+(qualityStatus==='needs-review'?'needs-review':'')}><strong>{qualityStatus==='needs-review'?'图表结果仍需核对':'自动检查记录 · 不代表人工验收'}</strong><span>图形 {quality.renderedFigures??'—'} / {quality.expectedFigures??'—'} · {quality.issueCount??quality.issues?.length??0} 条待核对信息</span>{quality.issues?.length>0&&<details><summary>查看原始检查提示</summary><ul>{quality.issues.slice(0,5).map((q:any,i:number)=><li key={i}>{q.description||q.kind}</li>)}</ul></details>}</div>}
    <div className="observation-log-heading"><h4>模型调用日志 <span>{records.length} 条</span></h4><label>筛选 <select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="all">全部请求</option><option value="retry">错误与重试</option><option value="unknown">用量或价格未完整</option></select></label></div>
    <div className="billing-table-scroll"><table className="observation-log"><thead><tr><th>开始 / 耗时</th><th>用来做什么 / 返回了什么</th><th>状态</th><th>输入 / 缓存</th><th>输出 / 思考</th><th>费用 USD</th><th>详情</th></tr></thead><tbody>{visible.map(r=>{const [title,description]=purpose(r.stage),[kind,status]=state(r);return <Fragment key={r.id}><tr><td><time>{stamp(r.startedAt)}</time><small>{r.status==='pending'?duration(Date.now()-Date.parse(r.startedAt)):duration(r.ms)}</small></td><td className="observation-purpose"><strong>{title}{r.attempt>1?` · 第 ${r.attempt} 次尝试`:''}</strong><span>{description}</span><small className="observation-response">{outputText(r)}</small></td><td><span className={'request-state '+kind}>{status}</span>{Boolean(r.unknownProviderAttempts)&&<small>{r.unknownProviderAttempts} 次底层请求待核账</small>}</td><td>{r.localCache?'0':count(r.usage?.inputTokens)}<small>缓存 {r.localCache?'0':count(r.usage?.cachedInputTokens)}</small></td><td>{r.localCache?'0':count(r.usage?.outputTokens)}<small>思考 {r.localCache?'0':count(r.usage?.thinkingTokens)}</small></td><td>{r.estimatedCostUsd==null?r.status==='pending'?'等待返回':'未知':usd(r.estimatedCostUsd)}</td><td><button aria-label={`查看 ${r.stage} 第 ${r.attempt} 次请求详情`} aria-expanded={expanded===r.id} onClick={()=>setExpanded(expanded===r.id?null:r.id)}>{expanded===r.id?'收起':'展开'}</button></td></tr>
      {expanded===r.id&&<tr className="observation-detail"><td colSpan={7}><dl><dt>请求标识</dt><dd>{r.stage} · {r.id}</dd><dt>模型</dt><dd>请求 {r.requestedModel} → 实际 {r.responseModel||'未返回'} · {r.provider} · {r.mode}</dd><dt>送入材料</dt><dd>{r.request?`${r.request.imageCount} 张图片，共 ${(r.request.imageBytes/1024).toFixed(1)} KB；指令 ${count(r.request.instructionCharacters)} 字符；上下文 ${count(r.request.contextCharacters)} 字符。包含：${r.request.dataFields.map((k:string)=>fieldNames[k]||k).join('、')||'无额外字段'}`:'历史记录未保存材料摘要。'}</dd><dt>输出</dt><dd>{outputText(r)}{r.structuredResponse?.characters!=null?` · 响应 ${count(r.structuredResponse.characters)} 字符`:''}{r.structuredResponse?.finishReason?` · 结束原因 ${r.structuredResponse.finishReason}`:''}</dd><dt>请求限制</dt><dd>{r.request?`输出上限 ${count(r.request.maxOutputTokens)} token；这是请求参数，不是实际消耗。`:'未记录'}</dd><dt>计费公式</dt><dd>{r.localCache?'本地缓存复用，没有发起模型请求，新增模型费 $0。':r.price&&r.usage?.valid?`(${r.usage.inputTokens} − ${r.usage.cachedInputTokens}) × $${r.price.inputPerMillion} / 1,000,000 + ${r.usage.cachedInputTokens} × $${r.price.cachedInputPerMillion} / 1,000,000 + ${r.usage.outputTokens} × $${r.price.outputPerMillion} / 1,000,000 = ${usd(r.estimatedCostUsd)}。思考已包含在输出中。`:'等待完整用量与匹配价格。'}</dd><dt>底层请求</dt><dd>{r.providerAttempts?.length?r.providerAttempts.map((a:any,i:number)=><span key={i}>#{a.attempt??'—'} {a.status||'状态未知'}{a.httpStatus?` · HTTP ${a.httpStatus}`:''}{a.errorType?` · ${a.errorType}`:''}{typeof a.latencySeconds==='number'?` · ${a.latencySeconds.toFixed(2)} s`:''}<br/></span>):'没有额外的底层重试记录。'}</dd></dl></td></tr>}</Fragment>;})}</tbody></table></div>
    {!filtered.length&&<p className="observation-empty">{records.length?'没有符合筛选条件的调用。':'尚无模型调用记录。'}</p>}
    <div className="observation-pagination"><span>{filtered.length} 条记录 · 每页 8 条</span><button disabled={pageNo<=1} onClick={()=>setPage(pageNo-1)}>上一页</button><span>{pageNo} / {pages}</span><button disabled={pageNo>=pages} onClick={()=>setPage(pageNo+1)}>下一页</button></div>
    <details className="observation-accounting"><summary>费用如何计算 / 全部价格与日志</summary><p>已知输入费用 {usd(inputCost)} + 已知输出费用 {usd(outputCost)}。输入包括图片、文字指令和前序结构数据；输出包括返回数据与供应商计费的思考 token。思考只展示数量。</p><p>金额是美元标价估算，不是供应商账单；不含税费、账户折扣、免费额度或缓存存储费。批量并行转换仍使用 standard 请求，不自动享受 Batch API 折扣。费用记录与图表质量结论分开。</p>{records.some(r=>r.usage?.thinkingBasis==='provider-total-minus-input-minus-visible-output')&&<p>兼容接口未单列思考数量时，按供应商返回的总 token 减去输入与可见输出计算，并保存计算依据。</p>}{priceError&&<p role="alert">{priceError}</p>}
      {prices&&<div className="billing-table-scroll"><table><thead><tr><th>模型 / 模式</th><th>UTC 生效区间</th><th>输入 / 百万</th><th>缓存 / 百万</th><th>输出 / 百万</th></tr></thead><tbody>{prices.rates.map((p:any)=><tr key={p.id}><td>{p.models[0]} / {p.mode}</td><td>{p.effectiveFrom.slice(0,10)} → {p.effectiveUntil?.slice(0,10)||'后续'}</td><td>${p.inputPerMillion}</td><td>${p.cachedInputPerMillion}</td><td>${p.outputPerMillion}</td></tr>)}</tbody></table></div>}
      <button disabled={!history.length} onClick={()=>download({schemaVersion:1,runs},'page-conversion-history.json')}>下载本页全部运行日志 ↓</button><p><small>运行 ID {current?.runId||'未记录'} · 程序版本 {current?.runInfo?.pipelineVersion||'历史日志未记录'}。重做会留下另一份记录，已有价格快照保持不变。</small></p>
    </details>
  </section>;
}
