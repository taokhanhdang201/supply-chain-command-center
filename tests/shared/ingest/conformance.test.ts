// Runs the conformance kit over EVERY registered adapter. Registering an adapter in adapters/index.ts is what enrolls
// it: each needs a corpus module at tests/fixtures/ingest/adapters/<dir>/corpus.ts exporting `corpora`.

import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import type { AdapterCorpus } from '../../ingest-kit/corpus';
import { runAdapterConformance } from '../../ingest-kit/conformance';
import { fakeAdapters } from '../../ingest-kit/fakeAdapters';
import { fakeCorpora } from './fakeCorpora';
import { createRegistry } from '../../../src/shared/ingest/registry';

const modules = import.meta.glob<{ corpora: AdapterCorpus[] }>('../../fixtures/ingest/adapters/*/corpus.ts', { eager: true });
const corpusById = new Map<string, AdapterCorpus>();
for (const mod of Object.values(modules)) for (const c of mod.corpora) corpusById.set(c.adapterId, c);

const registry = createDefaultRegistry();

describe('every registered adapter has a conformance corpus and passes the kit', () => {
  it('has a corpus for each registered adapter and none for unknown ids', () => {
    const ids = registry.list().map((a) => a.descriptor.id);
    expect(ids.filter((id) => !corpusById.has(id))).toEqual([]);
    expect([...corpusById.keys()].filter((id) => !ids.includes(id))).toEqual([]);
    expect(ids.length).toBeGreaterThanOrEqual(15);
  });

  for (const adapter of registry.list()) {
    const corpus = corpusById.get(adapter.descriptor.id);
    if (corpus !== undefined) runAdapterConformance(adapter, corpus, registry);
  }
});

describe('the fake adapters (multi-table, nested-record, positioned-text, toy) also pass the kit', () => {
  const fakeRegistry = createRegistry();
  for (const adapter of fakeAdapters) fakeRegistry.register(adapter);
  for (const adapter of fakeAdapters) {
    const corpus = fakeCorpora.find((c) => c.adapterId === adapter.descriptor.id);
    it(`${adapter.descriptor.id} has a corpus`, () => expect(corpus).toBeDefined());
    if (corpus !== undefined) runAdapterConformance(adapter, corpus, fakeRegistry);
  }
});
