// Source-reference display, the record flattener, the canonical builder and the dry-run translation of V1 issues back to
// the user's own file (criterion 17): lines, the raw value as written, the format note, referenced lines in messages.

import { describe, expect, it } from 'vitest';
import { formatRowRef, formatSourceRef, columnLetters } from '../../../src/shared/ingest/preview/sourceRef';
import { flattenRecords } from '../../../src/shared/ingest/flatten/records';
import { inferTables } from '../../../src/shared/ingest/flatten/positioned';
import { restatementText, confirmReason } from '../../../src/shared/ingest/preview/model';
import { MAX_ERRORS_RETURNED } from '../../../src/shared/constants';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { inventoryRows } from '../../fixtures/ingest/corpus45';
import { makeFixture } from '../../fixtures/ingest/corpus45';
import { analyze, inputOf, must, settle } from '../../ingest-kit/pipelineHarness';
import { resolveLimits } from '../../../src/shared/ingest/limits';
import { dryRun } from '../../../src/shared/ingest/validate/dryRun';
import { buildCanonicalCsv } from '../../../src/shared/ingest/canonical/buildCsv';
import type { RawCell, RawTable, RecordNode, SourceRef } from '../../../src/shared/ingest/types';
import { applyStructure } from '../../../src/shared/ingest/structure/detectStructure';

describe('source reference formatter (one per kind)', () => {
  it('formats every SourceRef kind', () => {
    const cases: Array<[SourceRef, string]> = [
      [{ kind: 'line', line: 57 }, 'line 57'],
      [{ kind: 'line', line: 57, column: 3 }, 'line 57, column 3'],
      [{ kind: 'cell', sheet: 'Loads', row: 57, col: 4 }, "Sheet 'Loads', D57"],
      [{ kind: 'cell', sheet: 'Ton kho', row: 2, col: 27 }, "Sheet 'Ton kho', AA2"],
      [{ kind: 'path', path: '$.shipments[56].id' }, '$.shipments[56].id'],
      [{ kind: 'path', path: '$.shipments[56].id', index: 56 }, '$.shipments[56].id (record 57)'],
      [{ kind: 'page', page: 3 }, 'page 3'],
      [{ kind: 'page', page: 3, bbox: [10.4, 20, 30, 40] }, 'page 3, near (10, 20)'],
      [{ kind: 'segment', index: 12 }, 'segment 12'],
      [{ kind: 'segment', index: 12, element: 3 }, 'segment 12, element 3'],
      [{ kind: 'record', index: 0 }, 'record 1']
    ];
    for (const [ref, text] of cases) expect(formatSourceRef(ref), JSON.stringify(ref)).toBe(text);
    expect(formatRowRef({ kind: 'line', line: 57, column: 3 })).toBe('line 57');
    expect(formatRowRef({ kind: 'cell', sheet: 'Loads', row: 57, col: 4 })).toBe("Sheet 'Loads', row 57");
    expect(formatRowRef({ kind: 'page', page: 2 })).toBe('page 2');
  });
  it('column letters and hostile text', () => {
    expect([1, 26, 27, 52, 53, 702, 703].map(columnLetters)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
    const long = formatSourceRef({ kind: 'cell', sheet: 'x'.repeat(200), row: 1, col: 1 });
    expect(long.length).toBeLessThan(80);
    expect(formatSourceRef({ kind: 'cell', sheet: 'a\nb\u0000c', row: 1, col: 1 })).toBe("Sheet 'a b c', A1");
  });
});

describe('record flattener', () => {
  const node = (path: string, index: number, entries: RecordNode['entries']): RecordNode => ({ path, index, entries });
  const records = [
    node('$.r[0]', 0, [['id', 'SHP-1'], ['route', node('$.r[0].route', 0, [['from', node('$.r[0].route.from', 0, [['city', 'Dallas']])], ['km', '400']])], ['events', [node('$.r[0].events[0]', 0, [['code', 'A']]), node('$.r[0].events[1]', 1, [['code', 'B']])]]]),
    node('$.r[1]', 1, [['id', 'SHP-2'], ['extra', null], ['route', node('$.r[1].route', 0, [['from', node('$.r[1].route.from', 0, [['city', 'Miami']])]])]])
  ];
  const tables = flattenRecords('fake', 'r', records, { maxRows: 100, maxTables: 10 });
  it('makes path columns from nested objects, one row per record, and a child table per array of objects', () => {
    expect(tables.map((t) => t.name)).toEqual(['r', 'r.events']);
    const main = tables[0] as RawTable;
    expect(main.columns?.map((c) => c.header)).toEqual(['id', 'route.from.city', 'route.km', 'extra']);
    expect(main.columns?.[1]?.path).toEqual(['route', 'from', 'city']);
    expect(main.rows.map((r) => r.map((c) => c.v))).toEqual([['SHP-1', 'Dallas', '400', ''], ['SHP-2', 'Miami', '', '']]);
    expect(main.rows[1]?.[2]?.t).toBe('empty');
    const child = tables[1] as RawTable;
    expect(child.rows.map((r) => r[0]?.v)).toEqual(['A', 'B']);
  });
  it('source references are paths with the record index', () => {
    const main = tables[0] as RawTable;
    expect(main.origin(1, 1)).toEqual({ kind: 'path', path: '$.r[1].route.from.city', index: 1 });
    expect(main.origin(0)).toEqual({ kind: 'path', path: '$.r[0]', index: 0 });
    expect((tables[1] as RawTable).origin(1)).toEqual({ kind: 'path', path: '$.r[0].events[1]', index: 1 });
  });
  it('hostile keys are plain text and the row cap marks truncation', () => {
    const hostile = flattenRecords('fake', 'h', [node('$.h[0]', 0, [['__proto__', 'x'], ['constructor', 'y'], ['toString', 'z']])], { maxRows: 100, maxTables: 5 });
    expect(hostile[0]?.columns?.map((c) => c.header)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    const cut = flattenRecords('fake', 'c', Array.from({ length: 5 }, (_, i) => node(`$.c[${i}]`, i, [['a', String(i)]])), { maxRows: 3, maxTables: 5 });
    expect(cut[0]).toMatchObject({ rowCount: 3, truncated: true });
  });
  it('the table cap stops child tables', () => {
    const deep = [node('$.d[0]', 0, [['a', [node('$.d[0].a[0]', 0, [['b', [node('$.d[0].a[0].b[0]', 0, [['c', '1']])]]])]]])];
    expect(flattenRecords('fake', 'd', deep, { maxRows: 10, maxTables: 2 })).toHaveLength(2);
    expect(flattenRecords('fake', 'd', deep, { maxRows: 10, maxTables: 5 })).toHaveLength(3);
  });
});

describe('positioned-text inference hook', () => {
  it('has no inference of its own: without a registered step there is no table; a throwing step cannot break the pipeline', () => {
    const input = { adapterId: 'fake', name: 'Pages', pages: [[{ text: 'a', x: 0, y: 0, w: 1, h: 1 }]] };
    expect(inferTables(input, undefined)).toEqual([]);
    expect(inferTables(input, () => { throw new Error('bug'); })).toEqual([]);
  });
});

describe('dry-run translation of V1 issues (criterion 17)', () => {
  it('shows the source line, the raw value as written and the format the file was read with', async () => {
    const lines = [
      'Stock export',
      'from the ERP',
      'line three',
      'sku;product_name;category;warehouse;quantity;reorder_point;unit_cost;avg_daily_usage;lead_time_days',
      'ELC-9001;Scanner;Electronics;WH-DFW;120;40;89,50;1,50;14',
      'ELC-9003;Printer;Electronics;WH-ATL;60;20;12,345;2,25;7',
      'ELC-9005;Wrap;Packaging;WH-ORD;900;300;1.234,56;3,10;5',
      'ELC-9007;Gloves;Safety;WH-LAX;45;10;4,25;0,50;9',
      'ELC-9009;Tape;Packaging;WH-EWR;abc;15;3,75;1,75;11'
    ];
    const bytes = new TextEncoder().encode(lines.join('\n') + '\n');
    const a = must(await settle({ bytes, fileName: 'eu_errors.csv' }, {}));
    const v = a.preview.validation;
    expect(v.ran).toBe(true);
    expect(v.ok).toBe(false);
    const byColumn = (c: string) => v.issues.filter((i) => i.issue.column === c);
    const qty = byColumn('quantity')[0]!;
    expect(qty.where).toBe('line 9');
    expect(qty.source).toEqual({ kind: 'line', line: 9 });
    expect(qty.message).toContain('"abc"');
    expect(qty.message).toContain('Number format: 1.234,56 (decimal comma).');
    expect(qty.issue.line).toBeLessThan(9); // the V1 issue itself is untouched (canonical line numbers)
    const cost = byColumn('unit_cost')[0]!;
    expect(cost.message).toContain('"12,345"'); // quoted as written, not as the converted 12.345
    expect(cost.message).toContain('more than 2 decimal places');
    expect(cost.where).toBe('line 6');
    expect(a.preview.counts.rowsWithProblems).toBe(2);
    expect(a.preview.sample.problemRows.map((p) => p.source)).toEqual(['line 6', 'line 9']);
    expect(a.preview.sample.problemRows[0]?.raw).toContain('12,345');
    expect(a.preview.blockers.map((b) => b.code)).toEqual(['validation']);
    expect(a.preview.canConfirm).toBe(false);
  });

  it('translates "first seen on line N" to the user\'s position, even across multi-line cells', async () => {
    const header = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost';
    const text = `${header}\nELC-1,"Two\nline name",Cat,WH-DFW,1,1,1.00\nELC-1,Again,Cat,WH-DFW,1,1,1.00\n`;
    const a = must(await settle({ bytes: new TextEncoder().encode(text), fileName: 'dup.csv' }));
    const dup = a.preview.validation.issues.find((i) => i.issue.code === 'DUPLICATE_ID')!;
    expect(dup.where).toBe('line 4');
    expect(dup.message).toContain('first seen on line 2');
    // the multi-line product name would be a CONTROL_CHARS error in V1: it is reported on its own line
    expect(a.preview.validation.issues.some((i) => i.issue.code === 'CONTROL_CHARS' && i.where === 'line 2')).toBe(true);
  });

  it('truncates at 500 problems and keeps the real total (criterion 35)', async () => {
    const lines = ['sku,product_name,category,warehouse,quantity,reorder_point,unit_cost'];
    for (let i = 0; i < 620; i++) lines.push(`ELC-${1000 + i},Item,Cat,WH-DFW,1,-5,1.00`);
    const a = must(await settle({ bytes: new TextEncoder().encode(lines.join('\n') + '\n'), fileName: 'many.csv' }));
    expect(a.preview.validation.issues).toHaveLength(MAX_ERRORS_RETURNED);
    expect(a.preview.validation.totalErrors).toBe(620);
    expect(a.preview.counts.rowsWithProblems).toBe(MAX_ERRORS_RETURNED);
    expect(a.preview.sample.problemRows).toHaveLength(10);
    expect(a.preview.blockers[0]?.message).toContain('620 problems');
    expect(a.preview.validation.issues[0]?.where).toBe('line 2');
  });

  it('the same result as V1 on the canonical text: accepted rows equal the V1 import of the canonical CSV', async () => {
    const f = makeFixture('plain.csv', 'inventory', inventoryRows(8), { headers: Object.fromEntries(['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost', 'avg_daily_usage', 'lead_time_days'].map((c) => [c, c])), delimiter: ',', numberStyle: 'plain', dateStyle: 'iso', statusWords: 'en', encoding: 'utf8' });
    const a = must(await settle(inputOf(f)));
    const v1 = importInventoryCsv(a.canonical!.csv);
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.rows).toHaveLength(8);
    expect(a.preview.validation.warnings).toEqual(v1.ok ? v1.warnings : []);
  });
});

describe('dryRun called directly', () => {
  it('returns file-level issues with no source and a limits-aware import', () => {
    const limits = resolveLimits({ maxImportRows: 2 });
    const r = dryRun({ kind: 'inventory', csv: 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days\nA-1,x,y,WH-DFW,1,1,1,1,1\nA-2,x,y,WH-DFW,1,1,1,1,1\nA-3,x,y,WH-DFW,1,1,1,1,1\n', lineToSource: [], rowLines: [], canonicalRows: [], rawRows: [], numberPreset: 'plain', datePreset: 'iso', limits });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]).toMatchObject({ source: null, where: 'File' });
      expect(r.issues[0]?.message).toBe('The file has more than 2 data rows.');
    }
  });
});

describe('canonical builder details', () => {
  const cell = (v: string, t: RawCell['t'] = 'text'): RawCell => ({ v, t });
  const table = (rows: RawCell[][]): RawTable => ({
    ref: { adapterId: 't', name: 'T', index: 0 }, name: 'T', hidden: false, rows, rowCount: rows.length,
    colCount: Math.max(...rows.map((r) => r.length)), truncated: false, origin: (r) => ({ kind: 'line', line: r + 1 }), notes: []
  });
  const head = ['sku', 'product_name', 'category', 'warehouse', 'quantity', 'reorder_point', 'unit_cost'].map((h) => cell(h));

  it('quotes cells with commas, quotes and line breaks, and keeps typed numbers exact', () => {
    const t = table([head, [cell('A-1'), cell('Box, "large"'), cell('Cat'), cell('WH-DFW'), cell('5', 'number'), cell('2'), cell('1250.5', 'number')]]);
    const st = applyStructure(t, 0);
    const out = buildCanonicalCsv({ kind: 'inventory', table: t, structured: st, assignment: new Map(head.map((h, i) => [h.v, i])), numberPreset: 'plain', datePreset: 'iso', statusChoices: new Map(), warehouseChoices: new Map(), constants: new Map() });
    expect(out.csv.split('\n')[1]).toBe('A-1,"Box, ""large""",Cat,WH-DFW,5,2,1250.5,,');
    expect(out.lineToSource[2]).toEqual({ kind: 'line', line: 2 });
    expect(out.lineToSource[1]).toEqual({ kind: 'line', line: 1 });
  });

  it('skips rows whose mapped cells are all empty, without shifting references', () => {
    const t = table([head, [cell('A-1'), cell('x'), cell('c'), cell('WH-DFW'), cell('1'), cell('1'), cell('1')], [cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell('')], [cell('A-2'), cell('x'), cell('c'), cell('WH-DFW'), cell('1'), cell('1'), cell('1')]]);
    const out = buildCanonicalCsv({ kind: 'inventory', table: t, structured: applyStructure(t, 0), assignment: new Map(head.map((h, i) => [h.v, i])), numberPreset: 'plain', datePreset: 'iso', statusChoices: new Map(), warehouseChoices: new Map(), constants: new Map() });
    expect(out.rowCount).toBe(2);
    expect(out.stats.blankRows).toBe(1);
    expect(out.lineToSource[3]).toEqual({ kind: 'line', line: 4 });
  });

  it('counts stripped timestamps, USD markers and placeholders', () => {
    const sh = ['shipment_id', 'origin', 'destination', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost'].map((h) => cell(h));
    const t = table([sh, ['SHP-1', 'WH-DFW', 'HOU', 'C', 'delivered', '2026-03-02T10:00:00Z', '2026-03-05', 'n/a', '$12.50'].map((v) => cell(v))]);
    const out = buildCanonicalCsv({ kind: 'shipments', table: t, structured: applyStructure(t, 0), assignment: new Map(sh.map((h, i) => [h.v, i])), numberPreset: 'plain', datePreset: 'iso', statusChoices: new Map(), warehouseChoices: new Map(), constants: new Map() });
    expect(out.stats).toMatchObject({ timestampsStripped: 1, markersStripped: 1, placeholders: 1 });
    expect(out.csv.split('\n')[1]).toBe('SHP-1,WH-DFW,HOU,C,delivered,2026-03-02,2026-03-05,,12.50');
  });
});

describe('preview model helpers', () => {
  it('restatement wording and plural handling', () => {
    expect(restatementText('inventory', undefined, 1, 'x.csv')).toBe('This will REPLACE the entire Inventory dataset with 1 row from x.csv. If any row fails validation nothing is imported.');
    expect(restatementText('shipments', { label: 'Sample data (seed 42)', rowCount: 1200 }, 845, 'Alder Q3.xlsx > Loads')).toContain('(1,200 rows from Sample data (seed 42)) with 845 rows from Alder Q3.xlsx > Loads');
  });
  it('the Confirm-disabled reason names the first blocker and counts the rest', () => {
    expect(confirmReason([])).toBeNull();
    const b = (message: string) => ({ code: 'validation' as const, message, fatal: false });
    expect(confirmReason([b('One.')])).toBe('One.');
    expect(confirmReason([b('One.'), b('Two.')])).toBe('One. (and 1 more thing to resolve)');
    expect(confirmReason([b('One.'), b('Two.'), b('Three.')])).toBe('One. (and 2 more things to resolve)');
  });
  it('unrelated: a quick analyze of a header-only file reports "no data rows" as an error', async () => {
    const r = await analyze({ bytes: new TextEncoder().encode('sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\n'), fileName: 'h.csv' });
    expect(r).toMatchObject({ ok: false, error: { code: 'NO_DATA_ROWS', message: 'The file has a header but no data rows.' } });
  });
});
