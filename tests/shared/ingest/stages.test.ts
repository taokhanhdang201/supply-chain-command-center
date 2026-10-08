// The M2 stages on the named fixtures of criterion 45 (detect -> read -> structure -> map -> presets -> normalize ->
// value maps), compared with each fixture's ground truth and golden canonical rows. The canonical CSV builder and the
// full pipeline come in M3; here the canonical ROWS are compared (criteria 9-11, 15, 17-normalizer level, 45, 47-part).

import { describe, expect, it } from 'vitest';
import { AMBIGUITY_FIXTURES, FIXTURES, fixtureByName, type Fixture } from '../../fixtures/ingest/corpus45';
import { readFixture, runStages, sameNumber } from '../../ingest-kit/stagesHarness';
import { applyStructure, detectStructure } from '../../../src/shared/ingest/structure/detectStructure';
import { detectDataset } from '../../../src/shared/ingest/mapping/report';
import { recognizesHeader } from '../../../src/shared/ingest/mapping/dictionary';
import { mapStatusValues, distinctValues, mapWarehouseValues } from '../../../src/shared/ingest/mapping/valueMaps';
import { columnCells } from '../../../src/shared/ingest/structure/detectStructure';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { makeCtx, sourceOf } from '../../ingest-kit/corpus';

describe('criterion 45: every named fixture exists and is well formed', () => {
  const names = [...FIXTURES, ...AMBIGUITY_FIXTURES].map((f) => f.name);
  it('has all the files of the criterion', () => {
    for (const n of [
      'alder_freight.csv', 'casa_verde_es.csv', 'dreilaender_de.tsv', 'dai_phat_vi_inventory.csv', 'dai_phat_vi_shipments.csv', 'eclair_fr.csv', 'fjord_sap_inventory.csv',
      'kestrel_paste.tsv', 'brightwater_banner.csv', 'slash_dates_ambiguous.csv', 'numbers_1_250_ambiguous.csv', 'dates_mixed.csv', 'numbers_mixed.csv', 'mystery_columns.csv', 'both_kinds_16_columns.csv'
    ]) expect(names).toContain(n);
  });
  it('the encodings and delimiters are what their names promise', () => {
    const b = (n: string) => fixtureByName(n).bytes;
    expect([...b('dreilaender_de.tsv').subarray(0, 2)]).toEqual([0xff, 0xfe]); // UTF-16LE BOM
    expect(fixtureByName('casa_verde_es.csv').options).toEqual({ encoding: 'windows-1252' });
    expect(fixtureByName('casa_verde_es.csv').text).toContain(';');
    expect(fixtureByName('fjord_sap_inventory.csv').text.split('\n')[0]).toContain('|');
    expect(fixtureByName('kestrel_paste.tsv').text.split('\r\n')[0]).toContain('\t');
    expect(fixtureByName('eclair_fr.csv').text).toContain(' ');
    expect(fixtureByName('dai_phat_vi_inventory.csv').text).toContain('Mã hàng');
    expect([...b('brightwater_banner.csv').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe.each(FIXTURES.map((f) => [f.name, f] as [string, Fixture]))('stages on %s', (_name, f) => {
  it('reads it (encoding confirmation only where needed) and finds the header', async () => {
    const run = await runStages(f);
    expect(run.structured.headers).toEqual(f.headers);
    if (f.name === 'brightwater_banner.csv') expect(run.structured.headerRowIndex).toBe(2);
    else expect(run.structured.headerRowIndex).toBe(0);
  });

  it('maps every real column to its field (MATCHED or CHECK) and leaves the others "not imported"', async () => {
    const run = await runStages(f);
    run.proposal.columns.forEach((c, i) => {
      const truth = f.truth[i] ?? null;
      if (truth !== null) {
        expect(['matched', 'check'], `${c.header}`).toContain(c.state);
        expect(c.field, c.header).toBe(truth);
        expect(c.evidence.length, `${c.header} has evidence`).toBeGreaterThan(0);
      } else {
        expect(c.state, `${c.header} is junk`).toBe('ignored');
      }
    });
  });

  it('normalizes the values into the golden canonical rows', async () => {
    const run = await runStages(f);
    expect(run.rows).toHaveLength(f.logical.length);
    f.logical.forEach((want, i) => {
      for (const [field, value] of Object.entries(want)) {
        if (!run.mappedFields.has(field)) continue; // a column the file does not carry (optional fields): emitted blank by the builder
        const got = (run.rows[i] as Record<string, string>)[field] as string;
        expect(sameNumber(got, value), `${f.name} row ${i} ${field}: got "${got}" want "${value}"`).toBe(true);
      }
    });
  });
});

describe('preset detection on the fixtures (criteria 9, 47)', () => {
  it('unique presets where the file is unambiguous', async () => {
    expect((await runStages(fixtureByName('casa_verde_es.csv'))).numberOutcome).toMatchObject({ kind: 'unique', preset: 'eu' });
    expect((await runStages(fixtureByName('casa_verde_es.csv'))).dateOutcome).toMatchObject({ kind: 'unique', preset: 'dmy_slash' });
    expect((await runStages(fixtureByName('dreilaender_de.tsv'))).dateOutcome).toMatchObject({ kind: 'unique', preset: 'dmy_dot' });
    expect((await runStages(fixtureByName('eclair_fr.csv'))).numberOutcome).toMatchObject({ kind: 'unique', preset: 'fr' });
    expect((await runStages(fixtureByName('alder_freight.csv'))).dateOutcome).toMatchObject({ kind: 'unique', preset: 'iso', needsNormalization: false });
  });

  it('ambiguity blocks with no preselection, mixed formats block', async () => {
    expect((await runStages(fixtureByName('slash_dates_ambiguous.csv'))).dateOutcome).toMatchObject({ kind: 'ambiguous', candidates: ['mdy_slash', 'dmy_slash'] });
    expect((await runStages(fixtureByName('numbers_1_250_ambiguous.csv'))).numberOutcome).toMatchObject({ kind: 'ambiguous', candidates: ['us', 'eu', 'fr'] });
    expect((await runStages(fixtureByName('dates_mixed.csv'))).dateOutcome.kind).toBe('mixed');
    expect((await runStages(fixtureByName('numbers_mixed.csv'))).numberOutcome.kind).toBe('mixed');
  });
});

describe('structure, status and warehouse maps on the fixtures (criteria 11, 15)', () => {
  it('brightwater: banner rows above the header are skipped, the total row is listed and excluded only after confirmation', async () => {
    const f = fixtureByName('brightwater_banner.csv');
    const table = await readFixture(f);
    const detection = detectStructure(table, recognizesHeader);
    expect(detection.headerRowIndex).toBe(2);
    expect(detection.bannerRows).toEqual([0, 1]);
    expect(detection.structuralRows.map((r) => [r.kind, r.label])).toEqual([['total', 'Total']]);
    expect(table.origin(detection.structuralRows[0]!.rowIndex)).toEqual({ kind: 'line', line: 17 });
    const unconfirmed = applyStructure(table, detection.headerRowIndex, [], detection);
    expect(unconfirmed.rows).toHaveLength(13); // the total row is still there
    const confirmed = applyStructure(table, detection.headerRowIndex, detection.structuralRows.map((r) => r.rowIndex), detection);
    expect(confirmed.rows).toHaveLength(12);
    expect(confirmed.excluded).toEqual([{ rowIndex: detection.structuralRows[0]!.rowIndex, kind: 'total' }]);
  });

  it('status words of every language map onto the four statuses, with counts', async () => {
    for (const name of ['alder_freight.csv', 'casa_verde_es.csv', 'dreilaender_de.tsv', 'dai_phat_vi_shipments.csv', 'eclair_fr.csv']) {
      const f = fixtureByName(name);
      const run = await runStages(f);
      const idx = run.mappedFields.get('status') as number;
      const entries = mapStatusValues(distinctValues(columnCells(run.structured, idx).map((c) => c.v)));
      expect(entries.map((e) => [e.source, e.target, e.state]), name).toEqual(f.statusMap.map(([w, s]) => [w, s, 'mapped']));
      expect(entries.reduce((n, e) => n + e.count, 0)).toBe(f.logical.length);
    }
  });

  it('fjord: the plant codes are not known warehouses, so every distinct value needs an explicit choice', async () => {
    const f = fixtureByName('fjord_sap_inventory.csv');
    const run = await runStages(f);
    const idx = run.mappedFields.get('warehouse') as number;
    const entries = mapWarehouseValues(distinctValues(columnCells(run.structured, idx).map((c) => c.v)));
    expect(entries.length).toBe(5);
    expect(entries.every((e) => e.state === 'choose' && e.target === null)).toBe(true);
    expect(entries[0]?.evidence).toContain('WH-ATL, WH-DFW, WH-EWR, WH-LAX, WH-ORD');
    // the ground truth says how a person would map them
    expect(f.warehouseMap).toEqual([['1000', 'WH-DFW'], ['1010', 'WH-ATL'], ['2000', 'WH-ORD'], ['3000', 'WH-LAX'], ['3010', 'WH-EWR']]);
  });
});

describe('dataset detection (the first proposal thresholds)', () => {
  it('picks the clear dataset and asks when a table carries both kinds', async () => {
    const guess = async (name: string) => {
      const f = [...FIXTURES, ...AMBIGUITY_FIXTURES].find((x) => x.name === name)!;
      const run = await runStages(f);
      return detectDataset(run.structured);
    };
    expect((await guess('alder_freight.csv')).kind).toBe('shipments');
    expect((await guess('dai_phat_vi_inventory.csv')).kind).toBe('inventory');
    expect((await guess('fjord_sap_inventory.csv')).kind).toBe('inventory');
    const both = await guess('both_kinds_16_columns.csv');
    expect(both.kind).toBeNull();
    expect(both.scores.every((s) => s.score > 0.6)).toBe(true);
    expect((await guess('mystery_columns.csv')).kind).toBeNull();
  });
});

describe('encodings: the decoded preview and the confirmation of Windows-1252 (criterion 5)', () => {
  it('casa_verde needs the confirmation; dreilaender (UTF-16) and the others do not', async () => {
    const registry = createDefaultRegistry();
    const adapter = registry.get('delimited-text')!;
    const probeOf = async (f: Fixture) => adapter.probe(sourceOf(f.bytes), makeCtx({ registry, descriptor: adapter.descriptor, hints: f.hints, recognizeHeader: recognizesHeader }), {});
    const cv = await probeOf(fixtureByName('casa_verde_es.csv'));
    expect(cv.ok && cv.value.choices.find((c) => c.key === 'encoding')).toMatchObject({ status: 'needs-confirmation', value: 'windows-1252' });
    const de = await probeOf(fixtureByName('dreilaender_de.tsv'));
    expect(de.ok && de.value.choices.find((c) => c.key === 'encoding')).toMatchObject({ status: 'detected', value: 'utf-16le' });
    expect(de.ok && de.value.choices.find((c) => c.key === 'delimiter')).toMatchObject({ status: 'detected', value: 'tab' });
    const fjord = await probeOf(fixtureByName('fjord_sap_inventory.csv'));
    expect(fjord.ok && fjord.value.choices.find((c) => c.key === 'delimiter')).toMatchObject({ value: 'pipe' });
  });
});
