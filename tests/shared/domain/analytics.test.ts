import { describe, it, expect } from 'vitest';
import {
  filterShipmentsByRange,
  groupInventoryValue,
  countShipmentsByStatus,
  shippingCostByMonth,
  onTimeVsDelayedByMonth,
  summarizeRoutes,
  topRoutes,
  recentActivity
} from '../../../src/shared/domain/analytics';
import { enrichInventory } from '../../../src/shared/domain/inventory';
import { enrichShipments } from '../../../src/shared/domain/shipments';
import { LOCATIONS } from '../../../src/shared/reference/locations';
import { makeInventoryRecord, makeShipmentRecord, TODAY } from '../../helpers/fixtures';

describe('filterShipmentsByRange', () => {
  it("'all' keeps everything", () => {
    const shipments = enrichShipments([makeShipmentRecord({ shipDate: '2020-01-01' })], TODAY, LOCATIONS);
    expect(filterShipmentsByRange(shipments, 'all', TODAY)).toHaveLength(1);
  });

  it('keeps a shipment exactly at the cutoff boundary', () => {
    const shipments = enrichShipments([makeShipmentRecord({ shipDate: '2026-05-16' })], TODAY, LOCATIONS); // 30 days before TODAY
    expect(filterShipmentsByRange(shipments, '30d', TODAY)).toHaveLength(1);
  });

  it('excludes a shipment just before the cutoff', () => {
    const shipments = enrichShipments([makeShipmentRecord({ shipDate: '2026-05-15' })], TODAY, LOCATIONS); // 31 days before TODAY
    expect(filterShipmentsByRange(shipments, '30d', TODAY)).toHaveLength(0);
  });

  it('keeps future-dated pending shipments', () => {
    const shipments = enrichShipments(
      [makeShipmentRecord({ status: 'pending', shipDate: '2026-07-01', estimatedDelivery: '2026-07-10', actualDelivery: null })],
      TODAY,
      LOCATIONS
    );
    expect(filterShipmentsByRange(shipments, '30d', TODAY)).toHaveLength(1);
  });
});

describe('groupInventoryValue', () => {
  it('groups by warehouse, sorted by value desc then key asc', () => {
    const items = enrichInventory([
      makeInventoryRecord({ warehouse: 'WH-ATL', quantity: 1, unitCostCents: 100 }),
      makeInventoryRecord({ warehouse: 'WH-DFW', quantity: 10, unitCostCents: 100 })
    ]);
    const groups = groupInventoryValue(items, 'warehouse', LOCATIONS);
    expect(groups[0]?.key).toBe('WH-DFW');
    expect(groups[0]?.label).toBe('Dallas-Fort Worth DC');
  });

  it('groups by category', () => {
    const items = enrichInventory([
      makeInventoryRecord({ category: 'Electronics' }),
      makeInventoryRecord({ category: 'Electronics' }),
      makeInventoryRecord({ category: 'Packaging' })
    ]);
    const groups = groupInventoryValue(items, 'category', LOCATIONS);
    expect(groups.find((g) => g.key === 'Electronics')?.recordCount).toBe(2);
  });
});

describe('countShipmentsByStatus', () => {
  it('includes zero counts for missing statuses in a fixed order', () => {
    const shipments = enrichShipments([makeShipmentRecord({ status: 'delivered' })], TODAY, LOCATIONS);
    const counts = countShipmentsByStatus(shipments);
    expect(counts.map((c) => c.status)).toEqual(['pending', 'in_transit', 'delivered', 'cancelled']);
    expect(counts.find((c) => c.status === 'pending')?.count).toBe(0);
    expect(counts.find((c) => c.status === 'delivered')?.count).toBe(1);
  });
});

describe('shippingCostByMonth', () => {
  it('gap-fills months with 0 and excludes cancelled shipments', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ shipDate: '2026-01-15', shippingCostCents: 1000 }),
        makeShipmentRecord({ shipDate: '2026-03-15', shippingCostCents: 2000 }),
        makeShipmentRecord({ status: 'cancelled', shipDate: '2026-02-15', actualDelivery: null, shippingCostCents: 9999 })
      ],
      TODAY,
      LOCATIONS
    );
    const result = shippingCostByMonth(shipments, TODAY);
    expect(result.map((r) => r.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(result.find((r) => r.month === '2026-02')?.totalCents).toBe(0);
    expect(result.find((r) => r.month === '2026-01')?.totalCents).toBe(1000);
  });

  it('is empty for no shipments', () => {
    expect(shippingCostByMonth([], TODAY)).toEqual([]);
  });

  it('excludes shipments dated after today and never emits a month beyond today (R-4)', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ shipDate: '2026-06-01', shippingCostCents: 1000 }),
        makeShipmentRecord({
          status: 'pending',
          shipDate: '2026-07-05',
          estimatedDelivery: '2026-07-15',
          actualDelivery: null,
          shippingCostCents: 6447
        })
      ],
      TODAY,
      LOCATIONS
    );
    const result = shippingCostByMonth(shipments, TODAY);
    expect(result.map((r) => r.month)).toEqual(['2026-06']);
    expect(result.every((r) => r.month <= TODAY.slice(0, 7))).toBe(true);
  });
});

describe('onTimeVsDelayedByMonth', () => {
  it('groups by month of estimated delivery', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ shipDate: '2026-01-01', status: 'delivered', estimatedDelivery: '2026-01-10', actualDelivery: '2026-01-10' }),
        makeShipmentRecord({ shipDate: '2026-01-01', status: 'delivered', estimatedDelivery: '2026-01-10', actualDelivery: '2026-01-15' })
      ],
      TODAY,
      LOCATIONS
    );
    const result = onTimeVsDelayedByMonth(shipments);
    expect(result).toEqual([{ month: '2026-01', onTime: 1, delayed: 1 }]);
  });

  it('is empty for no eligible shipments', () => {
    expect(onTimeVsDelayedByMonth([])).toEqual([]);
  });
});

describe('summarizeRoutes', () => {
  it('computes count, delayedShare and mapped flag', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ origin: 'WH-DFW', destination: 'HOU', shippingCostCents: 1000 }),
        makeShipmentRecord({
          origin: 'WH-DFW',
          destination: 'HOU',
          status: 'in_transit',
          estimatedDelivery: '2026-06-01',
          actualDelivery: null,
          shippingCostCents: 2000
        })
      ],
      TODAY,
      LOCATIONS
    );
    const [route] = summarizeRoutes(shipments, LOCATIONS);
    expect(route?.count).toBe(2);
    expect(route?.mapped).toBe(true);
    expect(route?.delayedShare).toBe(0.5);
  });

  it('marks unmapped routes', () => {
    const shipments = enrichShipments([makeShipmentRecord({ origin: 'WH-DFW', destination: 'Anchorage, AK' })], TODAY, LOCATIONS);
    expect(summarizeRoutes(shipments, LOCATIONS)[0]?.mapped).toBe(false);
  });
});

describe('topRoutes', () => {
  it('sorts by count vs cost with a routeKey tie-break', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ origin: 'WH-DFW', destination: 'HOU', shippingCostCents: 100000 }),
        makeShipmentRecord({ origin: 'WH-ATL', destination: 'MIA', shippingCostCents: 1000 }),
        makeShipmentRecord({ origin: 'WH-ATL', destination: 'MIA', shippingCostCents: 1000 })
      ],
      TODAY,
      LOCATIONS
    );
    const byCount = topRoutes(shipments, LOCATIONS, 10, 'count');
    expect(byCount[0]?.routeKey).toBe('WH-ATL>MIA');
    const byCost = topRoutes(shipments, LOCATIONS, 10, 'cost');
    expect(byCost[0]?.routeKey).toBe('WH-DFW>HOU');
  });
});

describe('recentActivity', () => {
  it('orders by activity date desc, tie-break by shipmentId asc', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({ shipmentId: 'SHP-000002', status: 'delivered', actualDelivery: '2026-06-10' }),
        makeShipmentRecord({ shipmentId: 'SHP-000001', status: 'delivered', actualDelivery: '2026-06-10' }),
        makeShipmentRecord({ shipmentId: 'SHP-000003', status: 'pending', shipDate: '2026-06-01', estimatedDelivery: '2026-06-20', actualDelivery: null })
      ],
      TODAY,
      LOCATIONS
    );
    const result = recentActivity(shipments, TODAY, 10);
    expect(result.map((s) => s.shipmentId)).toEqual(['SHP-000001', 'SHP-000002', 'SHP-000003']);
  });

  it('never includes a pending shipment whose shipDate is still in the future (R-5)', () => {
    const shipments = enrichShipments(
      [
        makeShipmentRecord({
          shipmentId: 'SHP-000001',
          status: 'pending',
          shipDate: '2026-06-20', // after TODAY (2026-06-15)
          estimatedDelivery: '2026-06-30',
          actualDelivery: null
        }),
        makeShipmentRecord({
          shipmentId: 'SHP-000002',
          status: 'in_transit',
          shipDate: '2026-06-10',
          estimatedDelivery: '2026-06-20',
          actualDelivery: null
        })
      ],
      TODAY,
      LOCATIONS
    );
    const result = recentActivity(shipments, TODAY, 10);
    expect(result.map((s) => s.shipmentId)).toEqual(['SHP-000002']);
  });
});
