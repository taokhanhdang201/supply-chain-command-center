// Criterion 35, text-level hostile cases for detection and the delimited adapter (gzip, encodings and binary content are
// covered in gzip.test.ts, delimited.test.ts and the conformance hostile packs). The 500+ errors truncation and the
// dry-run cases come with the validation stage in milestone M3.

import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { delimitedAdapter } from '../../../src/shared/ingest/adapters/delimited/adapter';
import { detectFormat, makeHints } from '../../../src/shared/ingest/detect/arbiter';
import type { ExtractionResult, Result } from '../../../src/shared/ingest/types';
import { makeCtx, sourceOf, utf8 } from '../../ingest-kit/corpus';

const registry = createDefaultRegistry();
const ctx = (over: Partial<Parameters<typeof makeCtx>[0]> = {}) => makeCtx({ registry, descriptor: delimitedAdapter.descriptor, ...over });
const read = (bytes: Uint8Array, options: Record<string, string> = {}, maxRows = 100_000, over: Partial<Parameters<typeof makeCtx>[0]> = {}) =>
  delimitedAdapter.read(sourceOf(bytes), { tableIndex: 0, options }, { maxRows }, ctx(over));
const table = (r: Result<ExtractionResult>) => {
  if (!r.ok || r.value.kind !== 'tables') throw new Error(r.ok ? 'not tables' : r.error.message);
  return r.value.tables[0]!;
};
const cells = (r: Result<ExtractionResult>) => table(r).rows.map((row) => row.map((c) => c.v));

describe('hostile text inputs', () => {
  it('a 2 MB single token is handled in well under a second (no regex backtracking)', async () => {
    const bytes = utf8('a,b,c\n' + 'x'.repeat(2_000_000) + ',1,2\n');
    const t0 = performance.now();
    expect(detectFormat(bytes, makeHints('t.csv'), registry).chosen?.adapterId).toBe('delimited-text');
    const probe = await delimitedAdapter.probe(sourceOf(bytes), ctx());
    const r = await read(bytes);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(probe.ok).toBe(true);
    expect(cells(r)[1]![0]!.length).toBe(2_000_000);
  });

  it('adversarial quote patterns stay linear', async () => {
    for (const text of ['"'.repeat(500_000), '""'.repeat(250_000), ('a"b,').repeat(100_000) + '\n', '"a",'.repeat(100_000) + '\n', ',\n'.repeat(200_000)]) {
      const t0 = performance.now();
      const bytes = utf8(text);
      detectFormat(bytes, makeHints(null), registry);
      await delimitedAdapter.probe(sourceOf(bytes), ctx());
      await read(bytes, { delimiter: 'comma' });
      expect(performance.now() - t0).toBeLessThan(1500);
    }
  });

  it('a source exactly at the source limit is read and one byte over is refused with the layer (a) text', async () => {
    const limit = 100_000;
    const row = 'A-1,Widget,X\n';
    const body = 'sku,name,wh\n' + row.repeat(Math.floor((limit - 12) / row.length));
    const exact = utf8(body + ' '.repeat(limit - body.length));
    expect(exact.length).toBe(limit);
    expect((await read(exact, {}, 100_000, { limits: { sourceBytes: limit } })).ok).toBe(true);
    const over = await read(utf8(body + ' '.repeat(limit - body.length + 1)), {}, 100_000, { limits: { sourceBytes: limit } });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.message).toMatch(/^File is 0\.1 MB; the limit is 0\.1 MB\./);
  });

  it('20,001 data rows are extracted in full (the row limit is enforced by the pipeline) and a scan cap is explicit', async () => {
    const rows = 'sku,qty,wh\n' + Array.from({ length: 20_001 }, (_, i) => `S-${i},1,X`).join('\n') + '\n';
    const full = table(await read(utf8(rows)));
    expect(full.rowCount).toBe(20_002);
    expect(full.truncated).toBe(false);
    const cut = table(await read(utf8(rows), {}, 20_001));
    expect(cut.truncated).toBe(true);
    expect(cut.rowCount).toBe(20_001);
  });

  it('prototype-like headers and values are plain cell text and never touch Object.prototype', async () => {
    const r = await read(utf8('__proto__,constructor,toString,hasOwnProperty\n__proto__,constructor,toString,{"polluted":true}\n'), { delimiter: 'comma' });
    expect(cells(r)).toEqual([['__proto__', 'constructor', 'toString', 'hasOwnProperty'], ['__proto__', 'constructor', 'toString', '{"polluted":true}']]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('formula-injection cells, HTML and control characters stay inert text for the validators', async () => {
    const r = await read(utf8("a,b,c\n=cmd|'/C calc'!A0,+1,-1\n@SUM(1),<img src=x onerror=alert(1)>,\u0001\u0002\n"));
    expect(cells(r)[1]).toEqual(["=cmd|'/C calc'!A0", '+1', '-1']);
    expect(cells(r)[2]![0]).toBe('@SUM(1)');
    expect(cells(r)[2]![1]).toBe('<img src=x onerror=alert(1)>');
    expect(cells(r)[2]![2]).toBe('\u0001\u0002');
    expect(table(r).rows.every((row) => row.every((c) => c.t === 'text'))).toBe(true);
  });

  it('a mislabelled file is read by its content with a notice, never reinterpreted by name', async () => {
    const asXlsx = detectFormat(utf8('sku,qty\nA-1,2\n'), makeHints('book.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), registry);
    expect(asXlsx.chosen?.adapterId).toBe('delimited-text');
    expect(asXlsx.notices[0]).toContain('named .xlsx');
    const realZipAsCsv = detectFormat(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0), makeHints('data.csv', 'text/csv'), registry);
    expect(realZipAsCsv.outcome).toBe('refused');
    expect(realZipAsCsv.notices[0]).toContain('named .csv');
  });

  it('nothing file-derived is logged during detection or reading', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => {
      const original = console[m];
      const calls: unknown[][] = [];
      console[m] = (...args: unknown[]) => void calls.push(args);
      return { m, original, calls };
    });
    try {
      const bytes = utf8('secret-header,other\nsecret-value,1\n');
      detectFormat(bytes, makeHints('secret-name.csv'), registry);
      await delimitedAdapter.probe(sourceOf(bytes), ctx());
      await read(bytes);
      await read(utf8('a,"open\n'));
    } finally {
      for (const s of spies) console[s.m] = s.original;
    }
    expect(spies.flatMap((s) => s.calls)).toEqual([]);
  });
});
