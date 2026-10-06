// The real pipeline on the named fixtures of criterion 45: the canonical CSV equals the golden, every row validates through
// the unchanged V1 importers, and every question the preview asks is answered by data (criteria 9-11, 15-19, 45).

import { describe, expect, it } from 'vitest';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { AMBIGUITY_FIXTURES, FIXTURES, fixtureByName } from '../../fixtures/ingest/corpus45';
import { analyze, blockerCodes, inputOf, must, settle } from '../../ingest-kit/pipelineHarness';

describe('pipeline: golden canonical CSV for every unambiguous fixture', () => {
  for (const f of FIXTURES) {
    it(`${f.name}: canonical CSV equals the golden and V1 accepts it`, async () => {
      const answers = {
        warehouse: f.warehouseMap,
        base: { options: new Map(Object.entries(f.options)) }
      };
      const a = must(await settle(inputOf(f), answers));
      expect(a.preview.blockers.map((b) => b.message), f.name).toEqual([]);
      expect(a.preview.canConfirm).toBe(true);
      expect(a.canonical?.csv).toBe(f.golden);
      expect(a.canonical?.fileName).toBe(f.name); // the data-source label is the original file name
      const v1 = f.kind === 'inventory' ? importInventoryCsv(a.canonical?.csv ?? '') : importShipmentsCsv(a.canonical?.csv ?? '');
      expect(v1.ok).toBe(true);
      expect(a.preview.validation).toMatchObject({ ran: true, ok: true });
      expect(a.preview.counts.rowsImported).toBe(f.logical.length);
    });
  }
});

describe('pipeline: what the preview asks for', () => {
  it('Windows-1252 stops before reading until the user confirms the encoding (never applied silently)', async () => {
    const f = fixtureByName('casa_verde_es.csv');
    const first = must(await analyze(inputOf(f)));
    expect(blockerCodes({ ok: true, value: first })).toContain('confirm-choice');
    expect(first.preview.choices.find((c) => c.key === 'encoding')).toMatchObject({ status: 'needs-confirmation', value: 'windows-1252' });
    expect(first.preview.choices.find((c) => c.key === 'encoding')?.sample?.[0]).toContain('Número de envío');
    expect(first.canonical).toBeNull();
    expect(first.preview.columns).toEqual([]);
    const confirmed = must(await analyze(inputOf(f, { options: new Map([['encoding', 'windows-1252']]) })));
    expect(confirmed.preview.columns.length).toBe(f.headers.length);
    expect(confirmed.preview.file.notices.concat(confirmed.preview.file.evidence).join(' ')).toBeDefined();
  });

  it('brightwater: banner rows skipped; the total row is listed and stays in the data until the user confirms', async () => {
    const f = fixtureByName('brightwater_banner.csv');
    const before = must(await analyze(inputOf(f)));
    expect(before.preview.structure).toMatchObject({ banners: 2, confidence: 'detected' });
    expect(before.preview.structure?.structuralRows).toEqual([expect.objectContaining({ kind: 'total', label: 'Total', where: 'line 17', excluded: false })]);
    expect(before.preview.canConfirm).toBe(false); // the total row is a data row until confirmed: V1 rejects it or CHECK columns wait
    const afterAck = must(await settle(inputOf(f)));
    expect(afterAck.preview.structure?.structuralRows[0]?.excluded).toBe(true);
    expect(afterAck.preview.counts.excluded).toEqual([{ reason: 'total', count: 1 }]);
    expect(afterAck.canonical?.csv).toBe(f.golden);
  });

  it('CHECK columns block until acknowledged, then Confirm is enabled', async () => {
    const f = fixtureByName('alder_freight.csv');
    const first = must(await analyze(inputOf(f)));
    const check = first.preview.columns.filter((c) => c.state === 'check');
    expect(check.map((c) => c.header)).toEqual(['State']);
    expect(first.preview.blockers.map((b) => b.code)).toContain('check-column');
    expect(first.preview.canConfirm).toBe(false);
    expect(first.preview.confirmBlockedReason).toContain('State');
    const ack = must(await analyze(inputOf(f, { acknowledgedColumns: [check[0]!.index] })));
    expect(ack.preview.canConfirm).toBe(true);
    expect(ack.preview.confirmBlockedReason).toBeNull();
  });

  it('fjord: plant codes need an explicit warehouse choice for every value; choosing unblocks', async () => {
    const f = fixtureByName('fjord_sap_inventory.csv');
    const first = must(await settle(inputOf(f)));
    expect(first.preview.blockers.map((b) => b.code)).toEqual(['choose-warehouse']);
    expect(first.preview.valueMaps.warehouse?.every((e) => e.state === 'choose')).toBe(true);
    expect(first.preview.blockers[0]?.message).toContain('not SCC warehouses');
    const partial = must(await settle(inputOf(f), { warehouse: [['1000', 'WH-DFW']] }));
    expect(partial.preview.valueMaps.warehouse?.filter((e) => e.state === 'choose').length).toBe(4);
    const done = must(await settle(inputOf(f), { warehouse: f.warehouseMap }));
    expect(done.preview.canConfirm).toBe(true);
    expect(done.preview.valueMaps.warehouse?.every((e) => e.chosenByUser)).toBe(true);
    // a choice outside the known warehouses is ignored, never accepted
    const bad = must(await settle(inputOf(f), { warehouse: [['1000', 'WH-NOPE']] }));
    expect(bad.preview.blockers.map((b) => b.code)).toContain('choose-warehouse');
  });

  it('ambiguity blocks with no preselection; choosing a preset resolves it', async () => {
    const dates = must(await settle(inputOf(fixtureByName('slash_dates_ambiguous.csv'))));
    expect(dates.preview.blockers.map((b) => b.code)).toContain('choose-date-format');
    expect(dates.preview.presets.date).toMatchObject({ kind: 'ambiguous', candidates: ['mdy_slash', 'dmy_slash'], preset: null });
    const chosen = must(await settle(inputOf(fixtureByName('slash_dates_ambiguous.csv')), { datePreset: 'dmy_slash' }));
    expect(chosen.preview.blockers.map((b) => b.code)).not.toContain('choose-date-format');
    expect(chosen.canonical?.csv).toContain('2026-04-03');
    const numbers = must(await settle(inputOf(fixtureByName('numbers_1_250_ambiguous.csv'))));
    expect(numbers.preview.blockers.map((b) => b.code)).toContain('choose-number-format');
    expect(numbers.preview.presets.number).toMatchObject({ kind: 'ambiguous', candidates: ['us', 'eu', 'fr'] });
    const mixed = must(await settle(inputOf(fixtureByName('dates_mixed.csv'))));
    expect(mixed.preview.presets.date?.kind).toBe('mixed');
    expect(mixed.preview.canConfirm).toBe(false);
    expect(must(await settle(inputOf(fixtureByName('numbers_mixed.csv')))).preview.presets.number?.kind).toBe('mixed');
  });

  it('a file carrying both kinds asks which dataset; a mystery file offers the status column as CHECK only', async () => {
    const both = must(await analyze(inputOf(fixtureByName('both_kinds_16_columns.csv'))));
    expect(both.preview.dataset.kind).toBeNull();
    expect(both.preview.blockers.map((b) => b.code)).toContain('choose-dataset');
    const inv = must(await settle(inputOf(fixtureByName('both_kinds_16_columns.csv')), { kind: 'inventory' }));
    expect(inv.preview.dataset).toMatchObject({ kind: 'inventory', chosenByUser: true });
    const mystery = must(await analyze(inputOf(fixtureByName('mystery_columns.csv'), { kind: 'shipments' })));
    expect(mystery.preview.columns.filter((c) => c.state === 'check').map((c) => c.header)).toEqual(['Col3']);
    expect(mystery.preview.blockers.map((b) => b.code)).toContain('missing-required');
  });

  it('missing fields follow the policy: unknown only for optional fields, constants only for descriptors, nothing derived', async () => {
    const f = fixtureByName('fjord_sap_inventory.csv');
    const a = must(await settle(inputOf(f), { warehouse: f.warehouseMap }));
    const get = (name: string) => a.preview.fields.find((x) => x.field === name)!;
    expect(get('avg_daily_usage')).toMatchObject({ state: 'missing', unknown: true, constant: null });
    expect(get('lead_time_days')).toMatchObject({ unknown: true });
    expect(a.canonical?.csv.split('\n')[0]).toBe('sku,product_name,category,warehouse,quantity,reorder_point,unit_cost,avg_daily_usage,lead_time_days');
    const withConstant = must(await settle(inputOf(f), { warehouse: f.warehouseMap, constants: [['lead_time_days', '21']] }));
    expect(withConstant.preview.constants).toEqual([{ field: 'lead_time_days', value: '21' }]);
    expect(withConstant.canonical?.csv.split('\n')[1]?.endsWith(',,21')).toBe(true);
    // a constant for a field that does not allow one is ignored
    const ignored = must(await settle(inputOf(f), { warehouse: f.warehouseMap, constants: [['unit_cost', '5']] }));
    expect(ignored.preview.constants).toEqual([]);
  });

  it('the restatement names the dataset, the current rows and the incoming rows', async () => {
    const f = fixtureByName('alder_freight.csv');
    const a = must(await settle(inputOf(f, undefined, { current: { shipments: { label: 'Sample data (seed 42)', rowCount: 1200 } } })));
    expect(a.preview.restatement).toBe('This will REPLACE the entire Shipments dataset (1,200 rows from Sample data (seed 42)) with 12 rows from alder_freight.csv. If any row fails validation nothing is imported.');
  });

  it('raw versus canonical for the first 10 rows, with source positions', async () => {
    const f = fixtureByName('casa_verde_es.csv');
    const a = must(await settle(inputOf(f), { base: { options: new Map([['encoding', 'windows-1252']]) } }));
    expect(a.preview.sample.rows).toHaveLength(10);
    expect(a.preview.sample.rows[0]?.source).toBe('line 2');
    const cols = a.preview.sample.columns;
    const row = a.preview.sample.rows[0]!;
    expect(row.raw[cols.indexOf('ship_date')]).toMatch(/^\d{1,2}\/\d{1,2}\/2026$/);
    expect(row.canonical[cols.indexOf('ship_date')]).toMatch(/^2026-\d\d-\d\d$/);
    expect(row.raw[cols.indexOf('status')]).toBe('Entregado');
    expect(row.canonical[cols.indexOf('status')]).toBe('delivered');
  });

  it('the preview carries format evidence, mapping evidence and the not-imported list', async () => {
    const f = fixtureByName('alder_freight.csv');
    const a = must(await settle(inputOf(f)));
    expect(a.preview.file).toMatchObject({ family: 'Delimited text', adapterId: 'delimited-text', name: 'alder_freight.csv' });
    expect(a.preview.file.evidence.join(' ')).toContain('valid UTF-8');
    expect(a.preview.choices.map((c) => c.key)).toEqual(['encoding', 'delimiter']);
    expect(a.preview.columns.every((c) => c.evidence.length > 0)).toBe(true);
    expect(a.preview.notImported).toEqual([expect.objectContaining({ header: 'Customer Reference' })]);
    expect(a.preview.counts).toMatchObject({ rowsRead: 12, rowsImported: 12, columnsMapped: 9, columnsIgnored: 1, columnsTotal: 10 });
  });
});

describe('pipeline: fixtures of the ambiguity set are read without throwing', () => {
  for (const f of AMBIGUITY_FIXTURES) {
    it(f.name, async () => {
      const r = await settle(inputOf(f));
      expect(r.ok).toBe(true);
    });
  }
});
