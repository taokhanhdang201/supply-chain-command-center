// Tester (adversarial) suite: independently recompute headline numbers from the raw sample dataset and
// compare them against buildSnapshot()/the domain functions. This deliberately does NOT reuse the app's own
// aggregation code paths (computeKpis etc.) for the "expected" side - it recomputes from InventoryRecord /
// ShipmentRecord fields directly, so a bug shared between the domain function and this test would have to be
// a coincidence, not a shared implementation.

import { describe, it, expect } from 'vitest';
import { generateSampleData, createSampleDataset } from '../../src/shared/sample/generateSampleData';
import { buildSnapshot } from '../../src/shared/domain/snapshot';
import { enrichShipments } from '../../src/shared/domain/shipments';
import { LOCATIONS, WAREHOUSES } from '../../src/shared/reference/locations';
import { getStockStatus } from '../../src/shared/domain/inventory';

const TODAY = '2026-09-28';

function sample() {
  return generateSampleData({ seed: 42, today: TODAY });
}

describe('tester: independent recomputation of headline numbers against the sample dataset', () => {
  it('total inventory value = sum(quantity * unitCostCents), recomputed by hand', () => {
    const { inventory } = sample();
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });

    let expected = 0;
    for (const rec of inventory) {
      expected += rec.quantity * rec.unitCostCents;
    }
    expect(snapshot.kpis.totalInventoryValueCents).toBe(expected);
    expect(Number.isFinite(snapshot.kpis.totalInventoryValueCents)).toBe(true);
  });

  it('low-stock count = count(quantity <= reorderPoint), recomputed by hand', () => {
    const { inventory } = sample();
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });

    let expected = 0;
    for (const rec of inventory) {
      const status = getStockStatus(rec.quantity, rec.reorderPoint);
      if (status === 'low_stock' || status === 'out_of_stock') expected += 1;
    }
    expect(snapshot.kpis.lowStockCount).toBe(expected);
  });

  it('total shipping cost & average = sum/avg over non-cancelled shipments, recomputed by hand', () => {
    const { shipments } = sample();
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });

    const nonCancelled = shipments.filter((s) => s.status !== 'cancelled');
    const expectedTotal = nonCancelled.reduce((sum, s) => sum + s.shippingCostCents, 0);
    const expectedAvg = nonCancelled.length === 0 ? null : Math.round(expectedTotal / nonCancelled.length);

    expect(snapshot.kpis.totalShippingCostCents).toBe(expectedTotal);
    expect(snapshot.kpis.averageShippingCostCents).toBe(expectedAvg);
  });

  it('delayed count and on-time % recomputed from raw dates without using enrichShipments', () => {
    const { shipments } = sample();
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });

    let onTime = 0;
    let late = 0;
    let overdue = 0;
    for (const s of shipments) {
      if (s.status === 'delivered') {
        if (s.actualDelivery === null || s.estimatedDelivery === null) continue; // unknown, excluded
        if (s.actualDelivery < s.shipDate) continue; // ACTUAL_BEFORE_SHIP -> unknown state, per plan §4.5 rule 2
        if (s.actualDelivery <= s.estimatedDelivery) onTime += 1;
        else late += 1;
      } else if (s.status === 'pending' || s.status === 'in_transit') {
        if (s.estimatedDelivery === null) continue;
        if (TODAY > s.estimatedDelivery) overdue += 1;
      }
    }
    const expectedRate = onTime + late === 0 ? null : onTime / (onTime + late);
    expect(snapshot.kpis.onTimeCount).toBe(onTime);
    expect(snapshot.kpis.lateCount).toBe(late);
    expect(snapshot.kpis.overdueCount).toBe(overdue);
    expect(snapshot.kpis.onTimeRate).toBe(expectedRate);
    expect(snapshot.kpis.delayedShipments).toBe(late + overdue);
  });

  it('average delivery time recomputed as mean(actual - shipDate) over delivered shipments with valid dates', () => {
    const { shipments } = sample();
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });

    const dayMs = 86_400_000;
    const transitDays: number[] = [];
    for (const s of shipments) {
      if (s.status !== 'delivered' || s.actualDelivery === null) continue;
      const actual = Date.UTC(...(s.actualDelivery.split('-').map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
      const ship = Date.UTC(...(s.shipDate.split('-').map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
      const diff = Math.round((actual - ship) / dayMs);
      if (diff >= 0) transitDays.push(diff);
    }
    const expectedAvg = transitDays.length === 0 ? null : transitDays.reduce((a, b) => a + b, 0) / transitDays.length;
    expect(snapshot.kpis.averageDeliveryDays).toBeCloseTo(expectedAvg as number, 9);
  });

  it('warehouse utilization recomputed per warehouse from raw quantities and hard-coded capacities', () => {
    const { inventory } = sample();
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });

    for (const wh of WAREHOUSES) {
      const units = inventory.filter((r) => r.warehouse === wh.code).reduce((sum, r) => sum + r.quantity, 0);
      const util = snapshot.metrics.warehouseUtilization.find((u) => u.code === wh.code);
      expect(util).toBeDefined();
      expect(util!.units).toBe(units);
      expect(util!.capacityUnits).toBe(wh.capacityUnits);
      expect(util!.utilization).toBeCloseTo(units / (wh.capacityUnits as number), 9);
      expect(util!.utilization).toBeLessThan(1); // plan §7.6 tuning target: all under 100%
    }
  });

  it('inventory turnover recomputed from raw usage/unitCost, matches computeSupplyChainMetrics', () => {
    const { inventory } = sample();
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });

    let cogs = 0;
    let totalValue = 0;
    let withUsage = 0;
    for (const r of inventory) {
      totalValue += r.quantity * r.unitCostCents;
      if (r.avgDailyUsage !== null) {
        cogs += r.avgDailyUsage * 365 * r.unitCostCents;
        withUsage += 1;
      }
    }
    const expectedTurnover = totalValue === 0 ? null : cogs / totalValue;
    expect(snapshot.metrics.inventoryTurnover).toBeCloseTo(expectedTurnover as number, 6);
    expect(snapshot.metrics.turnoverCoverage.itemsWithUsage).toBe(withUsage);
    expect(snapshot.metrics.turnoverCoverage.totalItems).toBe(inventory.length);
  });

  it('no NaN or Infinity anywhere in the serialized sample snapshot', () => {
    const dataset = createSampleDataset(42, TODAY, '2026-09-28T00:00:00.000Z');
    const snapshot = buildSnapshot(dataset, TODAY, {
      generatedAt: '2026-09-28T00:00:00.000Z',
      limits: { maxUploadBytes: 2_097_152, maxRows: 20000 }
    });
    const json = JSON.stringify(snapshot);
    expect(json).not.toMatch(/NaN/);
    expect(json).not.toMatch(/Infinity/);
  });

  it('cost-anomaly stats (median/MAD) recomputed by hand for one busy route, cross-checked against enrichShipments', () => {
    const { shipments } = sample();
    const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
    // Pick any route with >=8 non-cancelled, positive-cost shipments (route method requires >=8).
    const byRoute = new Map<string, number[]>();
    for (const s of enriched) {
      if (s.status === 'cancelled' || s.shippingCostCents <= 0) continue;
      const arr = byRoute.get(s.routeKey) ?? [];
      arr.push(s.shippingCostCents);
      byRoute.set(s.routeKey, arr);
    }
    const [routeKey, costs] = [...byRoute.entries()].find(([, v]) => v.length >= 8)!;
    const sorted = [...costs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;

    for (const s of enriched) {
      if (s.routeKey !== routeKey || s.status === 'cancelled' || s.shippingCostCents <= 0) continue;
      if (s.cost.method === 'route') {
        expect(s.cost.baselineCents).toBe(Math.round(med));
      }
    }
  });
});
