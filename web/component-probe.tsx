import './validation-client';
/** Local-only regression harness; synthetic inputs are never used by the uploader. */
import { createRoot } from 'react-dom/client';
import { RegisteredFigure } from './components/registry';
import { SourceLayoutFigure } from './components/source-layout';
import { DataChartFigure } from './components/data-chart';
const root=createRoot(document.getElementById('probe')!);
declare global {interface Window {componentProbe:{render:(figure:any)=>void}}}
window.componentProbe={
 render(figure){root.render(figure.dataDesign?<DataChartFigure key={JSON.stringify(figure)} figure={figure}/>:figure.sourceLayout?<SourceLayoutFigure key={JSON.stringify(figure)} figure={figure} standalone/>:<RegisteredFigure key={JSON.stringify(figure)} figure={figure}/>);}
};
