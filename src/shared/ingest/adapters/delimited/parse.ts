// Delimiter-aware record parser for the delimited-text adapter (the V1 `parseCsv` is protected and comma-only, so this
// is a new, separate implementation). Single pass over the text; quotes `"` with `""` escapes, CRLF/LF/CR line ends,
// physical line numbers, records whose fields are all blank are skipped (as today). Unlike V1, a stray quote inside an
// unquoted field is kept as a literal character ("5" pipe"), because real exports contain them; an unterminated quoted
// field is still an error. Never throws.

export interface ParsedRecords {
  rows: string[][];
  /** Physical 1-based line on which each record starts (parallel to `rows`). */
  lines: number[];
  /** Stopped at `maxRows`; more records exist. */
  truncated: boolean;
  cellCount: number;
}

export type ParseFailure =
  | { code: 'unterminated-quote'; line: number }
  | { code: 'too-many-columns'; line: number }
  | { code: 'too-many-cells'; line: number }
  | { code: 'bad-quote'; line: number };

export type ParseOutcome = { ok: true; value: ParsedRecords } | { ok: false; failure: ParseFailure };

export interface ParseOptions {
  /** Materialize at most this many records (blank records are not counted), then stop with `truncated`. */
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  /** Delimiter detection mode: a stray quote in an unquoted field, or a character after a closing quote, is a failure. */
  strictQuotes?: boolean;
}

function allBlank(fields: readonly string[]): boolean {
  for (const f of fields) if (f.trim() !== '') return false;
  return true;
}

/** Number of fields up to and including the last non-blank one (trailing empty columns are not counted). */
function effectiveLength(fields: readonly string[]): number {
  let n = fields.length;
  while (n > 0 && (fields[n - 1] as string).trim() === '') n--;
  return n;
}

export function parseDelimited(text: string, delimiter: string, opts: ParseOptions): ParseOutcome {
  const d = delimiter.charCodeAt(0);
  const rows: string[][] = [];
  const lines: number[] = [];
  let cellCount = 0;
  let truncated = false;

  let i = 0;
  const n = text.length;
  let line = 1;
  const strict = opts.strictQuotes === true;

  let fields: string[] = [];
  let field = '';
  let recordStartLine = line;
  let recordStarted = false;
  let inQuotes = false;
  let fieldHadQuotes = false;

  const finishRecord = (): ParseFailure | 'stop' | null => {
    fields.push(field);
    field = '';
    fieldHadQuotes = false;
    recordStarted = false;
    const current = fields;
    fields = [];
    if (allBlank(current)) return null;
    if (current.length > opts.maxColumns && effectiveLength(current) > opts.maxColumns) {
      return { code: 'too-many-columns', line: recordStartLine };
    }
    if (rows.length >= opts.maxRows) {
      truncated = true;
      return 'stop';
    }
    cellCount += current.length;
    if (cellCount > opts.maxCells) return { code: 'too-many-cells', line: recordStartLine };
    rows.push(current);
    lines.push(recordStartLine);
    return null;
  };

  while (i < n) {
    const c = text.charCodeAt(i);
    if (!recordStarted) {
      recordStartLine = line;
      recordStarted = true;
    }
    if (inQuotes) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
        continue;
      }
      if (c === 10 || c === 13) {
        field += '\n';
        line += 1;
        i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
        continue;
      }
      // run of ordinary characters up to the next quote or line break (sliced, not appended char by char)
      let j = i + 1;
      while (j < n) {
        const cj = text.charCodeAt(j);
        if (cj === 34 || cj === 10 || cj === 13) break;
        j++;
      }
      field += text.slice(i, j);
      i = j;
      continue;
    }
    if (strict && c === 34 && (field.length > 0 || fieldHadQuotes)) return { ok: false, failure: { code: 'bad-quote', line } };
    if (c === 34 && field.length === 0 && !fieldHadQuotes) {
      inQuotes = true;
      fieldHadQuotes = true;
      i += 1;
      continue;
    }
    if (c === d) {
      fields.push(field);
      field = '';
      fieldHadQuotes = false;
      i += 1;
      continue;
    }
    if (c === 10 || c === 13) {
      const result = finishRecord();
      if (result === 'stop') return { ok: true, value: { rows, lines, truncated, cellCount } };
      if (result !== null) return { ok: false, failure: result };
      line += 1;
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      continue;
    }
    if (strict && fieldHadQuotes) return { ok: false, failure: { code: 'bad-quote', line } };
    // run of ordinary characters up to the next separator or line break
    let j = i + 1;
    while (j < n) {
      const cj = text.charCodeAt(j);
      if (cj === d || cj === 10 || cj === 13 || (strict && cj === 34)) break;
      j++;
    }
    field += text.slice(i, j);
    i = j;
  }

  if (inQuotes) return { ok: false, failure: { code: 'unterminated-quote', line: recordStartLine } };
  if (recordStarted || field.length > 0 || fields.length > 0) {
    const result = finishRecord();
    if (result === 'stop') return { ok: true, value: { rows, lines, truncated, cellCount } };
    if (result !== null) return { ok: false, failure: result };
  }
  return { ok: true, value: { rows, lines, truncated, cellCount } };
}
