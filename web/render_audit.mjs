import { chromium } from 'playwright';
import { ganttDomChecks, componentDomChecks, pageFidelityChecks } from './svg_checks.mjs';
const [url,path]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+\//.test(url))throw new Error('Only loopback preview');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1480,height:1100},deviceScaleFactor:1});
 await page.goto(url,{waitUntil:'networkidle'});
 // App navigation is not part of a chart. A sticky toolbar used to cover the
 // top of tall SVG captures, creating false clipping reports and bad repairs.
 await page.addStyleTag({content:'nav.toolbar {position:static !important;}'});
 const surface=page.locator('.chart-audit-surface,.pipeline-page-wrap').first();
 await surface.waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(250);
 const checks=await page.evaluate(()=>({overflow:[...document.querySelectorAll('[data-overflow="true"]')].map(e=>e.getAttribute('data-copy')||e.closest('[data-element-id]')?.getAttribute('data-element-id')),figures:document.querySelectorAll('[data-testid="pipeline-figure"]').length,statisticalRasterImages:document.querySelectorAll('[data-kind="chart"] image, [data-kind="pie"] image, [data-kind="scatter"] image, [data-kind="curves"] image').length}));
 checks.gantt=await page.evaluate(ganttDomChecks);checks.components=await page.evaluate(componentDomChecks);
 checks.pieBindings=await page.evaluate(()=>[...document.querySelectorAll('svg[data-component="source-pie-v1"]')].map(svg=>({elementId:svg.closest('[data-element-id]')?.getAttribute('data-element-id'),bindings:[...svg.querySelectorAll('[data-pie-slice]')].map(slice=>{const index=slice.getAttribute('data-pie-slice'),legend=svg.querySelector(`[data-pie-legend="${index}"]`);return {category:slice.parentElement.getAttribute('data-category'),value:Number(slice.parentElement.getAttribute('data-value')),sliceFill:slice.getAttribute('fill'),legendFill:legend?.getAttribute('fill'),matched:!legend||legend.getAttribute('fill')===slice.getAttribute('fill')};})})));
 checks.pageIssues=await page.evaluate(pageFidelityChecks);
 await surface.screenshot({path});
 const charts=surface.locator('svg[data-testid="pipeline-figure"]');checks.renderedCharts=[];
 for(let i=0;i<await charts.count();i++){
  const chart=charts.nth(i),file=path.replace(/\.png$/,`-chart-${i+1}.png`);
  await chart.screenshot({path:file});checks.renderedCharts.push({index:i,file,kind:await chart.getAttribute('data-kind')});
 }
 console.log(JSON.stringify(checks));
}finally{await browser.close();}
