// Round 6 (R-17): independent detector-level tests for the min-ratio gate (z > 3.5 AND cost >= 1.5 x peer median),
// at every fallback tier, plus an out-of-sample seed sweep (seeds and "today" values the coder did not use).
import { describe, it, expect } from 'vitest';
import { assessShippingCosts, type CostInput } from '../../src/shared/domain/costAnomaly';
import { COST_ANOMALY_MIN_RATIO } from '../../src/shared/constants';
import { generateSampleData } from '../../src/shared/sample/generateSampleData';
import { enrichShipments } from '../../src/shared/domain/shipments';
import { LOCATIONS } from '../../src/shared/reference/locations';

const base = (o: Partial<CostInput>): CostInput => ({ shipmentId: 'X', routeKey: 'WH-DFW>HOU', carrier: 'A', status: 'delivered', shippingCostCents: 10000, distanceMiles: 100, ...o });

// 9 peers whose median is exactly 10000 with a TINY spread (MAD ~ 5 cents => any tiny excess has a huge z-score).
const TIGHT = [9990, 9995, 10000, 10000, 10000, 10000, 10005, 10010, 10000];

function tier1(outlierCents: number) {
  const peers = TIGHT.map((c, i) => base({ shipmentId: `P${i}`, shippingCostCents: c }));
  const r = assessShippingCosts([...peers, base({ shipmentId: 'O', shippingCostCents: outlierCents })]).get('O')!;
  return r;
}
function tier2(outlierCents: number) { // 3 carriers x 3 => no carrier group reaches 8, route group does
  const peers: CostInput[] = [];
  TIGHT.forEach((c, i) => peers.push(base({ shipmentId: `P${i}`, carrier: `C${i % 3}`, shippingCostCents: c })));
  return assessShippingCosts([...peers, base({ shipmentId: 'O', carrier: 'C0', shippingCostCents: outlierCents })]).get('O')!;
}
function tier3(outlierCents: number) { // every shipment on its own route => per_mile pool (>=50 mi)
  const peers = TIGHT.map((c, i) => base({ shipmentId: `P${i}`, routeKey: `R${i}>Z`, shippingCostCents: c }));
  return assessShippingCosts([...peers, base({ shipmentId: 'O', routeKey: 'RO>Z', shippingCostCents: outlierCents })]).get('O')!;
}
const tiers: Array<[string, (c: number) => ReturnType<typeof tier1>, string]> = [['route_carrier', tier1, 'route_carrier'], ['route', tier2, 'route'], ['per_mile', tier3, 'per_mile']];

describe('R-17 ratio gate: constant', () => { it('is 1.5', () => expect(COST_ANOMALY_MIN_RATIO).toBe(1.5)); });

for (const [name, run, method] of tiers) {
  describe(`R-17 ratio gate at tier ${name}`, () => {
    it('uses the intended tier', () => expect(run(20000).method).toBe(method));
    it('1.3x with a tiny MAD (huge z) is NOT flagged', () => {
      const r = run(13000);
      expect(r.score).toBeGreaterThan(3.5); // proves the z-test alone would have flagged it
      expect(r.isAnomaly).toBe(false);
    });
    it('1.49x is NOT flagged; exactly 1.5x IS flagged (boundary is inclusive)', () => {
      expect(run(14900).isAnomaly).toBe(false);
      expect(run(15000).isAnomaly).toBe(true);
    });
    it('2x is flagged; 5x is flagged', () => { expect(run(20000).isAnomaly).toBe(true); expect(run(50000).isAnomaly).toBe(true); });
    it('cheap outliers (0.5x) are never flagged', () => expect(run(5000).isAnomaly).toBe(false));
    it('a big ratio with a LOW z is not flagged (both conditions required): wide-spread peers', () => {
      const wide = [5000, 8000, 10000, 12000, 15000, 7000, 13000, 9000, 11000];
      const peers = wide.map((c, i) => base({ shipmentId: `P${i}`, routeKey: name === 'per_mile' ? `R${i}>Z` : 'WH-DFW>HOU', carrier: name === 'route' ? `C${i % 3}` : 'A', shippingCostCents: c }));
      const o = base({ shipmentId: 'O', routeKey: name === 'per_mile' ? 'RO>Z' : 'WH-DFW>HOU', carrier: name === 'route' ? 'C0' : 'A', shippingCostCents: 16000 }); // 1.6x median but inside the spread
      const r = assessShippingCosts([...peers, o]).get('O')!;
      expect(r.score).toBeLessThanOrEqual(3.5);
      expect(r.isAnomaly).toBe(false);
    });
  });
}

describe('R-17 all-equal peers (MAD 0) and the gate', () => {
  it('all-equal peers, mild 1.2x outlier: not flagged; 2x: flagged', () => {
    const peers = Array.from({ length: 9 }, (_, i) => base({ shipmentId: `P${i}` }));
    expect(assessShippingCosts([...peers, base({ shipmentId: 'O', shippingCostCents: 12000 })]).get('O')!.isAnomaly).toBe(false);
    expect(assessShippingCosts([...peers, base({ shipmentId: 'O', shippingCostCents: 20000 })]).get('O')!.isAnomaly).toBe(true);
  });
  it('no anomaly among identical shipments', () => {
    const all = Array.from({ length: 12 }, (_, i) => base({ shipmentId: `P${i}` }));
    for (const r of assessShippingCosts(all).values()) expect(r.isAnomaly).toBe(false);
  });
});

describe('R-17 out-of-sample seed sweep (seeds 1000-2999, three different "today" values)', () => {
  it('zero false positives, every injected cost anomaly flagged, other manifest counts stable', { timeout: 300_000 }, () => {
    const problems: string[] = [];
    const todays = ['2026-09-28', '2026-03-15', '2027-01-09'];
    for (let seed = 1000; seed < 3000; seed += 1) {
      const today = todays[seed % todays.length]!;
      const { shipments, anomalies } = generateSampleData({ seed, today });
      const flagged = enrichShipments(shipments, today, LOCATIONS).filter((s) => s.cost.isAnomaly).map((s) => s.shipmentId);
      const m = new Set(anomalies.costAnomaly);
      const extra = flagged.filter((id) => !m.has(id));
      const missing = anomalies.costAnomaly.filter((id) => !flagged.includes(id));
      if (extra.length || missing.length || anomalies.costAnomaly.length !== 8) problems.push(`seed ${seed} ${today}: extra=[${extra}] missing=[${missing}] n=${anomalies.costAnomaly.length}`);
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });
});
