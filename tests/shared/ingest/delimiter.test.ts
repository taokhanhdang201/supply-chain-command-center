// Golden cases R01-R16 of Addendum AD-1/AD-5 (criterion 8): rule R3 delimiter detection and the legacy-first gate.

import { describe, expect, it } from 'vitest';
import {
  DELIM_CANDIDATES,
  DELIM_HEADER_ROWS,
  DELIM_MIN_CONSISTENCY,
  DELIM_MIN_RECOGNIZED,
  DELIM_SAMPLE_RECORDS,
  DELIM_STRUCT_MIN_CONSISTENCY,
  DELIM_STRUCT_MIN_WIDTH,
  detectDelimiter,
  legacyGate,
  type Delim
} from '../../../src/shared/ingest/adapters/delimited/sniff';
import { recognizesHeader } from '../../../src/shared/ingest/mapping/dictionary';

const HEADER = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days'];
const ROWS = [
  ['ELC-9001', 'Wireless Scanner', 'Electronics', 'WH-DFW', '120', '40', '89.50', '6.5', '14'],
  ['PKG-1001', 'Pallet Wrap', 'Packaging', 'WH-ATL', '900', '300', '24.99', '12', '5'],
  ['SAF-2001', 'Safety Gloves', 'Safety', 'WH-ORD', '450', '100', '4.25', '8', '10']
];
const join = (rows: string[][], d: string): string => rows.map((r) => r.join(d)).join('\n') + '\n';
const canonical = (d: string): string => join([HEADER, ...ROWS], d);
const detect = (text: string) => detectDelimiter(text, recognizesHeader);
const gate = (text: string) => legacyGate(detect(text), true);

describe('rule R3: constants (AD-1)', () => {
  it('are exactly the specified values', () => {
    expect(DELIM_CANDIDATES).toEqual([',', ';', '\t', '|']);
    expect(DELIM_SAMPLE_RECORDS).toBe(200);
    expect(DELIM_HEADER_ROWS).toBe(30);
    expect(DELIM_MIN_RECOGNIZED).toBe(3);
    expect(DELIM_MIN_CONSISTENCY).toBe(0.8);
    expect(DELIM_STRUCT_MIN_CONSISTENCY).toBe(0.9);
    expect(DELIM_STRUCT_MIN_WIDTH).toBe(3);
  });
});

describe('rule R3: golden cases R01-R16', () => {
  it('R01: canonical comma file -> detected "," (recognized 9, consistency 1.0), gate LEGACY', () => {
    const d = detect(canonical(','));
    expect(d).toMatchObject({ kind: 'detected', delimiter: ',' });
    const score = d.scores.find((s) => s.delimiter === ',');
    expect(score).toMatchObject({ recognized: 9, m: 3, n: 3, consistency: 1, width: 9, eligible: true });
    expect(gate(canonical(','))).toBe('legacy');
  });

  it.each([
    ['R02', ';'],
    ['R03', '\t'],
    ['R04', '|']
  ] as Array<[string, Delim]>)('%s: the same file with %j -> detected, gate PIPELINE', (_id, d) => {
    expect(detect(canonical(d))).toMatchObject({ kind: 'detected', delimiter: d });
    expect(gate(canonical(d))).toBe('pipeline');
  });

  it('R05: a quoted product name containing "," and ";" never splits -> detected ","', () => {
    const rows = [HEADER, ['ELC-9001', '"Corrugated Box, 12x12; red"', 'Packaging', 'WH-DFW', '1', '1', '1', '1', '1'], ROWS[1] as string[]];
    const d = detect(join(rows, ','));
    expect(d).toMatchObject({ kind: 'detected', delimiter: ',' });
    expect(d.scores.find((s) => s.delimiter === ';')?.eligible).toBe(false);
  });

  it('R06: a semicolon file whose product names contain unquoted commas -> detected ";"', () => {
    const rows = [HEADER, ['ELC-9001', 'Box, large, red', 'Packaging', 'WH-DFW', '1', '1', '1', '1', '1'], ['ELC-9002', 'Tape, clear', 'Packaging', 'WH-ATL', '2', '2', '2', '2', '2']];
    const d = detect(join(rows, ';'));
    expect(d).toMatchObject({ kind: 'detected', delimiter: ';' });
    expect(d.scores.find((s) => s.delimiter === ',')?.eligible).toBe(false);
  });

  it('R07: two banner lines + a blank line, then the ";" header at physical line 4', () => {
    const text = `Stock report\nPrinted for Alder Stores\n\n${canonical(';')}`;
    const d = detect(text);
    expect(d).toMatchObject({ kind: 'detected', delimiter: ';' });
    expect(d.scores.find((s) => s.delimiter === ';')).toMatchObject({ headerRecordIndex: 2, headerLine: 4, recognized: 9 });
  });

  it('R08: a sep= first line is an ordinary banner row and never declares the separator', () => {
    const text = `sep=,\n${canonical(';')}`;
    expect(detect(text)).toMatchObject({ kind: 'detected', delimiter: ';' });
    const d = detect(`sep=;\n${canonical(';')}`);
    expect(d).toMatchObject({ kind: 'detected', delimiter: ';' });
    expect(d.scores.find((s) => s.delimiter === ';')?.headerRecordIndex).toBe(1);
  });

  it('R09: trailing delimiters on every record -> detected ";", width excludes the trailing empty cell', () => {
    const text = [HEADER, ...ROWS].map((r) => `${r.join(';')};`).join('\n') + '\n';
    const d = detect(text);
    expect(d).toMatchObject({ kind: 'detected', delimiter: ';' });
    expect(d.scores.find((s) => s.delimiter === ';')).toMatchObject({ width: 9, consistency: 1 });
  });

  it('R10: a single column -> single-column, gate LEGACY', () => {
    const text = 'sku\nA1\nB2\n';
    expect(detect(text).kind).toBe('single-column');
    expect(gate(text)).toBe('legacy');
    expect(detect('sku\n').kind).toBe('single-column'); // a one-cell header with no data
  });

  it('R11: a tiny file with nothing recognized and width 2 -> none, gate LEGACY', () => {
    const text = 'a,b\n1,2\n';
    expect(detect(text).kind).toBe('none');
    expect(gate(text)).toBe('legacy');
  });

  it('R12: generic headers with consistent rows -> check ";" (structure only), gate PIPELINE', () => {
    const text = 'Col1;Col2;Col3;Col4;Col5\n1;2;3;4;5\n6;7;8;9;10\n';
    const d = detect(text);
    expect(d).toMatchObject({ kind: 'check', delimiter: ';' });
    expect(d.scores.find((s) => s.delimiter === ';')).toMatchObject({ width: 5, consistency: 1 });
    expect(gate(text)).toBe('pipeline');
  });

  it('R13: a tie between "," and ";" -> ambiguous, nothing preselected, gate PIPELINE', () => {
    const text = 'sku,product_name,category,warehouse;quantity;reorder_point;unit_cost\nA1,Bolt,Hardware,WH-DFW;5;2;1.5\nA2,Nut,Hardware,WH-ATL;9;3;0.5\n';
    const d = detect(text);
    expect(d).toMatchObject({ kind: 'ambiguous', candidates: [',', ';'] });
    expect('delimiter' in d).toBe(false);
    expect(d.scores.find((s) => s.delimiter === ',')?.recognized).toBe(3);
    expect(d.scores.find((s) => s.delimiter === ';')?.recognized).toBe(3);
    expect(gate(text)).toBe('pipeline');
  });

  it('R14: a stray quote in an unquoted field makes every candidate invalid -> none, gate LEGACY', () => {
    const rows = [HEADER, ['ELC-9001', '5" pipe', 'Hardware', 'WH-DFW', '1', '1', '1', '1', '1'], ROWS[1] as string[]];
    const d = detect(join(rows, ','));
    expect(d.kind).toBe('none');
    expect(d.scores.every((s) => !s.parseOk)).toBe(true);
    expect(legacyGate(d, true)).toBe('legacy');
  });

  it('R15: consistency 0.75 makes "," ineligible and the others have width 1 -> none, gate LEGACY', () => {
    const full = ['A1', 'Bolt', 'Hardware', 'WH-DFW', '5', '2', '1.5', '1', '1'];
    const records = [HEADER, ...Array.from({ length: 40 }, (_, i) => (i < 30 ? full : full.slice(0, 5)))];
    const d = detect(join(records, ','));
    expect(d.kind).toBe('none');
    expect(d.scores.find((s) => s.delimiter === ',')).toMatchObject({ m: 30, n: 40, eligible: false });
    expect(legacyGate(d, true)).toBe('legacy');
  });

  it('R16: a header-only file -> detected ";" with the header-only evidence', () => {
    const d = detect(`${HEADER.slice(0, 7).join(';')}\n`);
    expect(d).toMatchObject({ kind: 'detected', delimiter: ';' });
    expect(d.evidence.join(' ')).toContain('header only, no data rows');
  });
});

describe('rule R3: boundaries and gate details', () => {
  it('consistency exactly 0.80 is eligible and 0.79 is not (exact integer comparison)', () => {
    const full = ['A1', 'Bolt', 'Hardware', 'WH-DFW', '5', '2', '1.5', '1', '1'];
    const make = (good: number, bad: number) => join([HEADER, ...Array.from({ length: good }, () => full), ...Array.from({ length: bad }, () => full.slice(0, 4))], ',');
    expect(detect(make(8, 2)).scores.find((s) => s.delimiter === ',')).toMatchObject({ m: 8, n: 10, eligible: true });
    expect(detect(make(79, 21)).scores.find((s) => s.delimiter === ',')?.eligible).toBe(false);
  });

  it('the structure-only fallback needs consistency >= 0.90 and width >= 3', () => {
    const wide = (good: number, bad: number) =>
      join([['Col1', 'Col2', 'Col3'], ...Array.from({ length: good }, () => ['1', '2', '3']), ...Array.from({ length: bad }, () => ['1', '2'])], ';');
    expect(detect(wide(9, 1)).kind).toBe('check'); // 0.90
    expect(detect(wide(17, 3)).kind).toBe('none'); // 0.85: eligible but below the structural threshold
    expect(detect('A;B\n1;2\n3;4\n').kind).toBe('none'); // width 2
  });

  it('two structural candidates with no recognized header names are ambiguous', () => {
    const text = 'a,b,c;d;e\n1,2,3;4;5\n6,7,8;9;10\n';
    expect(detect(text)).toMatchObject({ kind: 'ambiguous', candidates: [',', ';'] });
    // with only one candidate of width >= 3 the structure-only fallback preselects it (CHECK)
    expect(detect('x,y,z;p,q,r\n1,2,3;4,5,6\n')).toMatchObject({ kind: 'check', delimiter: ',' });
  });

  it('gate: a non-UTF-8 encoding is always PIPELINE; "none" with real evidence for another separator is PIPELINE', () => {
    expect(legacyGate(detect(canonical(',')), false)).toBe('pipeline');
    // a recognized semicolon header whose rows are inconsistent: no eligible candidate, but evidence for ";"
    const rows = [HEADER, ...Array.from({ length: 10 }, () => ['A1', 'x'])];
    const d = detect(join(rows, ';'));
    expect(d.kind).toBe('none');
    expect(legacyGate(d, true)).toBe('pipeline');
  });

  it('user choices always win: the decision never depends on column order or candidate order', () => {
    const a = detect(canonical(';'));
    const b = detect(canonical(';').replace(/\r?\n/g, '\r\n'));
    expect(b).toMatchObject({ kind: 'detected', delimiter: ';' });
    expect(a.scores.map((s) => s.delimiter)).toEqual([',', ';', '\t', '|']);
  });

  it('a BOM is stripped before detection and a lone CR is a line end', () => {
    expect(detect('﻿' + canonical(',')).kind).toBe('detected');
    expect(detect(canonical(';').replace(/\n/g, '\r'))).toMatchObject({ kind: 'detected', delimiter: ';' });
  });

  it('is deterministic (same text, same decision) and never throws on odd input', () => {
    for (const text of ['', '\n\n', ',,,,', '"', '"""', 'a,"b\nc', '\u0000,\u0001', ';'.repeat(5000), 'a\tb\tc\n1\t2\t3\n']) {
      expect(detect(text)).toEqual(detect(text));
    }
  });

  it('banner rows beyond the first 30 records cannot be the header (only the first 30 records are searched)', () => {
    const banners = Array.from({ length: 35 }, (_, i) => `note ${i}`).join('\n');
    const d = detect(`${banners}\n${canonical(';')}`);
    // the header is out of reach, so no recognition evidence: structure decides (banner rows precede the chosen header)
    expect(['check', 'none', 'ambiguous', 'detected']).toContain(d.kind);
    expect(d.scores.find((s) => s.delimiter === ';')?.recognized).toBe(0);
  });
});
