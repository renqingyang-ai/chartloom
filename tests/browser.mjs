import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const url=process.env.CHART_TEST_URL||'http://127.0.0.1:8897';
const out='output/playwright/platform-split';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[];const checks=[];
try{
 const page=await browser.newPage({viewport:{width:1480,height:1040}});page.on('pageerror',e=>errors.push(e.message));
 for(const mode of ['upload','rules','components']){
   await page.goto(`${url}/?mode=${mode}`,{waitUntil:'networkidle'});
   const body=await page.locator('body').innerText();
   assert(body.includes('CHARTLOOM'));assert(body.length>300);
   checks.push({mode,rendered:true});
   await page.screenshot({path:`${out}/${mode}.png`,fullPage:true});
 }
 await page.goto(`${url}/?mode=upload&theme=neutral`,{waitUntil:'networkidle'});
 assert.equal(await page.evaluate(()=>window.CHART_PLATFORM_THEME.id),'neutral');
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 await page.screenshot({path:`${out}/mobile.png`,fullPage:true});
 assert.deepEqual(errors,[]);
 await writeFile(`${out}/checks.json`,JSON.stringify({checks,errors,themeSelection:true,mobileNoHorizontalOverflow:true},null,2));
 console.log(JSON.stringify({checks:checks.length,errors}));
}finally{await browser.close();}
