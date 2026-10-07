/** Keep the standalone editor usable behind an authenticated host prefix. */
export const embeddedEditor = () => new URLSearchParams(location.search).get('embedded') === '1';
export function platformUrl(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? new URL('./', location.href).pathname + path.slice(1) : path;
}
