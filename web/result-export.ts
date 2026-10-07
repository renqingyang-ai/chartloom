import {useEffect} from 'react';
import {figureExcel} from './figure-excel';
import {chartExcelFile} from '@/lib/chart-import/excel';
import {pipelineExcel,pipelineSvg,pipelinePng} from './pipeline-export';
import {fontStyles} from '@/lib/chart-import/export';
import type {Element} from './upload';

/** Browser and service exports share the exact saved revision and visible renderer. */
export function useResultExport(result:{revision:number;elements:Element[];source:any}|undefined){
  useEffect(()=>{
    if(!result)return;
    window.chartPlatformExport=async(elementId,format,revision)=>{
      if(result.revision!==revision)throw new Error('Revision changed; refresh before exporting.');
      const e=result.elements.find(e=>e.id===elementId);
      const host=[...document.querySelectorAll<HTMLElement>('[data-element-id]')].find(node=>node.dataset.elementId===elementId);
      const svg=host?.querySelector<SVGSVGElement>('svg[data-testid="pipeline-figure"],svg[data-testid="imported-chart-figure"]');
      if(!e||!svg)throw new Error('Chart has not rendered; no image fallback is exported.');
      let blob:Blob;
      if(format==='xlsx'){
        blob=e.chart?(e.figure?await pipelineExcel(e.chart,e.figure):await chartExcelFile(e.chart)):await figureExcel(e.figure||{},result.source);
      }else if(format==='png'&&e.chart){
        blob=await pipelinePng(svg,e.chart,e.figure||{},true);
      }else{
        let markup:string;
        if(e.chart)markup=await pipelineSvg(svg,e.chart,e.figure||{},true);
        else{
          const copy=svg.cloneNode(true) as SVGSVGElement;
          const meta=document.createElementNS('http://www.w3.org/2000/svg','metadata');
          meta.textContent=JSON.stringify({figure:e.figure,source:result.source,platformTheme:window.CHART_PLATFORM_THEME,reviewed:false});copy.prepend(meta);
          const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent=await fontStyles();copy.prepend(style);
          markup=new XMLSerializer().serializeToString(copy);
        }
        if(format==='svg')blob=new Blob([markup],{type:'image/svg+xml'});
        else{
          const url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));
          try{const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('PNG export failed.'));img.src=url;});const canvas=document.createElement('canvas');canvas.width=Number(svg.getAttribute('width'))*2;canvas.height=Number(svg.getAttribute('height'))*2;canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed.')),'image/png'));}finally{URL.revokeObjectURL(url);}
        }
      }
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);
    };
  },[result]);
}
