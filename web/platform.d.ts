export {};
declare global {
  interface Window {
    CHART_PLATFORM_THEME: {id:string;version:string;name:string;sha256:string;colors:any;typography:any;chartColors:{ink:string;primary:string;secondary:string;tertiary:string;background:string}};
    chartPlatformExport: (elementId:string, format:string, revision:number)=>Promise<string>;
  }
}
