// The sample data is NOT adjusted to keep the cost detector quiet (no clamping): the detector's own rule
// (z > 3.5 AND cost >= 1.5x peer median) must keep natural ±10% price noise from being reported, for any seed.

import { describe, it, expect } from 'vitest';
import { generateSampleData } from '../../../src/shared/sample/generateSampleData';
import { enrichShipments } from '../../../src/shared/domain/shipments';
import { LOCATIONS } from '../../../src/shared/reference/locations';

const TODAY = '2026-09-28';

function flaggedFor(seed: number) {
  const { shipments, anomalies } = generateSampleData({ seed, today: TODAY });
  const enriched = enrichShipments(shipments, TODAY, LOCATIONS);
  const flagged = enriched.filter((s) => s.cost.isAnomaly).map((s) => s.shipmentId);
  return { flagged, manifest: anomalies.costAnomaly };
}

describe('cost anomalies over seeds', () => {
  it('seed 42 flags exactly the 8 injected anomalies', () => {
    const { flagged, manifest } = flaggedFor(42);
    expect(manifest).toHaveLength(8);
    expect(new Set(flagged)).toEqual(new Set(manifest));
    expect(flagged).toHaveLength(8);
  });

  it('seeds 0-999 produce zero false cost anomalies and flag every injected one', { timeout: 120_000 }, () => {
    const problems: string[] = [];
    for (let seed = 0; seed < 1000; seed += 1) {
      const { flagged, manifest } = flaggedFor(seed);
      const m = new Set(manifest);
      const extra = flagged.filter((id) => !m.has(id));
      const missing = manifest.filter((id) => !flagged.includes(id));
      if (extra.length > 0 || missing.length > 0) problems.push(`seed ${seed}: extra=[${extra}] missing=[${missing}]`);
    }
    expect(problems).toEqual([]);
  });
});
