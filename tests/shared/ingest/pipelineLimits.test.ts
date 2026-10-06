// Limits through the pipeline (criteria 28-33, 35): every layer produces its catalogue text with a next step; the source
// limit (a) and the canonical payload limit (e) are separate (criterion 31); hostile text-level inputs end in structured
// outcomes. Plus cancellation, progress and the time budgets.

import { describe, expect, it } from 'vitest';
import { analyze, inputOf, must, settle } from '../../ingest-kit/pipelineHarness';
import { fixtureByName } from '../../fixtures/ingest/corpus45';
import { gzip, utf16le, utf8 } from '../../ingest-kit/corpus';
import type { PipelineStage } from '../../../src/shared/ingest/pipeline';

const INV_HEAD = 'sku,product_name,category,warehouse,quantity,reorder_point,unit_cost';
const invRow = (i: number): string => `ELC-${100000 + i},Item ${i},Cat,WH-DFW,${i % 90},${i % 40},1.25`;
const csv = (rows: number, head = INV_HEAD, row = invRow): string => [head, ...Array.from({ length: rows }, (_, i) => row(i))].join('\n') + '\n';
const bytes = (text: string): Uint8Array => utf8(text);

describe('layer (a): source file limit', () => {
  it('a source above its family limit gets the legacy wording plus a next step', async () => {
    const r = await analyze({ bytes: new Uint8Array(2_097_153).fill(65), fileName: 'big.csv' });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_SOURCE_BYTES', limit: 'sourceBytes' } });
    expect(!r.ok && r.error.message).toMatch(/^File is 2\.0 MB; the limit is 2\.0 MB\. Split the file, remove columns you do not need, or choose fewer rows\.$/);
  });
  it('exactly at the limit is accepted by the size check', async () => {
    const text = csv(3);
    const padded = text + ' '.repeat(2_097_152 - text.length);
    const r = await analyze({ bytes: bytes(padded), fileName: 'edge.csv' });
    expect(r.ok || r.error.code !== 'LIMIT_SOURCE_BYTES').toBe(true);
  });
  it('the global ceiling is checked before anything else', async () => {
    const r = await analyze({ bytes: new Uint8Array(100 * 1024 * 1024 + 1), fileName: 'huge.csv' });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_SOURCE_GLOBAL' } });
  });
  it('gzip never bypasses the inner family limit', async () => {
    const big = utf8('a,b,c\n' + 'x'.repeat(2_200_000) + ',1,2\n');
    const r = await analyze({ bytes: gzip(big), fileName: 'big.csv.gz' });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && ['LIMIT_EXPANDED', 'LIMIT_RATIO', 'LIMIT_SOURCE_BYTES']).toContain(!r.ok ? r.error.code : '');
  });
});

describe('layer (c): rows and columns', () => {
  it('20,001 data rows are refused with the legacy wording and the administrator variable', async () => {
    const r = await analyze({ bytes: bytes(csv(20_001)), fileName: 'rows.csv' });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_ROWS', limit: 'dataRows' } });
    expect(!r.ok && r.error.message).toMatch(/^The file has more than 20000 data rows\./);
    expect(!r.ok && r.error.message).toContain('SCC_MAX_IMPORT_ROWS');
  });
  it('exactly 20,000 data rows pass the row check', async () => {
    const r = await analyze({ bytes: bytes(csv(20_000)), fileName: 'rows.csv' });
    expect(r.ok || r.error.code !== 'LIMIT_ROWS').toBe(true);
  });
  it('a configured row limit (SCC_MAX_IMPORT_ROWS as the client learns it) is honoured', async () => {
    const r = await analyze({ bytes: bytes(csv(101)), fileName: 'rows.csv', limitConfig: { maxImportRows: 100 } });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_ROWS' } });
    expect(!r.ok && r.error.message).toMatch(/^The file has more than 100 data rows\./);
  });
  it('51 columns are refused with the legacy wording; 50 are read', async () => {
    const wide = (n: number) => `${Array.from({ length: n }, (_, i) => `c${i}`).join(',')}\n${Array.from({ length: n }, (_, i) => i).join(',')}\n`;
    const r = await analyze({ bytes: bytes(wide(51)), fileName: 'wide.csv' });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_COLUMNS' } });
    expect(!r.ok && r.error.message).toBe('Line 1 has more than 50 columns. Remove columns you do not need and try again.');
    expect((await analyze({ bytes: bytes(wide(50)), fileName: 'wide.csv' })).ok).toBe(true);
  });
  it('a configured column cap lowers the limit', async () => {
    const r = await analyze({ bytes: bytes(csv(2)), fileName: 'c.csv', limitConfig: { maxColumns: 5 } });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_COLUMNS' } });
  });
});

describe('layer (e) is separate from layer (a) (criterion 31)', () => {
  const alias = 'item code,product,product category,wh,qty,rop,price';
  const aliasRow = (i: number): string => `E-${i},P,C,WH-DFW,1,1,1`;
  it('a source within its limit whose converted payload exceeds the payload limit is stopped before upload with the (e) text', async () => {
    const text = csv(40, alias, aliasRow);
    const size = text.length;
    const limitConfig = { payloadBytes: size + 10, sourceBytesByAdapter: { 'delimited-text': size + 10 } };
    // sanity: the source alone is fine
    const ok = must(await settle({ bytes: bytes(text), fileName: 'alias.csv', limitConfig: { sourceBytesByAdapter: { 'delimited-text': size + 10 } } }));
    expect(ok.preview.canConfirm).toBe(true);
    expect(ok.canonical!.bytes).toBeGreaterThan(size + 10);
    // the payload limit now sits just above the source size: the canonical CSV is larger than the source
    const r = must(await settle({ bytes: bytes(text), fileName: 'alias.csv', limitConfig }));
    const blocker = r.preview.blockers.find((b) => b.code === 'too-large');
    expect(blocker?.fatal).toBe(true);
    expect(blocker?.message).toMatch(/^After conversion the data is \d+\.\d MB but the server accepts at most \d+\.\d MB per import\. Use fewer rows or columns, import one sheet at a time, or ask your administrator to raise SCC_MAX_UPLOAD_BYTES\.$/);
    expect(r.preview.canConfirm).toBe(false);
    expect(r.preview.validation.ran).toBe(false); // never validated or uploaded
  });
  it('the converted row count is checked against the payload row limit', async () => {
    const r = must(await settle({ bytes: bytes(csv(30)), fileName: 'x.csv', limitConfig: { maxImportRows: 100 } }));
    expect(r.preview.canConfirm).toBe(true);
  });
  it('a source above (a) gets the (a) text, not the (e) text', async () => {
    const r = await analyze({ bytes: bytes(csv(30)), fileName: 'x.csv', limitConfig: { payloadBytes: 500, sourceBytesByAdapter: { 'delimited-text': 500 } } });
    expect(!r.ok && r.error.code).toBe('LIMIT_SOURCE_BYTES');
  });
});

describe('time budgets, cancellation and progress', () => {
  it('a parse budget overrun stops with the time-out text', async () => {
    let t = 0;
    const r = await analyze(inputOf(fixtureByName('alder_freight.csv')), { clock: () => (t += 30_000) });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_PARSE_TIME', limit: 'parseTime' } });
    expect(!r.ok && r.error.message).toContain('took too long');
  });
  it('a validation budget overrun stops with its own text', async () => {
    let t = 0;
    const r = await settle(inputOf(fixtureByName('alder_freight.csv'), { acknowledgedColumns: [4] }), {}, { clock: () => (t += 15_000) });
    expect(r).toMatchObject({ ok: false, error: { code: 'LIMIT_VALIDATE_TIME' } });
    const configured = await settle({ ...inputOf(fixtureByName('alder_freight.csv'), { acknowledgedColumns: [4] }), limitConfig: { validateBudgetMs: 1500 } }, {}, { clock: () => (t += 2_000) });
    expect(configured).toMatchObject({ ok: false, error: { code: 'LIMIT_VALIDATE_TIME' } });
  });
  it('no clock means no budget', async () => {
    expect((await analyze(inputOf(fixtureByName('alder_freight.csv')))).ok).toBe(true);
  });
  it('an aborted signal returns CANCELLED before any work, and an abort between stages is honoured', async () => {
    const pre = new AbortController();
    pre.abort();
    expect(await analyze(inputOf(fixtureByName('alder_freight.csv')), { signal: pre.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    for (const stage of ['probe', 'read', 'structure', 'map'] as PipelineStage[]) {
      const c = new AbortController();
      const r = await analyze(inputOf(fixtureByName('alder_freight.csv')), { signal: c.signal, progress: (s) => { if (s === stage) c.abort(); } });
      expect(r, stage).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    }
  });
  it('reports progress per stage in order, never going backwards', async () => {
    const seen: Array<[PipelineStage, number]> = [];
    await settle(inputOf(fixtureByName('alder_freight.csv')), {}, { progress: (s, f) => seen.push([s, f]) });
    const order = ['detect', 'probe', 'read', 'structure', 'map', 'normalize', 'validate'];
    const stages = [...new Set(seen.map(([s]) => s))];
    expect(stages.every((s, i) => i === 0 || order.indexOf(s) > order.indexOf(stages[i - 1] as string))).toBe(true);
    expect(seen.every(([, f]) => f >= 0 && f <= 1)).toBe(true);
  });
});

describe('hostile text-level inputs end in structured outcomes (criterion 35)', () => {
  const cases: Array<[string, Uint8Array]> = [
    ['empty', new Uint8Array(0)],
    ['NUL bytes', new Uint8Array(200)],
    ['lone surrogate in UTF-16', Uint8Array.of(0xff, 0xfe, 0x00, 0xd8, 0x41, 0x00)],
    ['odd UTF-16 length', Uint8Array.from([...utf16le('a,b,c\n1,2,3\n'), 0x41])],
    ['undefined Windows-1252 bytes', Uint8Array.from([...utf8('a,b,c\n1,'), 0x81, 0x8d, 0x8f, 0x90, 0x9d, ...utf8(',3\n')])],
    ['truncated gzip', gzip(utf8(csv(5))).subarray(0, 20)],
    ['gzip bomb', gzip(new Uint8Array(3 * 1024 * 1024))],
    ['2 MB single token', utf8('a,b,c\n' + 'x'.repeat(2_000_000) + ',1,2\n')],
    ['unterminated quote', utf8('a,b,c\n1,"2,3\n')]
  ];
  for (const [name, input] of cases) {
    it(`${name}: no throw, and either a catalogue error or a preview with blockers`, async () => {
      const t0 = performance.now();
      const r = await settle({ bytes: input, fileName: 'x.csv' });
      // generous: settle may analyze several times, and the full suite runs files in parallel on a slow machine
      expect(performance.now() - t0).toBeLessThan(15_000);
      if (r.ok) expect(Array.isArray(r.value.preview.blockers)).toBe(true);
      else {
        expect(r.error.message.length).toBeGreaterThan(5);
        expect(typeof r.error.code).toBe('string');
      }
    });
  }
  it('prototype-like headers, formula and HTML cells are plain text in the preview and never executed', async () => {
    const text = `${INV_HEAD}\n=cmd|'/C calc'!A0,<img src=x onerror=alert(1)>,@SUM(1),WH-DFW,1,1,1.25\n`;
    const r = must(await settle({ bytes: bytes(text), fileName: 'x.csv' }));
    const col = (name: string) => r.preview.sample.columns.indexOf(name);
    expect(r.preview.sample.rows[0]?.raw[col('product_name')]).toBe('<img src=x onerror=alert(1)>');
    expect(r.preview.columns.map((c) => c.example)).toContain("=cmd|'/C calc'!A0");
    const proto = must(await settle({ bytes: bytes('__proto__,constructor,toString\nx1,y2,z3\n'), fileName: 'p.csv' }));
    expect(proto.preview.columns.map((c) => c.header)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });
  it('nothing file-derived is logged during a whole analysis', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = methods.map((m) => console[m]);
    const calls: unknown[][] = [];
    for (const m of methods) console[m] = (...args: unknown[]) => void calls.push(args);
    try {
      await settle({ bytes: bytes(`${INV_HEAD}\nsecret-id,secret-name,x,WH-DFW,1,1,1\n`), fileName: 'secret-file.csv' });
      await settle({ bytes: new Uint8Array(30), fileName: 'secret-file.bin' });
    } finally {
      methods.forEach((m, i) => (console[m] = originals[i] as never));
    }
    expect(calls).toEqual([]);
  });
});
