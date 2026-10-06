// The demo samples: built from the sample generator with seed 7, valid for the V1 importers and the review pipeline,
// and the "with errors" sample is blocked by validation errors in three columns.
import { describe, it, expect } from 'vitest';
import { buildSampleFile, displaySourceLabel, ERROR_SAMPLE_BROKEN, ERROR_SAMPLE_ROWS, sampleFileName } from '../../../src/client/import/sampleFiles';
import { importInventoryCsv } from '../../../src/shared/csv/importInventory';
import { importShipmentsCsv } from '../../../src/shared/csv/importShipments';
import { generateSampleData } from '../../../src/shared/sample/generateSampleData';
import { InlineRunner } from '../../../src/client/ingest/runner';
import { TODAY } from '../../helpers/fixtures';

const text = (f: File): Promise<string> => f.text();
const bytes = async (f: File): Promise<Uint8Array> => new Uint8Array(await f.arrayBuffer());

async function analyze(f: File) {
  const outcome = await new InlineRunner().run({ bytes: await bytes(f), fileName: f.name }).promise;
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

describe('sample files', () => {
  it('names the samples so the data source reads "Sample data (seed 7)"', () => {
    expect(sampleFileName('shipments')).toBe('sample-shipments-seed-7.csv');
    expect(displaySourceLabel('sample-inventory-seed-7.csv')).toBe('Sample data (seed 7)');
    expect(displaySourceLabel('my_export.csv')).toBe('my_export.csv');
  });

  it('the shipments sample is every generated shipment for seed 7 and passes the V1 importer', async () => {
    const f = buildSampleFile('shipments', TODAY);
    const expected = generateSampleData({ seed: 7, today: TODAY }).shipments;
    const result = importShipmentsCsv(await text(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual(expected);
  });

  it('the inventory sample is every generated item for seed 7 and passes the V1 importer', async () => {
    const f = buildSampleFile('inventory', TODAY);
    const expected = generateSampleData({ seed: 7, today: TODAY }).inventory;
    const result = importInventoryCsv(await text(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual(expected);
  });

  it.each(['shipments', 'inventory'] as const)('the %s sample reviews with every column matched and can be confirmed', async (id) => {
    const analysis = await analyze(buildSampleFile(id, TODAY));
    expect(analysis.kind).toBe(id);
    expect(analysis.preview.blockers).toEqual([]);
    expect(analysis.preview.canConfirm).toBe(true);
    expect(analysis.preview.counts.columnsMapped).toBe(analysis.preview.counts.columnsTotal);
  });

  it('the sample with errors has 20 rows and is blocked by validation errors in ship_date, shipment_id and shipping_cost', async () => {
    const f = buildSampleFile('errors', TODAY);
    expect((await text(f)).trim().split('\n')).toHaveLength(ERROR_SAMPLE_ROWS + 1);
    const { preview } = await analyze(f);
    expect(preview.canConfirm).toBe(false);
    expect(preview.validation.ran).toBe(true);
    expect(preview.validation.ok).toBe(false);
    const byColumn = new Map<string, number>();
    for (const d of preview.validation.issues) byColumn.set(d.issue.column ?? '', (byColumn.get(d.issue.column ?? '') ?? 0) + 1);
    expect(Object.fromEntries(byColumn)).toEqual({
      ship_date: ERROR_SAMPLE_BROKEN.shipDate.length,
      shipment_id: ERROR_SAMPLE_BROKEN.shipmentId.length,
      shipping_cost: ERROR_SAMPLE_BROKEN.shippingCost.length
    });
  });
});
