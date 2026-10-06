// Hand-written RFC 4180 CSV parser. Single pass, O(n) character loop; no regex over the whole text. Delimiter is
// ',', quote is '"', escaped quote is '""'. Line endings CRLF, LF or lone CR are all accepted. A leading UTF-8 BOM
// must already be stripped by the caller. Records whose fields are all empty after trim are skipped.

import type { ImportIssue } from '../types';

export interface CsvRecord {
  line: number; // 1-based physical line where the record starts (header is line 1)
  fields: string[];
}

export type CsvParseResult = { ok: true; records: CsvRecord[] } | { ok: false; error: ImportIssue };

function makeError(message: string): ImportIssue {
  return { line: null, column: null, code: 'MALFORMED_CSV', message };
}

function isAllEmpty(fields: readonly string[]): boolean {
  return fields.every((f) => f.trim() === '');
}

/** Parses raw CSV text into records (records[0] is the header row when present). */
export function parseCsv(rawText: string, opts: { maxRows: number; maxColumns: number }): CsvParseResult {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const records: CsvRecord[] = [];
  let dataRowCount = 0;

  let field = '';
  let fields: string[] = [];
  let recordStartLine = 1;
  let line = 1;
  let inQuotes = false;
  let fieldHadQuotes = false;
  let i = 0;
  const n = text.length;
  let recordStarted = false;

  const pushField = () => {
    fields.push(field);
    field = '';
    fieldHadQuotes = false;
  };

  const pushRecord = (): CsvParseResult | null => {
    pushField();
    if (fields.length > opts.maxColumns) {
      return { ok: false, error: { line: null, column: null, code: 'TOO_MANY_COLUMNS', message: `Line ${recordStartLine} has more than ${opts.maxColumns} columns.` } };
    }
    if (!isAllEmpty(fields)) {
      if (records.length > 0) {
        dataRowCount += 1;
        if (dataRowCount > opts.maxRows) {
          return { ok: false, error: { line: null, column: null, code: 'TOO_MANY_ROWS', message: `The file has more than ${opts.maxRows} data rows.` } };
        }
      }
      records.push({ line: recordStartLine, fields });
    }
    fields = [];
    recordStarted = false;
    return null;
  };

  while (i < n) {
    const ch = text[i];
    if (!recordStarted) {
      recordStartLine = line;
      recordStarted = true;
    }

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\n') {
        field += '\n';
        line += 1;
        i += 1;
        continue;
      }
      if (ch === '\r') {
        // Normalize CRLF/CR inside quoted fields to \n.
        field += '\n';
        line += 1;
        i += text[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      if (field.length > 0 && !fieldHadQuotes) {
        return { ok: false, error: makeError(`Unexpected quote character inside an unquoted field on line ${line}.`) };
      }
      if (fieldHadQuotes) {
        return { ok: false, error: makeError(`Unexpected character after a closing quote on line ${line}.`) };
      }
      fieldHadQuotes = true;
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      const result = pushRecord();
      if (result) return result;
      line += 1;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    if (fieldHadQuotes) {
      return { ok: false, error: makeError(`Unexpected character after a closing quote on line ${line}.`) };
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    return { ok: false, error: makeError(`Unterminated quoted field starting on line ${recordStartLine}.`) };
  }

  if (recordStarted || field.length > 0 || fields.length > 0) {
    const result = pushRecord();
    if (result) return result;
  }

  return { ok: true, records };
}
