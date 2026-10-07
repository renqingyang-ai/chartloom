import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const [url,elementId,format,file,revision]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+\//.test(url))throw new Error('Only local renderer URLs are supported.');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1480,height:1100}});
 await page.goto(url,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>typeof window.chartPlatformExport==='function');
 await page.evaluate(()=>document.fonts.ready);
 const data=await page.evaluate(async a=>window.chartPlatformExport(a.elementId,a.format,a.revision),{elementId,format,revision:Number(revision)});
 await writeFile(file,Buffer.from(data,'base64'));
}finally{await browser.close();}
