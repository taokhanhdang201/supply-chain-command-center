// The adapter conformance kit: `runAdapterConformance(adapter, corpus, registry)` asserts the contract for ANY
// adapter (descriptor validity, total/bounded/deterministic detect, structured errors, limits, abort, output
// invariants, no input mutation, hostile pack). One generic test file enrolls every registered adapter, so registering
// an adapter is what puts it under this gate.

import { describe, expect, it } from 'vitest';
import type { AdapterLookup, ExtractionResult, FormatAdapter, Result } from '../../src/shared/ingest/types';
import { validateDescriptor } from '../../src/shared/ingest/registry';
import { supportedFormatsText, unsupportedTypeMessage } from '../../src/shared/ingest/messages';
import { MESSAGE_CATALOGUE } from '../../src/shared/ingest/messages';
import { detectFormat } from '../../src/shared/ingest/detect/arbiter';
import { headOf } from '../../src/shared/ingest/detect/bytes';
import { makeCtx, makeHints, mutate, prng, randomBytes, sourceOf, type AdapterCorpus, type CorpusEntry } from './corpus';

const STAGES = ['detect', 'probe', 'read', 'structure', 'map', 'normalize', 'validate', 'limits'];
const KNOWN_CODES = new Set<string>(Object.keys(MESSAGE_CATALOGUE));

function expectStructuredError(result: Result<unknown>): void {
  if (result.ok) return;
  expect(typeof result.error.code).toBe('string');
  expect(result.error.message.length).toBeGreaterThan(0);
  expect(STAGES).toContain(result.error.stage);
  expect(KNOWN_CODES.has(result.error.code), `error code ${result.error.code} must be in the message catalogue`).toBe(true);
}

function checkExtraction(adapter: FormatAdapter, result: ExtractionResult): void {
  const kinds = adapter.descriptor.sourceRefKind;
  expect(adapter.descriptor.yields).toContain(result.kind);
  if (result.kind === 'tables') {
    expect(result.tables.length).toBeGreaterThan(0);
    for (const table of result.tables) {
      expect(table.rowCount).toBe(table.rows.length);
      let widest = 0;
      table.rows.forEach((row, r) => {
        if (row.length > widest) widest = row.length;
        for (const cell of row) {
          expect(typeof cell.v).toBe('string');
          expect(['text', 'number', 'date', 'bool', 'error', 'empty']).toContain(cell.t);
        }
        const ref = table.origin(r);
        expect(kinds, `origin kind ${ref.kind} must be declared in sourceRefKind`).toContain(ref.kind);
        if (row.length > 0) expect(kinds).toContain(table.origin(r, 0).kind);
      });
      expect(table.colCount).toBeGreaterThanOrEqual(widest);
      expect(typeof table.name).toBe('string');
      expect(typeof table.hidden).toBe('boolean');
      expect(table.ref.adapterId.length).toBeGreaterThan(0);
    }
  } else if (result.kind === 'records') {
    expect(result.records.length).toBeGreaterThan(0);
    for (const rec of result.records) {
      expect(typeof rec.path).toBe('string');
      for (const [key] of rec.entries) expect(typeof key).toBe('string');
    }
  } else if (result.kind === 'positioned-text') {
    expect(result.pages.length).toBeGreaterThan(0);
    for (const page of result.pages) for (const run of page) expect(typeof run.text).toBe('string');
  }
}

/** A stable JSON rendering of an extraction (functions and cyclic refs dropped) for determinism checks. */
export function snapshotOf(result: ExtractionResult): string {
  if (result.kind !== 'tables') return JSON.stringify(result);
  return JSON.stringify(
    result.tables.map((t) => ({ ref: t.ref, name: t.name, rows: t.rows, truncated: t.truncated, origins: t.rows.map((_, i) => t.origin(i)), notes: t.notes, meta: t.meta }))
  );
}

async function run(adapter: FormatAdapter, registry: AdapterLookup, entry: CorpusEntry, overrides: Parameters<typeof makeCtx>[0] extends infer T ? Partial<T & object> : never = {}) {
  const ctx = makeCtx({ registry, descriptor: adapter.descriptor, hints: entry.hints, ...overrides });
  const src = sourceOf(entry.bytes);
  const probe = await adapter.probe(src, ctx, entry.options);
  const read = await adapter.read(src, { tableIndex: 0, options: entry.options ?? {} }, { maxRows: 100_000 }, ctx);
  return { probe, read };
}

export function runAdapterConformance(adapter: FormatAdapter, corpus: AdapterCorpus, registry: AdapterLookup): void {
  const d = adapter.descriptor;
  const isRefusal = d.status === 'refusal';

  describe(`conformance: ${d.id}`, () => {
    it('has a valid descriptor and registry-generated messages that mention its family', () => {
      expect(validateDescriptor(d)).toEqual([]);
      if (isRefusal) expect(unsupportedTypeMessage(registry, d)).toContain(d.family);
      else expect(supportedFormatsText(registry)).toContain(d.family);
    });

    it('detect is total, bounded and deterministic on random bytes and mutations of its own fixtures', () => {
      const rand = prng(7);
      const samples: Uint8Array[] = [];
      for (let i = 0; i < 150; i++) samples.push(randomBytes(rand, Math.floor(rand() * 600)));
      for (const entry of [...corpus.valid, ...corpus.hostile]) for (let i = 0; i < 12; i++) samples.push(mutate(rand, entry.bytes));
      const hints = makeHints({ extension: '.csv' });
      const started = performance.now();
      for (const bytes of samples) {
        const a = adapter.detect(bytes, hints);
        const b = adapter.detect(bytes, hints);
        expect(a).toEqual(b);
        expect(a.confidence).toBeGreaterThanOrEqual(0);
        expect(a.confidence).toBeLessThanOrEqual(1);
        expect(Array.isArray(a.evidence)).toBe(true);
      }
      expect(performance.now() - started).toBeLessThan(5000);
    });

    it('detect does not mutate its input', () => {
      for (const entry of corpus.valid) {
        const copy = Uint8Array.from(entry.bytes);
        adapter.detect(entry.bytes, makeHints());
        expect(entry.bytes).toEqual(copy);
      }
    });

    it('votes for its own valid fixtures (through the arbiter when detectable)', () => {
      for (const entry of corpus.valid) {
        if (entry.detectable === false) continue;
        const vote = adapter.detect(headOf(sourceOf(entry.bytes)), makeHints(entry.hints));
        expect(vote.confidence, `${entry.name} should be recognized by ${d.id}`).toBeGreaterThan(0);
        const detection = detectFormat(entry.bytes, makeHints(entry.hints), registry);
        expect(detection.candidates.map((c) => c.adapterId), `${entry.name} candidates`).toContain(d.id);
      }
    });

    if (isRefusal) {
      it('refuses with a structured, registry-generated message', async () => {
        for (const entry of corpus.valid) {
          const { probe, read } = await run(adapter, registry, entry);
          for (const r of [probe, read]) {
            expect(r.ok).toBe(false);
            if (!r.ok) {
              expect(r.error.message).toContain(d.family);
              expectStructuredError(r);
            }
          }
        }
      });
    } else {
      it('reads every valid fixture: invariants, determinism, no input mutation', async () => {
        for (const entry of corpus.valid) {
          const before = Uint8Array.from(entry.bytes);
          const first = await run(adapter, registry, entry);
          expect(first.probe.ok, `${entry.name} probe`).toBe(true);
          expect(first.read.ok, `${entry.name} read: ${first.read.ok ? '' : first.read.error.message}`).toBe(true);
          if (first.read.ok) checkExtraction(adapter, first.read.value);
          expect(entry.bytes, `${entry.name} input must not be mutated`).toEqual(before);
          const second = await run(adapter, registry, entry);
          if (first.read.ok && second.read.ok) expect(snapshotOf(second.read.value)).toBe(snapshotOf(first.read.value));
        }
      });

      it('honours maxRows and marks truncation', async () => {
        for (const entry of corpus.valid) {
          const ctx = makeCtx({ registry, descriptor: d, hints: entry.hints });
          const full = await adapter.read(sourceOf(entry.bytes), { tableIndex: 0, options: entry.options ?? {} }, { maxRows: 100_000 }, ctx);
          const one = await adapter.read(sourceOf(entry.bytes), { tableIndex: 0, options: entry.options ?? {} }, { maxRows: 1 }, ctx);
          expect(one.ok).toBe(true);
          if (full.ok && one.ok && full.value.kind === 'tables' && one.value.kind === 'tables') {
            const total = full.value.tables[0]?.rows.length ?? 0;
            const limited = one.value.tables[0];
            expect(limited?.rows.length ?? 0).toBeLessThanOrEqual(1);
            if (total > 1) expect(limited?.truncated).toBe(true);
          }
        }
      });

      it('honours an aborted signal with a structured CANCELLED error', async () => {
        const controller = new AbortController();
        controller.abort();
        for (const entry of corpus.valid) {
          const ctx = makeCtx({ registry, descriptor: d, hints: entry.hints, signal: controller.signal });
          const result = await adapter.read(sourceOf(entry.bytes), { tableIndex: 0, options: entry.options ?? {} }, { maxRows: 1000 }, ctx);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe('CANCELLED');
            expectStructuredError(result);
          }
        }
      });

      it('honours the source-size limit of layer (a) with a structured limits error', async () => {
        for (const entry of corpus.valid) {
          if (entry.bytes.length < 20) continue;
          const ctx = makeCtx({ registry, descriptor: d, hints: entry.hints, limits: { sourceBytes: 10 } });
          const result = await adapter.probe(sourceOf(entry.bytes), ctx, entry.options);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.stage).toBe('limits');
            expectStructuredError(result);
          }
        }
      });
    }

    // CPU-heavy for delimited-text (~2.6 s alone, measured); under the parallel full suite it can pass 5 s. 15 s as in
    // pipelineLimits.test.ts.
    it('handles the hostile pack without throwing and with structured errors', { timeout: 15_000 }, async () => {
      for (const entry of corpus.hostile) {
        const { probe, read } = await run(adapter, registry, entry);
        expectStructuredError(probe);
        expectStructuredError(read);
        if (read.ok) checkExtraction(adapter, read.value);
      }
    });

    it('probe and read do not throw on random bytes', async () => {
      const rand = prng(11);
      for (let i = 0; i < 40; i++) {
        const entry: CorpusEntry = { name: `random-${i}`, bytes: randomBytes(rand, Math.floor(rand() * 300)) };
        const { probe, read } = await run(adapter, registry, entry);
        expectStructuredError(probe);
        expectStructuredError(read);
      }
    });
  });
}
