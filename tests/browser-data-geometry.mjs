import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.CHART_TEST_URL||'http://127.0.0.1:8897';
const out='output/playwright/data-create-20261005';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),checks=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1480,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/component-probe.html`,{waitUntil:'networkidle'});
 for(const kind of ['bar','grouped-bar','stacked-bar','line','area','combo','pie','donut','scatter'])for(const orientation of kind==='bar'?['vertical','horizontal']:['vertical']){
  const series=[{name:'A',values:[12.345,24.5,35.75]}];
  if(['grouped-bar','stacked-bar','line','area','combo','scatter'].includes(kind))series.push({name:'B',values:[-5.5,null,15.25]});
  const chart={title:`${kind} · ${orientation}`,kind:['pie','donut','bar'].includes(kind)?'bar':kind==='stacked-bar'?'stacked-bar':['line','area'].includes(kind)?'line':'grouped-bar',unit:'USD',labels:['First','Second','Third'],series,annotations:['Provided data; no inferred values.'],presentation:{valueAxis:true,grid:true,legend:true,trendArrow:false}};
  const figure={kind:kind==='donut'?'pie':kind,chart,dataDesign:{kind,orientation,showValues:true,secondaryUnit:'%',series:series.map((_,i)=>({geometry:kind==='combo'&&i===1?'line':'bar',axis:kind==='combo'&&i===1?'secondary':'primary'}))}};
  await page.evaluate(f=>window.componentProbe.render(f),figure);
  await page.waitForFunction(title=>document.querySelector('svg>title')?.textContent===title,chart.title);
  const marks=page.locator('[data-mark]');assert.equal(await marks.count(),kind==='scatter'?2:series.flatMap(s=>s.values).filter(v=>v!==null).length);
  const bad=await page.locator('svg').evaluate(svg=>[...svg.querySelectorAll('*')].some(el=>[...el.attributes].some(a=>/^(NaN|Infinity|-Infinity)$/.test(a.value)||a.value.includes('NaN'))));assert.equal(bad,false);
  if(['pie','donut'].includes(kind))assert.equal(await marks.locator('path').count(),3);
  if(kind==='bar')assert.equal(await marks.locator('rect').count(),3);
  if(kind==='combo'){assert.equal(await page.locator('[data-axis="secondary"]').count(),1);assert.equal(await page.locator('[data-line-series="1"]').count(),1);}
  assert((await page.locator('svg').textContent()).includes('Provided data; no inferred values.'));
  checks.push({kind,orientation,marks:await marks.count()});
 }
 assert.deepEqual(errors,[]);await writeFile(`${out}/geometry-checks.json`,JSON.stringify({checks,errors},null,2));
 console.log(JSON.stringify({geometryCases:checks.length,errors}));
}finally{await browser.close();}
