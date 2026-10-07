import {platformUrl} from '@/lib/chart-platform-url';
import { chartProblems, validateImportedChart, type ImportedChart } from '@/types/chart-import';

const decoder = new TextDecoder(); const encoder = new TextEncoder();
const PNG_KEY = 'cre-studio-chart';
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Lossless editable payload travels with the managed PNG asset, never as a verified trace. */
export function attachChartToPng(png: Uint8Array, chart: ImportedChart): Uint8Array {
  const payload = encoder.encode(`${PNG_KEY}\0\0\0\0\0${JSON.stringify(chart)}`);
  const chunk = new Uint8Array(payload.length + 12); const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length); chunk.set(encoder.encode('iTXt'), 4); chunk.set(payload, 8);
  view.setUint32(chunk.length - 4, crc32(chunk.slice(4, -4)));
  const end = png.length - 12;
  if (decoder.decode(png.slice(end + 4, end + 8)) !== 'IEND') throw new Error('Invalid PNG output.');
  const result = new Uint8Array(png.length + chunk.length);
  result.set(png.slice(0, end)); result.set(chunk, end); result.set(png.slice(end), end + chunk.length);
  return result;
}

export function readChartFromPng(png: Uint8Array): ImportedChart | null {
  if (!signature.every((value, i) => png[i] === value)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = view.getUint32(offset);
    if (offset + length + 12 > png.length) throw new Error('Damaged PNG file.');
    if (length < 2_000_000 && decoder.decode(png.slice(offset + 4, offset + 8)) === 'iTXt') {
      const payload = png.slice(offset + 8, offset + 8 + length);
      const text = decoder.decode(payload); const prefix = `${PNG_KEY}\0\0\0\0\0`;
      if (text.startsWith(prefix)) {
        if (crc32(png.slice(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) throw new Error('The editable chart data is damaged.');
        return validateImportedChart(JSON.parse(text.slice(prefix.length)));
      }
    }
    offset += length + 12;
  }
  return null;
}

let embeddedFonts: Promise<string> | undefined;
export function fontStyles(): Promise<string> {
  embeddedFonts ??= Promise.all([
    ['Kaisei Tokumin', 'KaiseiTokumin-Regular.ttf'],
    ['Source Serif 4', 'SourceSerif4[opsz,wght].ttf'],
    ['Source Sans 3', 'SourceSans3[wght].ttf'],
  ].map(async ([family, path]) => {
    const response = await fetch(platformUrl(`/fonts/asset-noir/${encodeURIComponent(path)}`));
    if (!response.ok) throw new Error(`The OM font ${family} could not be loaded.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${btoa(binary)}) format('truetype');font-weight:100 900}`;
  })).then(styles => styles.join('\n')).catch(error => { embeddedFonts = undefined; throw error; });
  return embeddedFonts;
}

export async function chartSvg(svg: SVGSVGElement, chart: ImportedChart, allowDraft=false): Promise<string> {
  const problems = chartProblems(chart);
  if (problems.length || (!chart.reviewed && !allowDraft)) throw new Error(problems[0] || 'Review the source and values first.');
  await document.fonts.ready;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('style');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = await fontStyles(); clone.prepend(style);
  const metadata = document.createElementNS('http://www.w3.org/2000/svg', 'metadata');
  metadata.textContent = JSON.stringify(chart); clone.prepend(metadata);
  return new XMLSerializer().serializeToString(clone);
}

export function chartImageFrame(width: number, height: number, aspectRatio?: number) {
  const ratio = aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : width / height;
  const frameWidth = Math.max(width, height * ratio); const frameHeight = Math.max(height, width / ratio);
  const scale = Math.min(2, 8192 / frameWidth, 8192 / frameHeight);
  return { width: Math.round(frameWidth * scale), height: Math.round(frameHeight * scale),
    x: (frameWidth - width) * scale / 2, y: (frameHeight - height) * scale / 2,
    chartWidth: width * scale, chartHeight: height * scale };
}

export async function chartPngFile(svg: SVGSVGElement, chart: ImportedChart, frameAspectRatio?: number): Promise<File> {
  const markup = await chartSvg(svg, chart);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Chart image export failed.')); image.src = url; });
    const width = Number(svg.getAttribute('width')); const height = Number(svg.getAttribute('height'));
    // Composer uses Fill for images. Match its frame with padding so no values or notes are cropped.
    const frame = chartImageFrame(width, height, frameAspectRatio);
    const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable in this browser.');
    const background = svg.querySelector('[data-chart-background]')?.getAttribute('fill');
    if (!background) throw new Error('The chart background could not be read.');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, frame.x, frame.y, frame.chartWidth, frame.chartHeight);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed.')), 'image/png'));
    const bytes = attachChartToPng(new Uint8Array(await blob.arrayBuffer()), chart);
    return new File([bytes.buffer as ArrayBuffer], `${safeChartName(chart.title)}.png`, { type: 'image/png' });
  } finally { URL.revokeObjectURL(url); }
}

export function safeChartName(title: string) { return title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'OM-chart'; }
export function downloadChartFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
