// Determinism through the whole pipeline (SA-5, criterion 26): no network, Math.random or Date; repeated runs and shuffled
// decision insertion orders give byte-identical analyses (mapping report, preview and canonical CSV).

import { describe, expect, it, vi } from 'vitest';
import { FIXTURES, fixtureByName } from '../../fixtures/ingest/corpus45';
import { analyze, inputOf, must, settle } from '../../ingest-kit/pipelineHarness';

const json = (r: Awaited<ReturnType<typeof analyze>>): string => JSON.stringify(r.ok ? { preview: r.value.preview, csv: r.value.canonical?.csv ?? null } : { error: r.error });

describe('pipeline determinism', () => {
  it('repeated runs are byte-identical for every fixture', async () => {
    for (const f of FIXTURES) {
      const answers = { warehouse: f.warehouseMap, base: { options: new Map(Object.entries(f.options)) } };
      const a = json(await settle(inputOf(f), answers));
      const b = json(await settle(inputOf(f), answers));
      expect(b, f.name).toBe(a);
    }
  });

  it('never touches the network, Math.random or Date', async () => {
    const reference = json(await settle(inputOf(fixtureByName('alder_freight.csv'))));
    const fetchStub = vi.fn(() => {
      throw new Error('network is forbidden');
    });
    vi.stubGlobal('fetch', fetchStub);
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random is forbidden');
    });
    const RealDate = Date;
    vi.stubGlobal(
      'Date',
      new Proxy(RealDate, {
        // The V1 validators build calendar dates from explicit numbers (deterministic); reading the CLOCK is what is forbidden.
        construct(target, args) {
          if (args.length === 0) throw new Error('reading the clock (new Date()) is forbidden');
          return Reflect.construct(target, args) as object;
        },
        get(target, prop, receiver) {
          if (prop === 'now') return () => {
            throw new Error('Date.now is forbidden');
          };
          return Reflect.get(target, prop, receiver);
        }
      })
    );
    try {
      for (const f of FIXTURES) await settle(inputOf(f), { warehouse: f.warehouseMap, base: { options: new Map(Object.entries(f.options)) } });
      expect(json(await settle(inputOf(fixtureByName('alder_freight.csv'))))).toBe(reference);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('the insertion order of Map decisions never changes the result', async () => {
    const f = fixtureByName('fjord_sap_inventory.csv');
    const forward = f.warehouseMap as Array<[string, string]>;
    const a = json(await settle(inputOf(f), { warehouse: forward }));
    const b = json(await settle(inputOf(f), { warehouse: [...forward].reverse() }));
    expect(b).toBe(a);
    const s1 = json(await settle(inputOf(fixtureByName('alder_freight.csv')), { status: [['Delivered', 'delivered'], ['Booked', 'pending']] }));
    const s2 = json(await settle(inputOf(fixtureByName('alder_freight.csv')), { status: [['Booked', 'pending'], ['Delivered', 'delivered']] }));
    expect(s2).toBe(s1);
  });

  it('the preview is structured-cloneable (it crosses the worker boundary) and contains no functions', async () => {
    for (const f of FIXTURES) {
      const a = must(await settle(inputOf(f), { warehouse: f.warehouseMap, base: { options: new Map(Object.entries(f.options)) } }));
      const copy = structuredClone(a);
      expect(copy).toEqual(a);
    }
  });

  it('mapping evidence is the same strings run to run (human-readable and reproducible)', async () => {
    const a = must(await settle(inputOf(fixtureByName('alder_freight.csv'))));
    const b = must(await settle(inputOf(fixtureByName('alder_freight.csv'))));
    expect(a.preview.columns.map((c) => c.evidence)).toEqual(b.preview.columns.map((c) => c.evidence));
    expect(a.preview.columns.every((c) => c.evidence.length > 0)).toBe(true);
  });
});
