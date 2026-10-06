// Test-only RFC 4180 serializer, used to round-trip generated sample data back through the importers.

function quoteField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<Record<string, string | number | null>>): string {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((col) => quoteField(row[col] === null || row[col] === undefined ? '' : String(row[col]))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
