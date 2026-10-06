// TESTER (Agent 3): hostile inputs the Coder's packs do not cover, plus independent boundary checks of the layered limits
// (criteria 28-33, 35). Every case asserts a specific outcome (catalogue code, exact text, stored value, or equality with
// the unchanged V1 importer), never only "does not throw". A console spy must stay silent (criterion 36).

import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeFile, type Decisions, type PipelineInput } from '../../../src/shared/ingest/pipeline';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { MESSAGE_CATALOGUE } from '../../../src/shared/ingest/messages';
import { LIMIT_CEILINGS, LIMIT_DEFAULTS, resolveLimits } from '../../../src/shared/ingest/limits';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { DEFAULT_INGEST_LIMITS, IngestLimitsError, loadIngestLimits } from '../../../src/server/ingestLimits';
import { createApiHandler } from '../../../src/server/api';
import { createAppServer } from '../../../src/server/app';
import { createDataStore } from '../../../src/server/store';
import { createSampleDataset } from '../../../src/shared/sample/generateSampleData';
import type { ImportKind } from '../../../src/shared/types';

const registry = createDefaultRegistry();
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const INV = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost\n';
const SHP = 'shipment_id,origin,destination,carrier,status,ship_date,estimated_delivery,actual_delivery,shipping_cost\n';
const run = (bytes: Uint8Array, fileName = 'x.csv', decisions: Decisions = {}, limitConfig: PipelineInput['limitConfig'] = {}) =>
  analyzeFile({ bytes, fileName, decisions, limitConfig }, { registry, clock: () => performance.now() });
type R = Awaited<ReturnType<typeof run>>;
const code = (r: R): string => (r.ok ? 'ok' : r.error.code);
const msg = (r: R): string => (r.ok ? '' : r.error.message);
const CODES = new Set(Object.keys(MESSAGE_CATALOGUE));

let calls: unknown[][] = [];
beforeEach(() => {
  calls = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void calls.push(a));
});
afterEach(() => {
  expect(calls).toEqual([]);
});

function v1(kind: ImportKind, text: string) {
  return kind === 'inventory' ? importInventoryCsv(text) : importShipmentsCsv(text);
}
/** Pipeline issues as V1 would list them (line, column, code, message). */
function issuesOf(r: R) {
  if (!r.ok) return null;
  return r.value.preview.validation.issues.map((i) => ({ line: i.source?.kind === 'line' ? i.source.line : null, column: i.issue.column, code: i.issue.code, message: i.message }));
}
function v1Issues(kind: ImportKind, text: string) {
  const res = v1(kind, text);
  return res.ok ? [] : res.errors.map((e) => ({ line: e.line, column: e.column, code: e.code, message: e.message }));
}

describe('BOMs, blank and empty-header files', () => {
  it('a file that is only a BOM (UTF-8, UTF-16LE, UTF-16BE) is "The file is empty."', async () => {
    for (const b of [Uint8Array.of(0xef, 0xbb, 0xbf), Uint8Array.of(0xff, 0xfe), Uint8Array.of(0xfe, 0xff)]) {
      const r = await run(b);
      expect(code(r), Array.from(b).join(',')).toBe('EMPTY_FILE');
      expect(msg(r)).toBe('The file is empty.');
    }
  });

  it('a BOM followed only by line breaks and spaces is refused with a catalogue error, never imported', async () => {
    const r = await run(enc('﻿\r\n\r\n   \n\n'));
    expect(r.ok).toBe(false);
    expect(CODES.has(code(r))).toBe(true);
  });

  it('a header row of 50 empty names with data below is never confirmable and fails with a catalogue code', async () => {
    const header = ','.repeat(49);
    const rows = Array.from({ length: 5 }, (_, i) => `A-${100 + i},Bolt,Hardware,WH-DFW,3,1,9.5${','.repeat(42)}`);
    const r = await run(enc(`${header}\n${rows.join('\n')}\n`), 'blank-headers.csv', { kind: 'inventory', options: new Map([['delimiter', 'comma']]) });
    if (r.ok) {
      expect(r.value.preview.canConfirm).toBe(false);
      expect(r.value.preview.blockers.length).toBeGreaterThan(0);
    } else expect(CODES.has(r.error.code)).toBe(true);
  });
});

describe('line endings and quoting', () => {
  it('mixed CRLF / LF / CR line endings: every row is read once, rows equal V1 on the LF version', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `A-${200 + i},Bolt ${i},Hardware,WH-DFW,${i},1,9.50`);
    const eols = ['\r\n', '\n', '\r'];
    const mixed = INV.trimEnd() + '\r\n' + rows.map((row, i) => row + (eols[i % 3] as string)).join('');
    const r = await run(enc(mixed), 'eol.csv', { kind: 'inventory' });
    expect(r.ok && r.value.preview.canConfirm).toBe(true);
    if (!r.ok) return;
    expect(r.value.canonical?.rowCount).toBe(12);
    const viaPipeline = importInventoryCsv(r.value.canonical?.csv ?? '');
    const viaV1 = importInventoryCsv(INV + rows.join('\n') + '\n');
    expect(viaPipeline.ok && viaV1.ok).toBe(true);
    if (viaPipeline.ok && viaV1.ok) expect(viaPipeline.rows).toEqual(viaV1.rows);
  });

  it('a quoted field containing the delimiter is one value; with embedded line breaks it is V1\'s control-character error on the line where the record starts', async () => {
    const ok = await run(enc(`${INV}A-1,"Box, large ""XL""",Hardware,WH-DFW,3,1,9.5\nA-2,Nut,Hardware,WH-DFW,3,1,9.5\n`), 'q.csv', { kind: 'inventory' });
    expect(ok.ok && ok.value.preview.canConfirm).toBe(true);
    if (ok.ok) expect(importInventoryCsv(ok.value.canonical?.csv ?? '').ok && (importInventoryCsv(ok.value.canonical?.csv ?? '') as { rows: Array<{ productName: string }> }).rows[0]?.productName).toBe('Box, large "XL"');
    const text = `${INV}A-1,Nut,Hardware,WH-DFW,3,1,9.5\nA-2,"Box, large\nsecond line, more",Hardware,WH-DFW,3,1,9.5\nA-3,Nut,Hardware,WH-DFW,3,1,9.5\n`;
    const r = await run(enc(text), 'q.csv', { kind: 'inventory' });
    expect(r.ok).toBe(true);
    expect(issuesOf(r)).toEqual(v1Issues('inventory', text));
    expect(issuesOf(r)?.[0]).toMatchObject({ line: 3, column: 'product_name' });
    if (r.ok) expect(r.value.preview.canConfirm).toBe(false);
  });

  it('a TAB-prefixed formula ("\\t=1+1", a CSV-injection variant) is never evaluated: stored exactly as V1 stores it (V1 trims the tab)', async () => {
    const text = `${INV}A-1,"\t=1+1",Hardware,WH-DFW,3,1,9.5\nA-2,Nut,Hardware,WH-DFW,3,1,9.5\n`;
    const first = await run(enc(text), 'tab.csv', { kind: 'inventory' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // FINDING (recorded): the exact canonical header product_name drops to CHECK because one of two values looks odd
    expect(first.value.preview.columns[1]?.state).toBe('check');
    const r = await run(enc(text), 'tab.csv', { kind: 'inventory', acknowledgedColumns: [1] });
    expect(r.ok && r.value.preview.canConfirm).toBe(true);
    if (!r.ok) return;
    const direct = importInventoryCsv(text);
    const via = importInventoryCsv(r.value.canonical?.csv ?? '');
    expect(direct.ok && via.ok).toBe(true);
    if (direct.ok && via.ok) {
      expect(via.rows).toEqual(direct.rows);
      expect(via.rows[0]?.productName).toBe('=1+1');
    }
  });
});

describe('gzip that lies about its size', () => {
  const good = enc(`${INV}A-1,Bolt,Hardware,WH-DFW,3,1,9.5\n`);

  it('a gzip trailer claiming 50 MB (ISIZE) is damaged, refused fast, nothing allocated for the claim', async () => {
    const z = Uint8Array.from(gzipSync(good));
    const claimed = 50 * 1024 * 1024;
    const forged = Uint8Array.from(z);
    new DataView(forged.buffer).setUint32(forged.length - 4, claimed, true);
    const t0 = performance.now();
    const r = await run(forged, 'x.csv.gz');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(code(r)).toBe('PACKED_DAMAGED');
    expect(code(await run(z, 'x.csv.gz'))).toBe('ok'); // control
  });

  it('a gzip header with FEXTRA claiming 65,535 bytes that are not there is damaged', async () => {
    const z = Uint8Array.from(gzipSync(good));
    const forged = Uint8Array.from([...z.slice(0, 3), (z[3] as number) | 0x04, ...z.slice(4, 10), 0xff, 0xff, ...z.slice(10, 40)]);
    expect(code(await run(forged, 'x.gz'))).toBe('PACKED_DAMAGED');
  });

  it('50 MB of REAL repeated CSV text compressed to a small file is refused as a bomb (ratio) or as too large, in bounded time', async () => {
    const row = 'A-1,Bolt,Hardware,WH-DFW,3,1,9.5\n';
    const big = Buffer.alloc(50 * 1024 * 1024, row);
    const z = Uint8Array.from(gzipSync(Buffer.concat([Buffer.from(INV), big])));
    expect(z.length).toBeLessThan(2 * 1024 * 1024);
    const t0 = performance.now();
    const r = await run(z, 'bomb.csv.gz');
    const ms = performance.now() - t0;
    expect(['LIMIT_RATIO', 'LIMIT_EXPANDED']).toContain(code(r));
    expect(ms).toBeLessThan(5000);
  }, 60000);
});

describe('long lines inside the size limit', () => {
  it('a 1.9 MB single line with commas (no line break): the separator must be chosen; once comma is chosen, the 50-column limit names line 1; fast', async () => {
    const line = Array.from({ length: 200_000 }, (_, i) => `v${i % 10}`).join(',');
    expect(line.length).toBeGreaterThan(500_000);
    const t0 = performance.now();
    const r = await run(enc(line.slice(0, 1_900_000)), 'one-line.csv');
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.ok && r.value.preview.blockers.map((b) => b.code)).toEqual(['choose-choice']);
    expect(r.ok && r.value.preview.canConfirm).toBe(false);
    const t1 = performance.now();
    const chosen = await run(enc(line.slice(0, 1_900_000)), 'one-line.csv', { options: new Map([['delimiter', 'comma']]) });
    expect(performance.now() - t1).toBeLessThan(2000);
    expect(code(chosen)).toBe('LIMIT_COLUMNS');
    expect(msg(chosen)).toBe('Line 1 has more than 50 columns. Remove columns you do not need and try again.');
  });

  it('a 1.9 MB single token with no delimiter and no line break: separator choice first, then "no data rows"; fast', async () => {
    const t0 = performance.now();
    const r = await run(enc('x'.repeat(1_900_000)), 'token.csv');
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.ok && r.value.preview.canConfirm).toBe(false);
    expect(r.ok && r.value.preview.blockers.map((b) => b.code)).toEqual(['choose-choice']);
    const chosen = await run(enc('x'.repeat(1_900_000)), 'token.csv', { options: new Map([['delimiter', 'comma']]) });
    expect(code(chosen)).toBe('NO_DATA_ROWS');
  });
});

describe('Unicode in headers: combining marks, RTL, zero-width, bidi overrides', () => {
  const rows = '\nVD-100001,Hà Nội,Đà Nẵng,Sao Mai,Đã giao,2026-03-02,2026-03-05,2026-03-04,10.00\nVD-100002,Huế,Hà Nội,Sao Mai,Đang vận chuyển,2026-03-03,2026-03-06,,12.00\n';
  const headersNfc = ['Mã vận đơn', 'Nơi gửi', 'Nơi nhận', 'Đơn vị vận chuyển', 'Trạng thái', 'Ngày gửi hàng', 'Ngày giao dự kiến', 'Ngày giao thực tế', 'Cước phí vận chuyển'];
  const decisions: Decisions = { kind: 'shipments', options: new Map([['delimiter', 'comma']]) };
  const mapping = (r: R) => (r.ok ? r.value.preview.columns.map((c) => `${c.state}:${c.field}`) : [code(r)]);

  it('decomposed (NFD) Vietnamese headers map exactly like the composed (NFC) ones', async () => {
    const nfc = await run(enc(headersNfc.join(',') + rows), 'nfc.csv', decisions);
    const nfd = await run(enc(headersNfc.map((h) => h.normalize('NFD')).join(',') + rows), 'nfd.csv', decisions);
    expect(mapping(nfd)).toEqual(mapping(nfc));
    expect(mapping(nfc).filter((m) => m.startsWith('matched') || m.startsWith('check')).length).toBeGreaterThanOrEqual(8);
  });

  it('RTL (Arabic) headers, a zero-width space and a bidi override never produce a MATCHED mapping on the wrong field and are kept as text', async () => {
    const hostile = ['رقم الشحنة', 'Ship​ment ID', '‮TNEMPIHS', 'carrier', 'status', 'ship_date', 'estimated_delivery', 'actual_delivery', 'shipping_cost'];
    const body = '\nA1-1,x,y,Alder,delivered,2026-03-02,2026-03-05,2026-03-04,1.00\n';
    const r = await run(enc(hostile.join(',') + body), 'rtl.csv', decisions);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cols = r.value.preview.columns;
    expect(cols.map((c) => c.header)).toEqual(hostile);
    for (const c of cols.slice(0, 3)) expect(c.state === 'matched' && c.field !== 'shipment_id' && c.field !== 'origin' && c.field !== 'destination').toBe(false);
    expect(r.value.preview.canConfirm).toBe(false); // origin/destination are missing: never invented
  });
});

describe('odd numbers and dates are V1\'s business: pipeline errors equal V1 errors exactly', () => {
  it('1e309, -0, NaN, Infinity, -Infinity, 0x10, 1_000 in numeric columns', async () => {
    const vals = ['1e309', '-0', 'NaN', 'Infinity', '-Infinity', '0x10', '1_000', '-0.00'];
    const text = INV + vals.map((v, i) => `A-${300 + i},Bolt,Hardware,WH-DFW,${v},1,${v}`).join('\n') + '\n';
    // FINDING (recorded): when EVERY value of an exact canonical header is invalid, the column drops to CHOOSE and the
    // preview says "Required field quantity has no column" although a column is literally named quantity (4.4 penalty
    // versus the 5.1 V1.5-compatibility rule). Safe (blocks), but confusing. V1 itself just lists the row errors.
    const first = await run(enc(text), 'nums.csv', { kind: 'inventory' });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.preview.columns.filter((c) => c.state === 'choose').map((c) => c.header)).toEqual(['quantity', 'unit_cost']);
      expect(first.value.preview.blockers.map((b) => b.code)).toContain('missing-required');
      expect(first.value.preview.canConfirm).toBe(false);
    }
    const r = await run(enc(text), 'nums.csv', { kind: 'inventory', assignments: new Map([[4, 'quantity'], [6, 'unit_cost']]) });
    expect(r.ok).toBe(true);
    expect(issuesOf(r)).toEqual(v1Issues('inventory', text));
    expect((issuesOf(r) ?? []).length).toBeGreaterThan(0);
    if (r.ok) expect(r.value.preview.canConfirm).toBe(false);
  });

  it('2026-02-30, 0000-01-01, 2028-02-29 (valid), 2026-2-3, 9999-12-31 in an ISO file', async () => {
    const dates = ['2026-02-30', '0000-01-01', '2028-02-29', '2026-2-3', '9999-12-31', '2026-03-02'];
    const text = SHP + dates.map((d, i) => `SHP-${400 + i},Dallas,Houston,Alder,delivered,${d},2026-03-05,2026-03-06,1.00`).join('\n') + '\n';
    const r = await run(enc(text), 'dates.csv', { kind: 'shipments' });
    expect(r.ok).toBe(true);
    expect(issuesOf(r)).toEqual(v1Issues('shipments', text));
    const lines = (issuesOf(r) ?? []).map((i) => i.line);
    expect(lines).toContain(2); // 2026-02-30
    expect(lines).toContain(3); // 0000-01-01
    expect(lines).not.toContain(4); // 2028-02-29 is a real date
  });

  it('30/02/2026 in a day-first file is never "repaired": V1 reports it quoting the user\'s own text', async () => {
    const text = 'shipment_id;origin;destination;carrier;status;ship_date;estimated_delivery;actual_delivery;shipping_cost\n' +
      ['15/03/2026', '30/02/2026', '28/02/2026'].map((d, i) => `SHP-${500 + i};Dallas;Houston;Alder;delivered;${d};20/03/2026;21/03/2026;1,50`).join('\n') + '\n';
    const r = await run(enc(text), 'dmy.csv', { kind: 'shipments', datePreset: 'dmy_slash', numberPreset: 'eu' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bad = r.value.preview.validation.issues;
    expect(bad).toHaveLength(1);
    expect(bad[0]?.issue.code).toBe('INVALID_DATE');
    expect(bad[0]?.message).toContain('30/02/2026');
    expect(bad[0]?.where).toBe('line 3');
    expect(r.value.preview.canConfirm).toBe(false);
  });
});

describe('layered limits: defaults, ceilings, boundaries (criteria 28-33)', () => {
  it('defaults equal today\'s values and the ceilings of the plan', () => {
    const d = resolveLimits();
    expect([d.payloadBytes, d.sourceBytes, d.maxImportRows, d.maxDataRows, d.maxColumns, d.maxImportColumns, d.maxErrorsReturned, d.requestTimeoutMs]).toEqual([2_097_152, 2_097_152, 20_000, 20_000, 50, 50, 500, 30_000]);
    expect([LIMIT_DEFAULTS.expansionRatio, LIMIT_DEFAULTS.maxScanRows, LIMIT_DEFAULTS.parseBudgetMs, LIMIT_DEFAULTS.validateBudgetMs]).toEqual([200, 200_000, 20_000, 10_000]);
    expect([LIMIT_CEILINGS.payloadBytes, LIMIT_CEILINGS.maxImportRows, LIMIT_CEILINGS.sourceBytesFamily, LIMIT_CEILINGS.sourceBytesGlobal]).toEqual([10 * 1024 * 1024, 100_000, 10 * 1024 * 1024, 100 * 1024 * 1024]);
    // above the ceiling is clamped, invalid is the default
    expect(resolveLimits({ maxImportRows: 1e9 }).maxImportRows).toBe(100_000);
    expect(resolveLimits({ payloadBytes: 1e12 }).payloadBytes).toBe(10 * 1024 * 1024);
    expect(resolveLimits({ maxImportRows: Number.NaN }).maxImportRows).toBe(20_000);
    expect(resolveLimits({ maxImportRows: -5 }).maxImportRows).toBe(20_000);
    expect(DEFAULT_INGEST_LIMITS).toMatchObject({ maxRows: 20_000, maxColumns: 50, maxErrorsReturned: 500, requestTimeoutMs: 30_000, defaultUploadBytes: 2_097_152 });
  });

  it('SCC_MAX_IMPORT_ROWS: 1..100,000 accepted, everything else a named error; warning only above 20,000', () => {
    expect(loadIngestLimits({}).maxRows).toBe(20_000);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '' }).maxRows).toBe(20_000);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: ' 1 ' }).maxRows).toBe(1);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '100000' }).maxRows).toBe(100_000);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '20000' }).warnings).toEqual([]);
    expect(loadIngestLimits({ SCC_MAX_IMPORT_ROWS: '20001' }).warnings).toHaveLength(1);
    for (const bad of ['0', '100001', '-1', '+5', '1.0', '1e3', '0x10', 'abc', '99999999999999999999', '20 000', '２００']) {
      expect(() => loadIngestLimits({ SCC_MAX_IMPORT_ROWS: bad }), bad).toThrow(IngestLimitsError);
      expect(() => loadIngestLimits({ SCC_MAX_IMPORT_ROWS: bad }), bad).toThrow(/^Invalid SCC_MAX_IMPORT_ROWS ".*": expected an integer between 1 and 100000\.$/);
    }
  });

  const invRows = (n: number, pad = 0): string => INV + Array.from({ length: n }, (_, i) => `A-${100000 + i},${'Bolt'.padEnd(4 + pad, 'x')},Hardware,WH-DFW,3,1,9.5`).join('\n') + '\n';

  it('20,000 rows: confirmable and accepted by the server; 20,001: refused client-side with the layer text, and by the server with the legacy text', async () => {
    const ok = await run(enc(invRows(20_000)), 'r.csv', { kind: 'inventory' });
    expect(ok.ok && ok.value.preview.canConfirm).toBe(true);
    const over = await run(enc(invRows(20_001)), 'r.csv', { kind: 'inventory' });
    expect(code(over)).toBe('LIMIT_ROWS');
    expect(msg(over)).toBe('The file has more than 20000 data rows. Split the file or filter the rows, or ask your administrator to raise SCC_MAX_IMPORT_ROWS.');

    const config = { port: 0, host: '127.0.0.1', seed: 42, todayOverride: '2026-06-15', maxUploadBytes: 2_097_152, mode: 'test' as const };
    const make = () => createSampleDataset(42, '2026-06-15', '2026-06-15T00:00:00.000Z');
    const store = createDataStore(make());
    const api = createApiHandler({ config, store, getToday: () => '2026-06-15', createSampleDataset: make, now: () => new Date('2026-06-15T12:00:00.000Z'), ingestLimits: loadIngestLimits({}) });
    const server = createAppServer({ config, api });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (body: string) => fetch(`${url}/api/import/inventory`, { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-SCC-Request': '1', 'X-SCC-Filename': 'r.csv' }, body });
    try {
      const a = await post(invRows(20_001));
      expect(a.status).toBe(422);
      const body = (await a.json()) as { errors: Array<{ code: string; message: string }> };
      expect(body.errors[0]).toMatchObject({ code: 'TOO_MANY_ROWS', message: 'The file has more than 20000 data rows.' });
      expect(store.getDataset().inventory.length).toBe(360); // untouched
      const b = await post(ok.ok ? (ok.value.canonical?.csv ?? '') : '');
      expect(b.status).toBe(200);
      expect(store.getDataset().inventory.length).toBe(20_000); // replace-all
      const snap = (await (await fetch(`${url}/api/snapshot`)).json()) as { limits: { maxRows: number; maxUploadBytes: number } };
      expect(snap.limits).toEqual({ maxUploadBytes: 2_097_152, maxRows: 20_000 });
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  }, 120000);

  it('2 MiB boundary of the source (layer a): exactly 2,097,152 bytes is read, one byte more gets the layer (a) text', async () => {
    const base = invRows(9_000, 160);
    expect(base.length).toBeLessThan(2_097_152);
    const exact = base + '\n'.repeat(2_097_152 - base.length);
    expect(enc(exact).length).toBe(2_097_152);
    const atLimit = await run(enc(exact), 'b.csv', { kind: 'inventory' });
    expect(code(atLimit)).toBe('ok');
    const over = await run(enc(exact + '\n'), 'b.csv', { kind: 'inventory' });
    expect(code(over)).toBe('LIMIT_SOURCE_BYTES');
    expect(msg(over)).toBe('File is 2.0 MB; the limit is 2.0 MB. Split the file, remove columns you do not need, or choose fewer rows.');
  }, 60000);

  it('source within (a) but canonical payload above (e): stopped before upload with the (e) text, not the (a) text', async () => {
    const head = 'shipment_id;origin;destination;carrier;status;ship_date;estimated_delivery;actual_delivery;shipping_cost\n';
    const city = 'C'.repeat(30);
    const row = (i: number): string => `S-${100000 + i};${city};${city};Alder;delivered;1/2/2026;3/2/2026;4/2/2026;1,5`;
    let text = head;
    let i = 0;
    while (text.length < 2_080_000) text += `${row(i++)}\n`;
    expect(i).toBeLessThanOrEqual(20_000);
    const bytes = enc(text);
    expect(bytes.length).toBeLessThanOrEqual(2_097_152);
    const r = await run(bytes, 'p.csv', { kind: 'shipments', datePreset: 'dmy_slash', numberPreset: 'eu' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value.canonical?.bytes ?? 0)).toBeGreaterThan(2_097_152);
    const blocker = r.value.preview.blockers.find((b) => b.code === 'too-large');
    expect(blocker?.message).toMatch(/^After conversion the data is 2\.\d MB but the server accepts at most 2\.0 MB per import\. Use fewer rows or columns, import one sheet at a time, or ask your administrator to raise SCC_MAX_UPLOAD_BYTES\.$/);
    expect(r.value.preview.canConfirm).toBe(false);
  }, 60000);
});
