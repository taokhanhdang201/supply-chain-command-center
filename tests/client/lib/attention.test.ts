// "Do these first" (docs/DASHBOARD-ALERTS.md): the kinds and their counts, the money formulas, move or reorder, the queue's
// order and every tie-break, carrier grouping, the 3-row stock cap, the reserved late row, and the seed-42 queue.

import { describe, expect, it } from 'vitest';
import type { Shipment, Snapshot } from '../../../src/shared/types';
import { createSampleDataset } from '../../../src/shared/sample/generateSampleData';
import { buildSnapshot } from '../../../src/shared/domain/snapshot';
import { buildQueue, kindCounts, kindOf, MAX_STOCK_ROWS, shortBeforeRestockCents, stockAction } from '../../../src/client/lib/attention';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../../helpers/fixtures';

const DAY = '2026-10-07';
const seed42 = (): Snapshot =>
  buildSnapshot(createSampleDataset(42, DAY, `${DAY}T00:00:00.000Z`), DAY, { generatedAt: `${DAY}T00:00:00.000Z`, limits: { maxUploadBytes: 2_097_152, maxRows: 20_000 } });

/** A delivered shipment with an unusual cost (the fields the queue reads). */
function anomaly(base: Shipment, carrier: string, costCents: number, baselineCents: number, id: string): Shipment {
  return { ...base, shipmentId: id, carrier, shippingCostCents: costCents, cost: { method: 'route_carrier', peerCount: 9, baselineCents, score: 9, isAnomaly: true } };
}
/** An in-transit shipment overdue by `days`. */
function overdue(base: Shipment, carrier: string, days: number, id: string): Shipment {
  return { ...base, shipmentId: id, carrier, status: 'in_transit', actualDelivery: null, deliveryState: 'overdue', isDelayed: true, daysLate: days };
}
const withShipments = (snapshot: Snapshot, shipments: Shipment[]): Snapshot => ({ ...snapshot, shipments });
const base = (): Shipment => makeSnapshot([], [makeShipmentRecord()], { today: TODAY }).shipments[0] as Shipment;

describe('kinds: only alerts that need attention, adding up to the KPI and badge count', () => {
  it('seed 42: 6 out of stock, 14 low stock, 12 overdue, 8 unusual costs, 17 incomplete or wrong records = 57', () => {
    const snap = seed42();
    const kinds = kindCounts(snap.alerts);
    expect(kinds.map((k) => k.text)).toEqual(['6 out of stock', '14 low stock', '12 overdue', '8 unusual costs', '17 incomplete or wrong records']);
    const needAttention = snap.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
    expect(kinds.reduce((sum, k) => sum + k.count, 0)).toBe(needAttention);
    expect(needAttention).toBe(57);
    expect(kinds[2]?.href).toBe('#/alerts?kind=overdue');
  });

  it('info alerts have no kind; over capacity is its own kind', () => {
    const snap = seed42();
    for (const a of snap.alerts.filter((x) => x.severity === 'info')) expect(kindOf(a)).toBeNull();
    expect(kindOf({ id: 'x', type: 'invalid_data', severity: 'warning', title: '', message: '', entity: { kind: 'warehouse', id: 'WH-DFW', label: '' } })).toBe('over_capacity');
    expect(kindOf({ id: 'x', type: 'invalid_data', severity: 'warning', title: '', message: '', entity: { kind: 'shipment', id: 'S', label: '' } })).toBe('records');
  });
});

describe('money: short before restock, at unit cost', () => {
  it('is (usage × lead time − on hand) × unit cost, zero when stock lasts until a reorder arrives, null without usage', () => {
    const [low, enough, none] = makeSnapshot(
      [
        makeInventoryRecord({ quantity: 437, reorderPoint: 729, avgDailyUsage: 34.7, leadTimeDays: 21, unitCostCents: 56_639 }),
        makeInventoryRecord({ quantity: 100, reorderPoint: 120, avgDailyUsage: 5, leadTimeDays: 14 }),
        makeInventoryRecord({ quantity: 0, avgDailyUsage: null })
      ],
      []
    ).inventory;
    expect(shortBeforeRestockCents(low!)).toBe(Math.round((34.7 * 21 - 437) * 56_639));
    expect(shortBeforeRestockCents(enough!)).toBe(0); // 5 × 14 = 70 ≤ 100 on hand
    expect(shortBeforeRestockCents(none!)).toBeNull();
  });
});

describe('move or reorder (adjustment 1)', () => {
  const inv = (records: Parameters<typeof makeInventoryRecord>[0][]) => makeSnapshot(records.map((r) => makeInventoryRecord(r)), []);

  it('moves when another warehouse can spare exactly the need, so it lands on its own reorder point', () => {
    const snap = inv([
      { sku: 'ABC-1', warehouse: 'WH-ORD', quantity: 0, reorderPoint: 100 },
      { sku: 'ABC-1', warehouse: 'WH-ATL', quantity: 150, reorderPoint: 50 } // spare 100 = need 100
    ]);
    expect(stockAction(snap.inventory[0]!, snap.inventory, snap.locations)).toBe('Move 100 from Atlanta');
  });

  it('reorders when the only other warehouse is short of the need by one unit (it would fall below its reorder point)', () => {
    const snap = inv([
      { sku: 'ABC-1', warehouse: 'WH-ORD', quantity: 0, reorderPoint: 100 },
      { sku: 'ABC-1', warehouse: 'WH-ATL', quantity: 149, reorderPoint: 50 } // spare 99 < need 100
    ]);
    expect(stockAction(snap.inventory[0]!, snap.inventory, snap.locations)).toBe('Reorder 100');
  });

  it('with several warehouses able to spare it: the largest spare; equal spare: the warehouse code A→Z', () => {
    const largest = inv([
      { sku: 'ABC-1', warehouse: 'WH-ORD', quantity: 10, reorderPoint: 60 }, // need 50
      { sku: 'ABC-1', warehouse: 'WH-ATL', quantity: 120, reorderPoint: 20 }, // spare 100
      { sku: 'ABC-1', warehouse: 'WH-DFW', quantity: 300, reorderPoint: 20 }, // spare 280
      { sku: 'ABC-1', warehouse: 'WH-LAX', quantity: 60, reorderPoint: 20 } // spare 40 < 50
    ]);
    expect(stockAction(largest.inventory[0]!, largest.inventory, largest.locations)).toBe('Move 50 from Dallas-Fort Worth');
    const equal = inv([
      { sku: 'ABC-1', warehouse: 'WH-ORD', quantity: 10, reorderPoint: 60 },
      { sku: 'ABC-1', warehouse: 'WH-LAX', quantity: 120, reorderPoint: 20 }, // spare 100
      { sku: 'ABC-1', warehouse: 'WH-ATL', quantity: 120, reorderPoint: 20 } // spare 100: WH-ATL < WH-LAX
    ]);
    expect(stockAction(equal.inventory[0]!, equal.inventory, equal.locations)).toBe('Move 50 from Atlanta');
  });

  it('only the same SKU counts, and "Reorder now" when on hand equals the reorder point', () => {
    const snap = inv([
      { sku: 'ABC-1', warehouse: 'WH-ORD', quantity: 20, reorderPoint: 20 },
      { sku: 'XYZ-9', warehouse: 'WH-ATL', quantity: 900, reorderPoint: 20 }
    ]);
    expect(stockAction(snap.inventory[0]!, snap.inventory, snap.locations)).toBe('Reorder now');
  });
});

describe('the queue', () => {
  it('seed 42: the five rows, their numbers and their links', () => {
    const rows = buildQueue(seed42());
    expect(rows.map((r) => [r.tone, r.what, r.damage, r.action])).toEqual([
      ['warning', 'Compact Docking Station runs out in Chicago in 12 days', '$165.2K short before restock', 'Move 292 from Atlanta'],
      ['critical', 'Compact Webcam is out of stock in Newark', '$118.6K short before restock', 'Move 269 from Dallas-Fort Worth'],
      ['critical', 'Rugged Barcode Scanner is out of stock in Chicago', '$91.8K short before restock', 'Move 220 from Newark'],
      ['critical', 'Cascade Carriers billed $25.3K above typical on 4 shipments', null, 'Check the invoices'],
      ['critical', 'Cascade Carriers has 4 shipments 7 to 20 days late', null, 'Ask for new dates']
    ]);
    expect(rows.map((r) => r.href)).toEqual([
      '#/inventory?q=ELC-0014&warehouse=WH-ORD',
      '#/inventory?q=ELC-0008&warehouse=WH-EWR',
      '#/inventory?q=ELC-0001&warehouse=WH-ORD',
      '#/shipments?carrier=Cascade+Carriers&flag=cost_anomaly',
      '#/shipments?carrier=Cascade+Carriers&flag=delayed'
    ]);
  });

  it('keeps at most 3 stock rows while other rows exist; the 4th-largest stock damage gives way to a smaller carrier row', () => {
    const snap = seed42();
    const rows = buildQueue(snap);
    expect(rows.filter((r) => r.key.startsWith('stock:'))).toHaveLength(MAX_STOCK_ROWS);
    expect(rows.some((r) => r.what.startsWith('Professional Spice Rack'))).toBe(false); // $66.5K, 4th stock row, out
  });

  it('lets the stock cap give way when nothing else is left', () => {
    const snap = makeSnapshot(
      Array.from({ length: 6 }, (_, i) => makeInventoryRecord({ sku: `CAP-${i + 1}`, quantity: 0, reorderPoint: 10, avgDailyUsage: 1, leadTimeDays: 10, unitCostCents: 1000 * (i + 1) })),
      []
    );
    const rows = buildQueue(snap);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.key)).toEqual(['stock:CAP-6@WH-DFW', 'stock:CAP-5@WH-DFW', 'stock:CAP-4@WH-DFW', 'stock:CAP-3@WH-DFW', 'stock:CAP-2@WH-DFW']);
  });

  it('breaks ties by severity, then fewer days of supply, then id A→Z (numeric-aware)', () => {
    // all short by 10 units × $10 = $100: out of stock first; then the low items by days of supply; then by id
    const snap = makeSnapshot(
      [
        makeInventoryRecord({ sku: 'TIE-10', quantity: 10, reorderPoint: 30, avgDailyUsage: 2, leadTimeDays: 10, unitCostCents: 1000 }), // dos 5
        makeInventoryRecord({ sku: 'TIE-2', quantity: 10, reorderPoint: 30, avgDailyUsage: 2, leadTimeDays: 10, unitCostCents: 1000 }), // dos 5
        makeInventoryRecord({ sku: 'TIE-1', quantity: 15, reorderPoint: 30, avgDailyUsage: 5, leadTimeDays: 5, unitCostCents: 1000 }), // dos 3
        makeInventoryRecord({ sku: 'TIE-9', quantity: 0, reorderPoint: 30, avgDailyUsage: 1, leadTimeDays: 10, unitCostCents: 1000 }) // out
      ],
      []
    );
    expect(buildQueue(snap).map((r) => r.key)).toEqual(['stock:TIE-9@WH-DFW', 'stock:TIE-1@WH-DFW', 'stock:TIE-2@WH-DFW', 'stock:TIE-10@WH-DFW']);
  });

  it('groups unusual costs by carrier: the excess is summed, one shipment is named, critical when any is 3× typical', () => {
    const b = base();
    const snap = withShipments(makeSnapshot([], []), [
      anomaly(b, 'Alpha Freight', 30_000, 10_000, 'SHP-1'), // +$200, 3× → critical
      anomaly(b, 'Alpha Freight', 25_000, 10_000, 'SHP-2'), // +$150
      anomaly(b, 'Beta Lines', 20_000, 10_000, 'SHP-3') // +$100, 2× → warning
    ]);
    expect(buildQueue(snap).map((r) => [r.tone, r.what, r.action])).toEqual([
      ['critical', 'Alpha Freight billed $350.00 above typical on 2 shipments', 'Check the invoices'],
      ['warning', 'Beta Lines billed $100.00 above typical on SHP-3', 'Check the invoice']
    ]);
  });

  it('equal carrier totals: more shipments first, then the carrier name A→Z', () => {
    const b = base();
    const snap = withShipments(makeSnapshot([], []), [
      anomaly(b, 'Zed', 20_000, 10_000, 'SHP-1'),
      anomaly(b, 'Yon', 15_000, 10_000, 'SHP-2'),
      anomaly(b, 'Yon', 15_000, 10_000, 'SHP-3'),
      anomaly(b, 'Abe', 20_000, 10_000, 'SHP-4')
    ]);
    expect(buildQueue(snap).map((r) => r.key)).toEqual(['billing:Yon', 'billing:Abe', 'billing:Zed']);
  });

  it('puts the carrier with the most shipments 7+ days late in the last row; ties: oldest, then name; under 7 days never', () => {
    const b = base();
    const stock = makeSnapshot(Array.from({ length: 6 }, (_, i) => makeInventoryRecord({ sku: `S-${i}`, quantity: 0, reorderPoint: 10 })), []);
    const snap = withShipments(stock, [
      overdue(b, 'Ann Co', 9, 'SHP-1'),
      overdue(b, 'Ann Co', 8, 'SHP-2'),
      overdue(b, 'Bob Co', 20, 'SHP-3'),
      overdue(b, 'Bob Co', 7, 'SHP-4'),
      overdue(b, 'Cid Co', 6, 'SHP-5'),
      overdue(b, 'Cid Co', 6, 'SHP-6'),
      overdue(b, 'Cid Co', 6, 'SHP-7')
    ]);
    const rows = buildQueue(snap);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toMatchObject({ key: 'late:Bob Co', what: 'Bob Co has 2 shipments 7 to 20 days late', action: 'Ask for new dates', tone: 'critical' });
    const single = buildQueue(withShipments(makeSnapshot([], []), [overdue(b, 'Dee Co', 9, 'SHP-9')]));
    expect(single.map((r) => [r.what, r.action])).toEqual([['Dee Co: SHP-9 is 9 days late', 'Ask for a new date']]);
    expect(buildQueue(withShipments(makeSnapshot([], []), [overdue(b, 'Cid Co', 6, 'SHP-5')]))).toEqual([]);
  });

  it('fills a free row with an out-of-stock item without usage data, before the late row', () => {
    const b = base();
    const snap = withShipments(makeSnapshot([makeInventoryRecord({ sku: 'NOU-1', productName: 'Mystery Part', quantity: 0, reorderPoint: 40, avgDailyUsage: null })], []), [overdue(b, 'Ann Co', 9, 'SHP-1')]);
    expect(buildQueue(snap).map((r) => [r.what, r.damage, r.action])).toEqual([
      ['Mystery Part is out of stock in Dallas-Fort Worth', 'usage unknown', 'Reorder 40'],
      ['Ann Co: SHP-1 is 9 days late', null, 'Ask for a new date']
    ]);
  });

  it('is empty when nothing needs action', () => {
    expect(buildQueue(makeSnapshot([makeInventoryRecord()], [makeShipmentRecord()]))).toEqual([]);
  });
});
