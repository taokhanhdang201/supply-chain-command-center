// T-DUMMY (SA-1, criterion 23) and the SA-3 fake adapters (criterion 24, extraction and detection level; the whole
// pipeline runs of the fakes are added with the pipeline in milestone M3).

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { detectFormat, makeHints } from '../../../src/shared/ingest/detect/arbiter';
import { supportedFormatsText, unsupportedTypeMessage } from '../../../src/shared/ingest/messages';
import { createRegistry } from '../../../src/shared/ingest/registry';
import type { ExtractionResult, FormatAdapter, Result } from '../../../src/shared/ingest/types';
import { makeCtx, sourceOf } from '../../ingest-kit/corpus';
import { fakeAdapters, multiTableAdapter, positionedAdapter, recordAdapter, toyAdapter } from '../../ingest-kit/fakeAdapters';
import { imagesOnlyBytes, multiBytes, positionedBytes, recordBytes, toyBytes } from './fakeCorpora';

function hashCore(): string {
  const root = resolve(process.cwd(), 'src/shared/ingest');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(readFileSync(f));
  return h.digest('hex');
}

async function run(adapter: FormatAdapter, bytes: Uint8Array, tableIndex = 0) {
  const registry = createRegistry();
  registry.register(adapter);
  const ctx = makeCtx({ registry, descriptor: adapter.descriptor });
  const probe = await adapter.probe(sourceOf(bytes), ctx);
  const read = await adapter.read(sourceOf(bytes), { tableIndex, options: {} }, { maxRows: 1000 }, ctx);
  return { probe, read };
}
const tables = (r: Result<ExtractionResult>) => {
  if (!r.ok || r.value.kind !== 'tables') throw new Error(r.ok ? 'expected tables' : r.error.message);
  return r.value.tables;
};

describe('T-DUMMY: a toy-format adapter registered from the test only', () => {
  it('is detected, probed and read without any file under src/ being edited', async () => {
    const before = hashCore();
    const registry = createDefaultRegistry();

    // Before registration the toy text is just plain text to the delimited adapter.
    expect(detectFormat(toyBytes, makeHints('stock.toy'), registry).chosen?.adapterId).toBe('delimited-text');

    registry.register(toyAdapter);
    const detection = detectFormat(toyBytes, makeHints('stock.toy'), registry);
    expect(detection.outcome).toBe('chosen');
    expect(detection.chosen).toMatchObject({ adapterId: 'toy-kv', evidenceClass: 'magic' });
    expect(detection.chosen?.evidence).toContain('toy format header line');

    const adapter = registry.get('toy-kv')!;
    const ctx = makeCtx({ registry, descriptor: adapter.descriptor });
    const probe = await adapter.probe(sourceOf(toyBytes), ctx);
    expect(probe.ok && probe.value.tables[0]).toMatchObject({ name: 'Toy', rowCountEstimate: 2 });
    const read = await adapter.read(sourceOf(toyBytes), { tableIndex: 0, options: {} }, { maxRows: 100 }, ctx);
    const t = tables(read)[0]!;
    expect(t.columns?.map((c) => c.header)).toEqual(['sku', 'warehouse', 'quantity']);
    expect(t.rows.map((r) => r.map((c) => c.v))).toEqual([['ABC-100', 'WH-DFW', '5'], ['ABC-101', 'WH-ATL', '7']]);
    expect(t.origin(1, 2)).toEqual({ kind: 'line', line: 3, column: 3 });

    expect(hashCore()).toBe(before);
  });

  it('registering it changes the generated supported-format and unsupported-type texts', () => {
    const registry = createDefaultRegistry();
    const before = supportedFormatsText(registry);
    registry.register(toyAdapter);
    const after = supportedFormatsText(registry);
    expect(after).not.toBe(before);
    expect(after).toContain('Toy key-value text (.toy)');
    expect(unsupportedTypeMessage(registry, null)).toContain('Toy key-value text (.toy)');
    // and unregistering restores it (the registry holds no global state)
    registry.unregister('toy-kv');
    expect(supportedFormatsText(registry)).toBe(before);
  });
});

describe('SA-3 fake adapters: extraction and detection (criterion 24)', () => {
  it('multi-table typed-cell source: hidden table, merged-fill note, date-typed cells, cell refs', async () => {
    const registry = createRegistry();
    for (const a of fakeAdapters) registry.register(a);
    expect(detectFormat(multiBytes, makeHints('book.xlsx'), registry).chosen?.adapterId).toBe('fake-multi');

    const { probe, read } = await run(multiTableAdapter, multiBytes, 0);
    expect(probe.ok && probe.value.tables).toEqual([
      { name: 'Loads', hidden: false, rowCountEstimate: 3 },
      { name: 'Notes', hidden: true, rowCountEstimate: 1 }
    ]);
    const loads = tables(read)[0]!;
    expect(loads.name).toBe('Loads');
    expect(loads.rows[1]!.map((c) => c.t)).toEqual(['text', 'date', 'number']);
    expect(loads.rows[1]![1]!.v).toBe('2026-03-02');
    expect(loads.notes).toEqual([{ code: 'merged-filled', message: '1 merged cell(s) were filled with the top-left value.', count: 1 }]);
    expect(loads.origin(1, 0)).toEqual({ kind: 'cell', sheet: 'Loads', row: 2, col: 1 });

    const second = await run(multiTableAdapter, multiBytes, 1);
    const notes = tables(second.read)[0]!;
    expect(notes).toMatchObject({ name: 'Notes', hidden: true });
  });

  it('nested-record source: records with path refs, path columns via ordered entries and a child array', async () => {
    const { read } = await run(recordAdapter, recordBytes);
    expect(read.ok).toBe(true);
    if (!read.ok || read.value.kind !== 'records') throw new Error('expected records');
    expect(read.value.name).toBe('shipments');
    const first = read.value.records[0]!;
    expect(first.path).toBe('$.shipments[0]');
    const keys = first.entries.map(([k]) => k);
    expect(keys).toEqual(['shipment', 'status', 'events']);
    const shipment = first.entries[0]![1];
    expect(typeof shipment === 'object' && shipment !== null && !Array.isArray(shipment) && shipment.path).toBe('$.shipments[0].shipment');
    const events = first.entries[2]![1];
    expect(Array.isArray(events) && events.map((e) => e.path)).toEqual(['$.shipments[0].events[0]', '$.shipments[0].events[1]']);
  });

  it('positioned-text source: pages of runs, and an images-only variant', async () => {
    const { read } = await run(positionedAdapter, positionedBytes);
    expect(read.ok && read.value.kind === 'positioned-text' && read.value.pages[0]?.map((r) => r.text)).toEqual(['Consignment', 'Freight', 'SHP-1', '812.40']);
    const images = await run(positionedAdapter, imagesOnlyBytes);
    expect(images.read.ok && images.read.value).toEqual({ kind: 'images-only', pages: 2 });
  });

  it('every fake declares the yields and source-reference kinds that cover its output', () => {
    expect(multiTableAdapter.descriptor).toMatchObject({ yields: ['tables'], multiTable: true, typedCells: true, sourceRefKind: ['cell'] });
    expect(recordAdapter.descriptor).toMatchObject({ yields: ['records'], hierarchical: true, sourceRefKind: ['path', 'record'] });
    expect(positionedAdapter.descriptor.yields).toEqual(['positioned-text', 'images-only']);
    expect(positionedAdapter.descriptor.sourceRefKind).toEqual(['page']);
  });
});
