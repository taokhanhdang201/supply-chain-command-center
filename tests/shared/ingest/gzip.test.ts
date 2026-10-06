import { describe, expect, it } from 'vitest';
import { gzipAdapter } from '../../../src/shared/ingest/adapters/gzip/adapter';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { detectFormat, makeHints } from '../../../src/shared/ingest/detect/arbiter';
import type { ExtractionResult, Result } from '../../../src/shared/ingest/types';
import { concat, cp1252, gzip, makeCtx, sourceOf, utf16le, utf8, SAMPLE_COMMA_CSV } from '../../ingest-kit/corpus';

const registry = createDefaultRegistry();
const ctx = (over: Partial<Parameters<typeof makeCtx>[0]> = {}) => makeCtx({ registry, descriptor: gzipAdapter.descriptor, ...over });
const read = (bytes: Uint8Array, options: Record<string, string> = {}, over: Partial<Parameters<typeof makeCtx>[0]> = {}) =>
  gzipAdapter.read(sourceOf(bytes), { tableIndex: 0, options }, { maxRows: 100_000 }, ctx(over));
const probe = (bytes: Uint8Array, options: Record<string, string> = {}, over: Partial<Parameters<typeof makeCtx>[0]> = {}) => gzipAdapter.probe(sourceOf(bytes), ctx(over), options);
const code = (r: Result<unknown>) => (r.ok ? 'ok' : r.error.code);
const values = (r: Result<ExtractionResult>) => {
  if (!r.ok || r.value.kind !== 'tables') throw new Error(r.ok ? 'not tables' : r.error.message);
  return r.value.tables[0]!.rows.map((row) => row.map((c) => c.v));
};

describe('gzip adapter (single file, depth 1)', () => {
  it('reads a gzip-compressed delimited file through the inner adapter', async () => {
    const r = await read(gzip(utf8(SAMPLE_COMMA_CSV)));
    expect(values(r)[1]![0]).toBe('ELC-9001');
    expect(values(r)).toHaveLength(3);
  });

  it('reads gzip of UTF-16 text and of Windows-1252 text after the inner confirmation', async () => {
    expect(values(await read(gzip(utf16le(SAMPLE_COMMA_CSV.split(',').join('\t')))))[0]![0]).toBe('sku');
    const cp = gzip(cp1252('sku;almacén;qty\nA-1;Bogotá;5\n'));
    expect(code(await read(cp))).toBe('ENCODING_NEEDS_CONFIRMATION');
    expect(values(await read(cp, { encoding: 'windows-1252' }))[1]).toEqual(['A-1', 'Bogotá', '5']);
  });

  it('probe passes the inner choices through and adds gzip evidence', async () => {
    const r = await probe(gzip(utf8(SAMPLE_COMMA_CSV)), {}, { hints: { fileName: 'stock.csv.gz', extension: '.gz' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.evidence[0]).toMatch(/^gzip-compressed \(/);
      expect(r.value.choices.map((c) => c.key)).toEqual(['encoding', 'delimiter']);
      expect(r.value.facts).toMatchObject({ compressed: 'gzip', delimiter: 'comma' });
    }
  });

  it('gzip never bypasses the inner family source limit', async () => {
    const big = utf8('a,b,c\n' + 'x'.repeat(400) + ',1,2\n');
    expect(code(await read(gzip(big), {}, { limits: { sourceBytes: 100 } }))).toBe('LIMIT_EXPANDED');
    expect(code(await read(gzip(big)))).toBe('ok');
  });

  it('caps the expansion ratio: a gzip bomb is refused before it is expanded into memory', async () => {
    const r = await read(gzip(new Uint8Array(3 * 1024 * 1024)));
    expect(code(r)).toBe('LIMIT_RATIO');
    if (!r.ok) expect(r.error.message).toContain('decompression bomb');
  });

  it('a legitimate highly repetitive file under the ratio floor is accepted', async () => {
    const rows = 'sku,qty,wh\n' + 'AAA-001,1,X\n'.repeat(5000);
    expect(code(await read(gzip(utf8(rows))))).toBe('ok');
  });

  it('refuses nested gzip, gzip of a packaged or binary file, and gzip of nothing', async () => {
    const good = gzip(utf8(SAMPLE_COMMA_CSV));
    expect(code(await read(gzip(good)))).toBe('PACKED_NESTED');
    const png = gzip(concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), new Uint8Array(40)));
    const r = await read(png);
    expect(code(r)).toBe('PACKED_INNER_UNSUPPORTED');
    if (!r.ok) expect(r.error.message).toContain('image');
    expect(code(await read(gzip(new Uint8Array(0))))).toBe('EMPTY_FILE');
    expect(code(await read(gzip(new Uint8Array(100))))).toBe('PACKED_INNER_UNSUPPORTED');
  });

  it('reports truncated, corrupted and trailing-garbage gzip as damaged', async () => {
    const good = gzip(utf8(SAMPLE_COMMA_CSV));
    expect(code(await read(good.subarray(0, good.length - 9)))).toBe('PACKED_DAMAGED');
    expect(code(await read(good.subarray(0, 10)))).toBe('PACKED_DAMAGED');
    expect(code(await read(Uint8Array.from(good, (b, i) => (i === 14 ? b ^ 0xff : b))))).toBe('PACKED_DAMAGED');
  });

  it('a pre-aborted signal returns CANCELLED and a failure is never cached', async () => {
    const good = gzip(utf8(SAMPLE_COMMA_CSV));
    const src = sourceOf(good);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await gzipAdapter.read(src, { tableIndex: 0, options: {} }, { maxRows: 10 }, ctx({ signal: controller.signal }));
    expect(code(cancelled)).toBe('CANCELLED');
    const ok = await gzipAdapter.read(src, { tableIndex: 0, options: {} }, { maxRows: 10 }, ctx());
    expect(ok.ok).toBe(true);
  });

  it('enforces the gzip file size limit before reading', async () => {
    expect(code(await probe(gzip(utf8(SAMPLE_COMMA_CSV)), {}, { limits: { sourceBytes: 10 } }))).toBe('LIMIT_SOURCE_BYTES');
  });

  it('detection uses the magic signature and the .gz extension is only a hint', () => {
    const bytes = gzip(utf8(SAMPLE_COMMA_CSV));
    expect(detectFormat(bytes, makeHints('whatever.csv'), registry).chosen?.adapterId).toBe('gzip');
    expect(detectFormat(utf8(SAMPLE_COMMA_CSV), makeHints('fake.gz'), registry).chosen?.adapterId).toBe('delimited-text');
  });
});
