// Round-2 independent verification of R-6 (carrier assigned per lane, not per shipment, to remove false
// cost-anomaly positives). Deliberately uses a DIFFERENT path than the coder's own regression test
// (tests/shared/sample/generateSampleData.test.ts): instead of going through buildSnapshot/buildAlerts, this
// computes the cost-anomaly assessment directly from enrichShipments, and independently hand-recomputes the
// low_stock/out_of_stock counts, carrier-per-lane consistency, and other sample-data invariants (record counts,
// statuses, warehouse coverage) that the R-6 generator change must NOT have disturbed.

import { describe, it, expect } from 'vitest';
import { generateSampleData } from '../../src/shared/sample/generateSampleData';
import { enrichShipments } from '../../src/shared/domain/shipments';
import { enrichInventory, getStockStatus } from '../../src/shared/domain/inventory';
import { LOCATIONS, WAREHOUSES } from '../../src/shared/reference/locations';

const TODAY = '2026-09-28'; // matches the "today" the reviewer used to reproduce BUG-1 in danh-gia.md

describe('R-6 regression (round 2, independent path): exact manifest cost anomalies, no others', () => {
  it('flags exactly the 8 manifest cost anomalies via enrichShipments directly (not via buildAlerts)', () => {
    const { shipments, anomalies } = generateSampleData({ seed: 42, today: TODAY });
    const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
    const flagged = enriched.filter((s) => s.cost.isAnomaly).map((s) => s.shipmentId).sort();
    expect(flagged).toEqual([...anomalies.costAnomaly].sort());
  });

  it('every shipment on a given route shares one carrier (the root cause of BUG-1 is actually gone, not masked)', () => {
    // R-6's fix is "assign carrier per lane, not per shipment". Verify that directly: for every origin-
    // destination pair with more than one shipment, all non-anomalous shipments should share the same carrier
    // (the anomaly-injection step may still legitimately alter a manifest shipment's own fields, so we only
    // assert this for the non-manifest bulk of shipments on each lane).
    const { shipments, anomalies } = generateSampleData({ seed: 42, today: TODAY });
    const manifestIds = new Set([
      ...anomalies.costAnomaly,
      ...anomalies.overdue,
      ...anomalies.missingActual,
      ...anomalies.missingEta,
      ...anomalies.actualBeforeShip,
      ...anomalies.openWithActual,
      ...anomalies.zeroCost,
      ...anomalies.sameOriginDestination,
      ...anomalies.unmapped
    ]);
    const byLane = new Map<string, Set<string>>();
    for (const s of shipments) {
      if (manifestIds.has(s.shipmentId)) continue;
      const laneKey = `${s.origin}->${s.destination}`;
      const carriers = byLane.get(laneKey) ?? new Set<string>();
      carriers.add(s.carrier);
      byLane.set(laneKey, carriers);
    }
    let multiCarrierLanes = 0;
    for (const [, carriers] of byLane) {
      if (carriers.size > 1) multiCarrierLanes += 1;
    }
    expect(multiCarrierLanes).toBe(0);
  });

  it('runs clean (no non-manifest cost-anomaly flags) for the shipping seed (42), and for a couple of nearby seeds', () => {
    // The reviewer's own repro, and the shipped app's default SCC_SEED, is 42 -- confirm that stays clean.
    for (const seed of [1, 7, 42, 2026]) {
      const { shipments, anomalies } = generateSampleData({ seed, today: TODAY });
      const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
      const flagged = new Set(enriched.filter((s) => s.cost.isAnomaly).map((s) => s.shipmentId));
      const nonManifestFlagged = [...flagged].filter((id) => !anomalies.costAnomaly.includes(id));
      expect(nonManifestFlagged).toEqual([]);
    }
  });

  it('BUG-4 marker: SCC_SEED=100 (a documented, user-settable seed, README.md:119) still produces a false cost-anomaly flag', () => {
    // README.md documents `SCC_SEED` as a supported env var (default 42) for generating alternate sample
    // datasets. R-6's fix (carrier assigned per lane) removes the *carrier-mixing* false positives the reviewer
    // found on seed 42, but does not address the deeper root cause the reviewer described in R-12 (the cost-
    // anomaly detector's route-only peer grouping) -- which the coder explicitly deferred in thay-doi.md
    // ("R-12 (not done -- explicitly deferred)"). As a result, at least one other legitimately-configurable seed
    // still reproduces the same class of bug as BUG-1: with SCC_SEED=100, shipment SHP-100202 (WH-LAX -> SEA,
    // BlueLine Logistics, $2,326.00 against a $2,077.03 route median) is flagged as a cost anomaly (z=3.69) even
    // though it is not one of that seed's manifest-injected anomalies -- purely from natural random cost
    // variance crossing the z >= 3.5 threshold. Severity: minor (identical class/impact to the original BUG-1;
    // only reachable by an operator who explicitly sets SCC_SEED to a non-default value). Left failing per
    // tester process -- this is evidence for keeping R-12 open, not a new fix to apply here.
    const seed = 100;
    const { shipments, anomalies } = generateSampleData({ seed, today: TODAY });
    const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
    const flagged = new Set(enriched.filter((s) => s.cost.isAnomaly).map((s) => s.shipmentId));
    const nonManifestFlagged = [...flagged].filter((id) => !anomalies.costAnomaly.includes(id));
    expect(nonManifestFlagged).toEqual([]);
  });
});

describe('R-6 regression (round 2): other sample-data properties were not disturbed by the generator change', () => {
  it('still produces exactly 360 inventory records and 480 shipment records', () => {
    const { inventory, shipments } = generateSampleData({ seed: 42, today: TODAY });
    expect(inventory).toHaveLength(360);
    expect(shipments).toHaveLength(480);
  });

  it('still includes every shipment status, and every reference warehouse is represented in inventory', () => {
    const { inventory, shipments } = generateSampleData({ seed: 42, today: TODAY });
    const statuses = new Set(shipments.map((s) => s.status));
    expect(statuses).toEqual(new Set(['pending', 'in_transit', 'delivered', 'cancelled']));

    const inventoryWarehouses = new Set(inventory.map((i) => i.warehouse));
    for (const w of WAREHOUSES) {
      expect(inventoryWarehouses.has(w.code)).toBe(true);
    }
  });

  it('independently hand-recomputes out-of-stock/low-stock counts from raw quantity vs. reorderPoint (no buildAlerts)', () => {
    const { inventory } = generateSampleData({ seed: 42, today: TODAY });
    const enriched = enrichInventory(inventory);
    let outOfStock = 0;
    let lowStock = 0;
    for (const r of inventory) {
      const status = getStockStatus(r.quantity, r.reorderPoint);
      if (status === 'out_of_stock') outOfStock += 1;
      else if (status === 'low_stock') lowStock += 1;
    }
    expect(outOfStock).toBe(6); // matches the manifest's outOfStock.length
    expect(lowStock).toBe(14); // matches the manifest's lowStock.length
    // Cross-check against the domain function's own enrichment too (belt-and-suspenders, still hand-driven logic).
    expect(enriched.filter((i) => i.stockStatus === 'out_of_stock')).toHaveLength(6);
    expect(enriched.filter((i) => i.stockStatus === 'low_stock')).toHaveLength(14);
  });

  it('warehouse utilization for every reference warehouse is still below 1 (capacity tuning untouched by R-6)', () => {
    const { inventory } = generateSampleData({ seed: 42, today: TODAY });
    for (const w of WAREHOUSES) {
      const units = inventory.filter((i) => i.warehouse === w.code).reduce((sum, i) => sum + i.quantity, 0);
      expect(units).toBeLessThan(w.capacityUnits as number);
    }
  });

  it('is still fully deterministic for the same seed/today after the generator change', () => {
    const a = generateSampleData({ seed: 42, today: TODAY });
    const b = generateSampleData({ seed: 42, today: TODAY });
    expect(a).toEqual(b);
  });
});
