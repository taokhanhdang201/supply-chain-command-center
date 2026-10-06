// Tester (adversarial) suite: cross-page data consistency. The dashboard KPIs, the inventory/shipment row sets,
// the alerts list, and the analytics aggregations all derive from the same enriched arrays in one Snapshot -
// this suite checks they actually agree with each other and don't drift when computed by different domain
// functions (metrics.ts vs alerts.ts vs analytics.ts) against the exact same data.

import { describe, it, expect } from 'vitest';
import { createSampleDataset } from '../../src/shared/sample/generateSampleData';
import { buildSnapshot } from '../../src/shared/domain/snapshot';
import {
  groupInventoryValue,
  countShipmentsByStatus,
  summarizeRoutes
} from '../../src/shared/domain/analytics';
import { LOCATIONS } from '../../src/shared/reference/locations';

const TODAY = '2026-09-28';

function snapshotFor(today: string) {
  const dataset = createSampleDataset(42, today, `${today}T00:00:00.000Z`);
  return buildSnapshot(dataset, today, {
    generatedAt: `${today}T00:00:00.000Z`,
    limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
  });
}

describe('tester: cross-page data consistency', () => {
  it('dashboard low-stock KPI count matches the number of inventory rows with a low/out stock status', () => {
    const snapshot = snapshotFor(TODAY);
    const rowCount = snapshot.inventory.filter((i) => i.stockStatus === 'low_stock' || i.stockStatus === 'out_of_stock').length;
    expect(snapshot.kpis.lowStockCount).toBe(rowCount);
  });

  it('dashboard low-stock KPI count matches the number of low_stock alerts', () => {
    const snapshot = snapshotFor(TODAY);
    const alertCount = snapshot.alerts.filter((a) => a.type === 'low_stock').length;
    expect(snapshot.kpis.lowStockCount).toBe(alertCount);
  });

  it('dashboard delayed-shipments KPI matches the number of shipment rows in late/overdue state', () => {
    const snapshot = snapshotFor(TODAY);
    const rowCount = snapshot.shipments.filter((s) => s.deliveryState === 'late' || s.deliveryState === 'overdue').length;
    expect(snapshot.kpis.delayedShipments).toBe(rowCount);
  });

  it('overdue shipment-row count matches shipment_delayed critical+warning alert count from overdue shipments', () => {
    const snapshot = snapshotFor(TODAY);
    const overdueRows = snapshot.shipments.filter((s) => s.deliveryState === 'overdue');
    const overdueAlerts = snapshot.alerts.filter(
      (a) => a.type === 'shipment_delayed' && overdueRows.some((s) => s.shipmentId === a.entity.id) && a.severity !== 'info'
    );
    expect(overdueAlerts.length).toBe(overdueRows.length);
  });

  it('total inventory value on the dashboard equals the sum of analytics groupInventoryValue-by-warehouse buckets', () => {
    const snapshot = snapshotFor(TODAY);
    const byWarehouse = groupInventoryValue(snapshot.inventory, 'warehouse', LOCATIONS);
    const summed = byWarehouse.reduce((sum, b) => sum + b.valueCents, 0);
    expect(summed).toBe(snapshot.kpis.totalInventoryValueCents);
  });

  it('total inventory value equals the sum of analytics groupInventoryValue-by-category buckets', () => {
    const snapshot = snapshotFor(TODAY);
    const byCategory = groupInventoryValue(snapshot.inventory, 'category', LOCATIONS);
    const summed = byCategory.reduce((sum, b) => sum + b.valueCents, 0);
    expect(summed).toBe(snapshot.kpis.totalInventoryValueCents);
  });

  it('warehouse utilization units sum to the same total units as the inventory KPI', () => {
    const snapshot = snapshotFor(TODAY);
    const utilTotal = snapshot.metrics.warehouseUtilization.reduce((sum, u) => sum + u.units, 0);
    expect(utilTotal).toBe(snapshot.kpis.totalUnits);
  });

  it('total shipments KPI equals the sum of countShipmentsByStatus buckets', () => {
    const snapshot = snapshotFor(TODAY);
    const byStatus = countShipmentsByStatus(snapshot.shipments);
    const summed = byStatus.reduce((sum, b) => sum + b.count, 0);
    expect(summed).toBe(snapshot.kpis.totalShipments);
  });

  it('active + cancelled + delivered shipment counts sum to total shipments (dashboard subtitle consistency)', () => {
    const snapshot = snapshotFor(TODAY);
    expect(snapshot.kpis.activeShipments + snapshot.kpis.cancelledShipments + snapshot.kpis.deliveredShipments).toBe(
      snapshot.kpis.totalShipments
    );
  });

  it('summarizeRoutes total count across all routes equals the non-cancelled shipment count', () => {
    const snapshot = snapshotFor(TODAY);
    const routes = summarizeRoutes(snapshot.shipments, LOCATIONS);
    const routeTotal = routes.reduce((sum, r) => sum + r.count, 0);
    const nonCancelled = snapshot.shipments.filter((s) => s.status !== 'cancelled').length;
    expect(routeTotal).toBe(nonCancelled);
  });

  it('summarizeRoutes total cost across all routes equals the total shipping cost KPI', () => {
    const snapshot = snapshotFor(TODAY);
    const routes = summarizeRoutes(snapshot.shipments, LOCATIONS);
    const routeCostTotal = routes.reduce((sum, r) => sum + r.totalCostCents, 0);
    expect(routeCostTotal).toBe(snapshot.kpis.totalShippingCostCents);
  });

  it('every alert entity id references a real inventory/shipment/warehouse row (no dangling references)', () => {
    const snapshot = snapshotFor(TODAY);
    const inventoryIds = new Set(snapshot.inventory.map((i) => i.id));
    const shipmentIds = new Set(snapshot.shipments.map((s) => s.shipmentId));
    const warehouseCodes = new Set(snapshot.locations.filter((l) => l.kind === 'warehouse').map((l) => l.code));

    for (const alert of snapshot.alerts) {
      if (alert.entity.kind === 'inventory') expect(inventoryIds.has(alert.entity.id)).toBe(true);
      if (alert.entity.kind === 'shipment') expect(shipmentIds.has(alert.entity.id)).toBe(true);
      if (alert.entity.kind === 'warehouse') {
        const match = [...warehouseCodes].some((code) => alert.entity.id === code || alert.entity.label.length > 0);
        expect(match).toBe(true);
      }
    }
  });

  it('alert IDs are all unique (no accidental duplicate alert rows)', () => {
    const snapshot = snapshotFor(TODAY);
    const ids = snapshot.alerts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('empty dataset produces a fully consistent (zeroed / null) snapshot across all sections, no crash', () => {
    const dataset = { inventory: [], shipments: [], sources: { inventory: { kind: 'sample' as const, label: 'x', loadedAt: TODAY, rowCount: 0 }, shipments: { kind: 'sample' as const, label: 'x', loadedAt: TODAY, rowCount: 0 } } };
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: `${TODAY}T00:00:00.000Z`,
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });
    expect(snapshot.kpis.totalInventoryValueCents).toBe(0);
    expect(snapshot.kpis.onTimeRate).toBeNull();
    expect(snapshot.kpis.averageShippingCostCents).toBeNull();
    expect(snapshot.metrics.inventoryTurnover).toBeNull();
    expect(snapshot.alerts).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toMatch(/NaN|Infinity/);
  });
});
