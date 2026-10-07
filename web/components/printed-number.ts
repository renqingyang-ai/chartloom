import baseline from '../../src/chart_platform/resources/rules/bundles/chart-rules-1.0.0.json';
type Format={id:string;groupSeparator:string;groupSize:number;decimalSeparator:string};
const cache=new Map<string,{format:Format;pattern:RegExp}[]>();
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function compiled(formats:Format[]){
 const key=JSON.stringify(formats);if(cache.has(key))return cache.get(key)!;
 const value=formats.map(format=>{
  const {groupSeparator:sep,groupSize:size,decimalSeparator:decimal}=format;
  const separator=sep===' '?'[ \u00a0\u2009\u202f]':escape(sep);
  const integer=sep?`(?:\\d{1,${size}}(?:${separator}\\d{${size}})+)`:'\\d+';
  const digits=sep?`${integer}(?:${escape(decimal)}\\d+)?`:`(?:${integer}(?:${escape(decimal)}\\d+)?|${escape(decimal)}\\d+)`;
  return {format,pattern:new RegExp('^(?<prefix>(?:[$€£¥￥₹]|[A-Za-z]{1,5}\\s+)?\\s*)(?<number>[+−-]?'+digits+')(?<suffix>\\s*(?:[%‰]|[A-Za-z\\u3400-\\u9fff°][A-Za-z\\u3400-\\u9fff° /²³·%]{0,23})?)$')};
 });cache.set(key,value);return value;
}
function parts(text:string,formats:Format[]){
 const trimmed=text.trim(),accounting=trimmed.startsWith('(')&&trimmed.endsWith(')');
 const candidates=compiled(formats).flatMap(({format,pattern})=>{
  const match=(accounting?trimmed.slice(1,-1).trim():trimmed).match(pattern);if(!match?.groups)return [];
  const {prefix,number,suffix}=match.groups;
  let numeric=number.normalize('NFKC').replace('−','-');
  if(format.groupSeparator)numeric=numeric.split(format.groupSeparator).join('');
  numeric=numeric.replace(format.decimalSeparator,'.');const value=Number(numeric);
  return Number.isFinite(value)?[{prefix,number,suffix,accounting,format,value:accounting?-Math.abs(value):value}]:[];
 });
 if(new Set(candidates.map(c=>c.value+'|'+c.prefix+'|'+c.suffix)).size>1)return null;
 return candidates[0]||null;
}
export function parsePrintedNumber(text:string,formats:Format[]=baseline.numberFormats):number|null {
 return parts(text.normalize('NFKC'),formats)?.value??null;
}
/** Use the layout's saved grammar, including after a global rule rollback. */
export function formatPrintedNumber(value:number,example:string,formats:Format[]=baseline.numberFormats):string {
 const p=parts(String(example||''),formats);if(!p)return String(value);
 const decimals=p.number.split(p.format.decimalSeparator)[1]?.length||0;
 const separator=p.format.groupSeparator===' '?p.number.match(/[ \u00a0\u2009\u202f]/)?.[0]:p.format.groupSeparator;
 let digits=Math.abs(value).toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:!!separator});
 if(separator)digits=digits.replaceAll(',',separator);
 if(p.format.decimalSeparator!=='.')digits=digits.replace('.',p.format.decimalSeparator);
 if(value<0&&!p.accounting)digits=(p.number.startsWith('-')?'-':'−')+digits;
 else if(value>=0&&p.number.startsWith('+'))digits='+'+digits;
 const result=p.prefix+digits+p.suffix;
 return value<0&&p.accounting?'('+result+')':result;
}

/** Templates have been source-checked; only the quantity changes on edit. */
export function formatBoundValue(value:number,text:string,template?:{prefix:string;quantity:string;suffix:string},formats:Format[]=baseline.numberFormats):string {
 if(!template)return formatPrintedNumber(value,text,formats);
 return template.prefix+formatPrintedNumber(value,template.quantity,formats)+template.suffix;
}
