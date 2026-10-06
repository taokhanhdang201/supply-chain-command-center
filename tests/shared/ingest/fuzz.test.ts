// Criterion 48: 10,000 random byte strings and mutations (bit flips, truncation, BOM swaps, insertions) through the
// detector and the delimited and gzip adapters never throw, always finish within budget, and are deterministic.

import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { delimitedAdapter } from '../../../src/shared/ingest/adapters/delimited/adapter';
import { gzipAdapter } from '../../../src/shared/ingest/adapters/gzip/adapter';
import { detectFormat, makeHints } from '../../../src/shared/ingest/detect/arbiter';
import type { ExtractionResult, FormatAdapter, Result } from '../../../src/shared/ingest/types';
import { concat, cp1252, gzip, makeCtx, mutate, prng, randomBytes, sourceOf, utf16le, utf8, SAMPLE_COMMA_CSV } from '../../ingest-kit/corpus';
import { corpora as delimitedCorpora } from '../../fixtures/ingest/adapters/delimited-text/corpus';
import { corpora as refusalCorpora } from '../../fixtures/ingest/adapters/refusals/corpus';

const registry = createDefaultRegistry();
const SEEDS: Uint8Array[] = [
  utf8(SAMPLE_COMMA_CSV),
  utf16le(SAMPLE_COMMA_CSV.split(',').join('\t')),
  cp1252('sku;almacén\nA-1;Bogotá\n'),
  gzip(utf8(SAMPLE_COMMA_CSV)),
  ...delimitedCorpora.flatMap((c) => c.valid.map((v) => v.bytes)).slice(0, 12),
  ...refusalCorpora.flatMap((c) => c.valid.map((v) => v.bytes))
];

function inputs(count: number, seed: number): Uint8Array[] {
  const rand = prng(seed);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const kind = i % 4;
    if (kind === 0) out.push(randomBytes(rand, Math.floor(rand() * 300)));
    else if (kind === 3) out.push(concat(Uint8Array.of(0x1f, 0x8b, 0x08, 0), randomBytes(rand, 1 + Math.floor(rand() * 80))));
    else out.push(mutate(rand, SEEDS[Math.floor(rand() * SEEDS.length)] as Uint8Array));
  }
  return out;
}

function shape(r: Result<ExtractionResult>): string {
  if (!r.ok) return `error:${r.error.code}:${r.error.message}`;
  if (r.value.kind !== 'tables') return r.value.kind;
  return JSON.stringify(r.value.tables.map((t) => [t.rows, t.truncated, t.notes, t.rows.map((_, i) => t.origin(i))]));
}

async function drive(adapter: FormatAdapter, bytes: Uint8Array): Promise<string> {
  const ctx = makeCtx({ registry, descriptor: adapter.descriptor });
  const src = sourceOf(bytes);
  const probe = await adapter.probe(src, ctx);
  const read = await adapter.read(src, { tableIndex: 0, options: {} }, { maxRows: 500 }, ctx);
  const confirmed = await adapter.read(src, { tableIndex: 0, options: { encoding: 'windows-1252', delimiter: 'comma' } }, { maxRows: 500 }, ctx);
  return [probe.ok ? 'probe-ok' : `probe:${probe.error.code}`, shape(read), shape(confirmed)].join('|');
}

describe('fuzz: detector', () => {
  it('never throws on 10,000 random and mutated inputs, stays fast, and is deterministic', () => {
    const all = inputs(10_000, 1234);
    const started = performance.now();
    let slowest = 0;
    const outcomes = new Map<string, number>();
    for (const bytes of all) {
      const t0 = performance.now();
      const a = detectFormat(bytes, makeHints('x.csv'), registry);
      slowest = Math.max(slowest, performance.now() - t0);
      outcomes.set(a.outcome, (outcomes.get(a.outcome) ?? 0) + 1);
    }
    expect(performance.now() - started).toBeLessThan(40_000);
    expect(slowest).toBeLessThan(250);
    expect(outcomes.size).toBeGreaterThan(2); // the corpus really exercises several outcomes
    for (const bytes of all.slice(0, 1500)) {
      const a = detectFormat(bytes, makeHints('x.csv'), registry);
      const b = detectFormat(bytes, makeHints('x.csv'), registry);
      expect(b).toEqual(a);
    }
  });
});

describe('fuzz: delimited and gzip adapters', () => {
  for (const adapter of [delimitedAdapter, gzipAdapter]) {
    it(`${adapter.descriptor.id}: 10,000 random and mutated inputs never throw, finish in budget and are deterministic`, async () => {
      const all = inputs(10_000, adapter === delimitedAdapter ? 77 : 78);
      const started = performance.now();
      let slowest = 0;
      const first: string[] = [];
      for (const bytes of all) {
        const t0 = performance.now();
        first.push(await drive(adapter, bytes));
        slowest = Math.max(slowest, performance.now() - t0);
      }
      expect(performance.now() - started).toBeLessThan(45_000);
      expect(slowest).toBeLessThan(1500);
      for (let i = 0; i < 600; i++) expect(await drive(adapter, all[i] as Uint8Array)).toBe(first[i]);
    }, 120_000);
  }
});
