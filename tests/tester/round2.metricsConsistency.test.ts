// Round-2 independent verification of R-13 (warehouse utilization must be null, not 0, when capacityUnits is 0)
// and R-14 (Dashboard "Alerts needing attention" KPI must be internally consistent with the Alerts page's full
// count). Calls computeWarehouseUtilization directly with a synthetic zero-capacity warehouse (not reachable
// through the current reference location list) rather than re-testing through the
// UI meter component, and independently recomputes the KPI/alert-count relationship from raw snapshot data.

import { describe, it, expect } from 'vitest';
import { computeWarehouseUtilization } from '../../src/shared/domain/metrics';
import { enrichInventory } from '../../src/shared/domain/inventory';
import { makeInventoryRecord, makeShipmentRecord, makeSnapshot, TODAY } from '../helpers/fixtures';
import type { Location } from '../../src/shared/types';

describe('R-13 regression (round 2, independent): zero-capacity warehouse utilization', () => {
  const ZERO_CAP_LOCATIONS: Location[] = [
    { code: 'WH-ZERO', name: 'Zero-Capacity DC', kind: 'warehouse', lat: 0, lon: 0, capacityUnits: 0 },
    { code: 'WH-NORMAL', name: 'Normal DC', kind: 'warehouse', lat: 1, lon: 1, capacityUnits: 1000 }
  ];

  it('returns utilization: null (not 0) for a warehouse with capacityUnits 0, even when units are stored there', () => {
    const inventory = enrichInventory([
      makeInventoryRecord({ warehouse: 'WH-ZERO', quantity: 50, unitCostCents: 100 }),
      makeInventoryRecord({ warehouse: 'WH-NORMAL', quantity: 500, unitCostCents: 100 })
    ]);
    const result = computeWarehouseUtilization(inventory, ZERO_CAP_LOCATIONS);
    const zero = result.find((w) => w.code === 'WH-ZERO')!;
    const normal = result.find((w) => w.code === 'WH-NORMAL')!;

    expect(zero.utilization).toBeNull();
    expect(zero.units).toBe(50); // units stored are still reported accurately, just not divided by 0
    expect(zero.capacityUnits).toBe(0);
    expect(normal.utilization).toBe(0.5); // sanity: the normal warehouse's math is unaffected
  });

  it('a zero-capacity warehouse with zero units also correctly reports null (not NaN, not 0/0=0)', () => {
    const inventory = enrichInventory([makeInventoryRecord({ warehouse: 'WH-NORMAL', quantity: 10, unitCostCents: 100 })]);
    const result = computeWarehouseUtilization(inventory, ZERO_CAP_LOCATIONS);
    const zero = result.find((w) => w.code === 'WH-ZERO')!;
    expect(zero.utilization).toBeNull();
    expect(Number.isNaN(zero.utilization)).toBe(false);
    expect(zero.units).toBe(0);
  });
});

describe('R-14 regression (round 2, independent): Dashboard KPI consistency', () => {
  it('"Alerts needing attention" (critical+warning) plus info-severity alerts always sums to the full alert count', () => {
    // Independently recomputes the relationship the Dashboard KPI's detail line documents, from raw snapshot
    // alert rows, rather than rendering the component and reading its text.
    const inventory = [
      makeInventoryRecord({ quantity: 0 }), // out_of_stock -> critical low_stock alert
      makeInventoryRecord({ quantity: 5, reorderPoint: 20 }), // low_stock -> warning alert
      makeInventoryRecord({ avgDailyUsage: null }) // missing usage -> info-severity missing_info alert
    ];
    const shipments = [makeShipmentRecord()];
    const snapshot = makeSnapshot(inventory, shipments, { today: TODAY });

    const critical = snapshot.alerts.filter((a) => a.severity === 'critical').length;
    const warning = snapshot.alerts.filter((a) => a.severity === 'warning').length;
    const info = snapshot.alerts.filter((a) => a.severity === 'info').length;
    const needingAttention = critical + warning;

    expect(needingAttention + info).toBe(snapshot.alerts.length);
    expect(info).toBeGreaterThan(0); // sanity: this fixture actually has an info-severity alert to sum
    expect(needingAttention).toBeGreaterThan(0);
  });

  it('an all-info-severity alert set makes "needing attention" 0 while the full count is still positive (no silent miscount)', () => {
    const inventory = [makeInventoryRecord({ avgDailyUsage: null })]; // only produces an info-severity alert
    const snapshot = makeSnapshot(inventory, [], { today: TODAY });
    const needingAttention = snapshot.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
    expect(needingAttention).toBe(0);
    expect(snapshot.alerts.length).toBeGreaterThan(0);
  });

  it('an empty dataset yields 0 alerts and a consistent (0 needing-attention, 0 total) pair, not a crash', () => {
    const snapshot = makeSnapshot([], [], { today: TODAY });
    expect(snapshot.alerts).toHaveLength(0);
    const needingAttention = snapshot.alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
    expect(needingAttention).toBe(0);
  });
});
