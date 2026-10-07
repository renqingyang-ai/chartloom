import baseline from '../src/chart_platform/resources/rules/bundles/chart-rules-1.0.0.json';
declare global {interface Window {__chartValidation:any}}
export function useValidationSnapshot(result?:any){
 window.__chartValidation=result?.validation?.visual?result.validation:{bundle:{version:baseline.version},visual:baseline.visual};
}
useValidationSnapshot();
