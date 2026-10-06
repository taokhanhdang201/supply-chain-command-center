import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../../src/shared/csv/parseCsv';

const LIMITS = { maxRows: 20000, maxColumns: 50 };

describe('parseCsv', () => {
  it('parses a simple file', () => {
    const result = parseCsv('a,b,c\n1,2,3\n', LIMITS);
    expect(result).toEqual({
      ok: true,
      records: [
        { line: 1, fields: ['a', 'b', 'c'] },
        { line: 2, fields: ['1', '2', '3'] }
      ]
    });
  });

  it('handles a quoted field containing a comma', () => {
    const result = parseCsv('a,b\n"1,2",3\n', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records[1]?.fields).toEqual(['1,2', '3']);
  });

  it('handles an escaped quote inside a quoted field', () => {
    const result = parseCsv('a\n"say ""hi"""\n', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records[1]?.fields).toEqual(['say "hi"']);
  });

  it('handles a multiline quoted field and reports the correct line for the next record', () => {
    const result = parseCsv('a,b\n"line1\nline2",x\nc,d\n', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records[1]).toEqual({ line: 2, fields: ['line1\nline2', 'x'] });
      expect(result.records[2]).toEqual({ line: 4, fields: ['c', 'd'] });
    }
  });

  it('accepts CRLF line endings', () => {
    const result = parseCsv('a,b\r\n1,2\r\n', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['1', '2'] }
    ]);
  });

  it('accepts lone CR line endings', () => {
    const result = parseCsv('a,b\r1,2\r', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['1', '2'] }
    ]);
  });

  it('strips a leading BOM', () => {
    const result = parseCsv('﻿a,b\n1,2\n', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records[0]).toEqual({ line: 1, fields: ['a', 'b'] });
  });

  it('tolerates a trailing newline', () => {
    const result = parseCsv('a,b\n1,2\n', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records).toHaveLength(2);
  });

  it('skips blank lines and all-empty lines', () => {
    const result = parseCsv('a,b\n\n1,2\n,\n3,4\n', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toEqual([
        { line: 1, fields: ['a', 'b'] },
        { line: 3, fields: ['1', '2'] },
        { line: 5, fields: ['3', '4'] }
      ]);
    }
  });

  it('reports an unterminated quoted field', () => {
    const result = parseCsv('a,b\n"unterminated,x\n', LIMITS);
    expect(result).toEqual({
      ok: false,
      error: { line: null, column: null, code: 'MALFORMED_CSV', message: 'Unterminated quoted field starting on line 2.' }
    });
  });

  it('reports a stray quote inside an unquoted field', () => {
    const result = parseCsv('a,b\nx"y,z\n', LIMITS);
    expect(result).toEqual({
      ok: false,
      error: { line: null, column: null, code: 'MALFORMED_CSV', message: 'Unexpected quote character inside an unquoted field on line 2.' }
    });
  });

  it('reports a character after a closing quote', () => {
    const result = parseCsv('a,b\n"x"y,z\n', LIMITS);
    expect(result).toEqual({
      ok: false,
      error: { line: null, column: null, code: 'MALFORMED_CSV', message: 'Unexpected character after a closing quote on line 2.' }
    });
  });

  it('reports TOO_MANY_ROWS', () => {
    const rows = Array.from({ length: 5 }, (_, i) => `${i}`).join('\n');
    const result = parseCsv(`a\n${rows}\n`, { maxRows: 3, maxColumns: 50 });
    expect(result).toEqual({
      ok: false,
      error: { line: null, column: null, code: 'TOO_MANY_ROWS', message: 'The file has more than 3 data rows.' }
    });
  });

  it('reports TOO_MANY_COLUMNS', () => {
    const result = parseCsv('a,b,c,d\n', { maxRows: 20000, maxColumns: 3 });
    expect(result).toEqual({
      ok: false,
      error: { line: null, column: null, code: 'TOO_MANY_COLUMNS', message: 'Line 1 has more than 3 columns.' }
    });
  });
});
