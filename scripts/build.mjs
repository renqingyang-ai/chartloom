import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({absWorkingDir:root,entryPoints:['web/preview.tsx','web/component-probe.tsx'],outdir:'web',
 bundle:true,minify:true,jsx:'automatic',platform:'browser',target:'es2022',
 tsconfig:path.join(root,'tsconfig.json'),entryNames:'[name]',define:{'process.env.NODE_ENV':'"production"'}});
// Keep stable browser and integration URLs.
const fs=await import('node:fs/promises');await fs.rename(path.join(root,'web/preview.js'),path.join(root,'web/app.js'));
const {createHash}=await import('node:crypto');
const revision=createHash('sha256').update(await fs.readFile(path.join(root,'web/app.js'))).digest('hex').slice(0,16);
const index=path.join(root,'web/index.html');
await fs.writeFile(index,(await fs.readFile(index,'utf8')).replace(/src="bootstrap\.js(?:\?v=[a-f0-9]+)?"/,`src="bootstrap.js?v=${revision}"`));
