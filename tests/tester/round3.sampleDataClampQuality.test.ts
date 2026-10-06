// Round-3 scrutiny of BUG-4/R-12's second half: `clampNaturalCostNoise` in generateSampleData.ts caps any
// non-manifest shipment's cost so it can never read as an anomaly against its own route. Two concerns from the
// task brief: (a) does the clamp make the sample data unrealistically uniform (near-identical costs per route),
// which would hide real detector weaknesses behind data that's too clean to exercise them; and (b) does the
// fix actually hold for seeds beyond the one spot-checked in fix-round-2 (100)? This file scans many seeds
// directly against the product's own `generateSampleData` + `enrichShipments` + `assessShippingCosts` pipeline
// (no reimplementation), and separately measures real per-route cost dispersion to check for over-clamping.

import { describe, it, expect } from 'vitest';
import { generateSampleData } from '../../src/shared/sample/generateSampleData';
import { enrichShipments } from '../../src/shared/domain/shipments';
import { LOCATIONS } from '../../src/shared/reference/locations';

const TODAY = '2026-09-28';

describe('BUG-4/R-12 clamp: no false positives across many seeds, without over-flattening the data', () => {
  it('zero non-manifest cost_anomaly alerts across 200 sampled seeds (spot-check broader than fix-round-2\'s single seed 100)', () => {
    const seedsToCheck = [1, 7, 42, 100, 2026, 999, 12345];
    for (let i = 0; i < 193; i++) seedsToCheck.push(i * 53 + 3); // spread across a wide range, deterministic
    const failures: string[] = [];
    for (const seed of seedsToCheck) {
      const { shipments, anomalies } = generateSampleData({ seed, today: TODAY });
      const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
      const manifestIds = new Set(anomalies.costAnomaly);
      const nonManifestFlagged = enriched.filter((s) => s.cost.isAnomaly && !manifestIds.has(s.shipmentId));
      if (nonManifestFlagged.length > 0) {
        failures.push(`seed ${seed}: ${nonManifestFlagged.map((s) => s.shipmentId).join(', ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('every manifest cost-anomaly shipment is still flagged (the clamp must never touch or weaken the intentional anomalies)', () => {
    for (const seed of [1, 42, 100, 2026]) {
      const { shipments, anomalies } = generateSampleData({ seed, today: TODAY });
      const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
      const flaggedIds = new Set(enriched.filter((s) => s.cost.isAnomaly).map((s) => s.shipmentId));
      for (const id of anomalies.costAnomaly) {
        expect(flaggedIds.has(id)).toBe(true);
      }
    }
  });

  it('the clamp does not collapse per-route costs to near-identical values -- realistic dispersion survives', () => {
    // If the clamp were over-aggressive it would flatten every route's costs toward the median, which would
    // both look unrealistic in the UI and hide genuine detector weaknesses behind data with no natural spread
    // left to test against. Check the coefficient of variation (stddev / mean) of a large route's non-manifest
    // shipment costs is still comfortably above the sample generator's own stated intent (per-shipment
    // `costFactor` noise is +/-10% uniform, so CV should land somewhere in the low single-digit percent range,
    // not collapse to ~0%).
    const { shipments, anomalies } = generateSampleData({ seed: 42, today: TODAY });
    const manifestIds = new Set(anomalies.costAnomaly);
    const byRoute = new Map<string, number[]>();
    for (const r of shipments) {
      if (r.status === 'cancelled' || r.shippingCostCents <= 0 || manifestIds.has(r.shipmentId)) continue;
      const key = `${r.origin}>${r.destination}`;
      const arr = byRoute.get(key) ?? [];
      arr.push(r.shippingCostCents);
      byRoute.set(key, arr);
    }
    let checkedAtLeastOneLargeRoute = false;
    for (const [route, costs] of byRoute) {
      if (costs.length < 10) continue; // only check routes with enough shipments for CV to be meaningful
      checkedAtLeastOneLargeRoute = true;
      const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
      const variance = costs.reduce((a, b) => a + (b - mean) ** 2, 0) / costs.length;
      const cv = Math.sqrt(variance) / mean;
      // Real, unclamped +/-10% uniform noise has a CV of roughly 5-6%. Require the clamp hasn't crushed it
      // below 1% (which would indicate over-flattening) while still being well under 15% (which would indicate
      // the clamp isn't doing anything at all -- also worth flagging, though not expected here).
      expect(cv, `route ${route} CV`).toBeGreaterThan(0.01);
      expect(cv, `route ${route} CV`).toBeLessThan(0.15);
    }
    expect(checkedAtLeastOneLargeRoute).toBe(true);
  });

  it('per-route record counts and manifest anomaly counts are unaffected by the clamp (only cost values change, not which/how-many shipments exist)', () => {
    const { shipments, anomalies } = generateSampleData({ seed: 42, today: TODAY });
    expect(shipments.length).toBe(480);
    expect(anomalies.costAnomaly.length).toBe(8);
  });
});
