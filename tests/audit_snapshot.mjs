import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const url=process.env.CHART_TEST_URL||'http://127.0.0.1:8897';
const chart={version:1,title:'Snapshot regression',kind:'bar',unit:'MW',labels:['A','B'],series:[{name:'Capacity',values:[10,20]}],source:{kind:'image',importedAt:'2026-10-05',asOf:'2026-10-05',fileName:'test.png',sha256:'a'.repeat(64),locator:'Page 1'},warnings:[],annotations:[],reviewed:false,presentation:{valueAxis:true,grid:true,legend:true,trendArrow:false}};
const result={title:chart.title,subtitle:'',footnotes:[],warnings:[],mode:'charts',revision:1,aspect:1.7,source:chart.source,timing:{totalMs:1,modelMs:0,responseModel:'test'},elements:[{id:'figure',type:'figure',title:chart.title,bbox:[0,0,100,100],chart,figure:{kind:'chart',title:chart.title,chart,notes:[],totals:[]}}]};
const job={id:'a'.repeat(32),fileName:'test.png',status:'ready',theme:'om',pages:[{number:1,width:1000,height:600,status:'converting',startedAt:new Date().toISOString(),candidate:result}]};
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();let reads=0;
 if(process.env.CHART_TEST_APP_JS)await page.route('**/app.js*',route=>route.fulfill({path:process.env.CHART_TEST_APP_JS,contentType:'text/javascript'}));page.on('pageerror',e=>console.error(e.message));
 await page.route('**/api/job?*',route=>{reads++;return route.fulfill({json:job});});
 await page.route('**/api/jobs',route=>route.fulfill({json:{jobs:[],model:'test'}}));
 await page.goto(`${url}/?mode=upload&job=${job.id}&page=1&theme=om&audit=1`,{waitUntil:'domcontentloaded'});
 await page.locator('.chart-audit-surface svg').waitFor();
 await page.evaluate(()=>{window.auditSvg=document.querySelector('.chart-audit-surface svg');window.auditMutations=0;new MutationObserver(()=>window.auditMutations++).observe(window.auditSvg,{childList:true,subtree:true});});
 await page.waitForTimeout(2600);
 const state=await page.evaluate(()=>({same:window.auditSvg===document.querySelector('.chart-audit-surface svg'),mutations:window.auditMutations}));
 assert.equal(reads,1,'An audit must read one fixed candidate, not poll a changing job');
 assert.equal(state.same,true,'The audited SVG must remain attached through screenshot capture');
 assert.equal(state.mutations,0,'Progress timers must not redraw audited chart contents');
 console.log(JSON.stringify({auditSnapshotStable:true,jobReads:reads,...state}));
}finally{await browser.close();}
