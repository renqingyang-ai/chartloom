/** Data-only workbook for semantic figures; preserves every field and source. */
export async function figureExcel(figure: Record<string, unknown>, source: unknown) {
  const X = await import('xlsx');
  const book = X.utils.book_new();
  const cell = (value: unknown): string | number | boolean => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
  const overview = Object.entries(figure).filter(([, value]) => !Array.isArray(value)).map(([key, value]) => [key, cell(value)]);
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['Field', 'Value'], ...overview]), 'Figure');
  for (const [key, value] of Object.entries(figure)) {
    if (!Array.isArray(value) || !value.length) continue;
    const records: Record<string, unknown>[] = value.map(item => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : { value: item });
    const columns = [...new Set(records.flatMap(row => Object.keys(row)))];
    const name = `${book.SheetNames.length}-${key}`.replace(/[\\/?*\[\]:]/g, '_').slice(0, 31);
    X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([columns, ...records.map(row => columns.map(key => cell(row[key])))]), name);
  }
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['Source field', 'Value'], ...Object.entries(source && typeof source === 'object' ? source : {}).map(([key, value]) => [key, cell(value)])]), 'Source');
  return new Blob([X.write(book, { type: 'array', bookType: 'xlsx', compression: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
