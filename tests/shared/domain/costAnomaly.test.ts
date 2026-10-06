import { describe, it, expect } from 'vitest';
import { median, robustZScore, assessShippingCosts, type CostInput } from '../../../src/shared/domain/costAnomaly';

describe('median', () => {
  it('is the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is null for an empty array', () => {
    expect(median([])).toBeNull();
  });
});

describe('robustZScore', () => {
  it('uses MAD when it is nonzero', () => {
    const values = [10, 12, 11, 13, 10, 12, 50];
    const score = robustZScore(50, values);
    expect(score).toBeGreaterThan(0);
  });

  it('falls back to mean absolute deviation when MAD is 0', () => {
    const values = [10, 10, 10, 10, 20];
    // median is 10, MAD is 0 (majority of values equal the median)
    const score = robustZScore(20, values);
    expect(score).toBeGreaterThan(0);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('is 0 when all values are equal', () => {
    expect(robustZScore(5, [5, 5, 5, 5])).toBe(0);
  });
});

function input(overrides: Partial<CostInput>): CostInput {
  return {
    shipmentId: 'SHP-1',
    routeKey: 'WH-DFW>HOU',
    carrier: 'Carrier A',
    status: 'delivered',
    shippingCostCents: 10000,
    distanceMiles: 100,
    ...overrides
  };
}

describe('assessShippingCosts', () => {
  it('uses the route_carrier method when the same route+carrier has at least 8 peers (R-12)', () => {
    const inputs: CostInput[] = Array.from({ length: 8 }, (_, i) => input({ shipmentId: `S${i}`, shippingCostCents: 10000 }));
    const results = assessShippingCosts(inputs);
    expect(results.get('S0')?.method).toBe('route_carrier');
    expect(results.get('S0')?.peerCount).toBe(8);
  });

  it('falls back to the route method when route+carrier has fewer than 8 peers but the route as a whole does (R-12)', () => {
    // 8 shipments on the same route, split 4/4 between two carriers -- neither carrier alone reaches the
    // route_carrier peer-group minimum, so this should fall back to the route-wide group instead.
    const inputs: CostInput[] = Array.from({ length: 8 }, (_, i) =>
      input({ shipmentId: `S${i}`, carrier: i % 2 === 0 ? 'Carrier A' : 'Carrier B', shippingCostCents: 10000 })
    );
    const results = assessShippingCosts(inputs);
    expect(results.get('S0')?.method).toBe('route');
    expect(results.get('S0')?.peerCount).toBe(8);
  });

  it('does not flag a shipment for using a pricier (but otherwise normal) carrier on a mixed-carrier route (R-12 / BUG-4)', () => {
    // Two carriers on the same route with a real per-mile rate spread, 8 shipments each -- each carrier's own
    // route_carrier peer group is large enough to be used, so a shipment costing more only because it used the
    // pricier carrier is judged against that carrier's own peers, not against the cheaper carrier's shipments.
    const cheap: CostInput[] = Array.from({ length: 8 }, (_, i) => input({ shipmentId: `CHEAP${i}`, carrier: 'Cascade Carriers', shippingCostCents: 10000 }));
    const pricier: CostInput[] = Array.from({ length: 8 }, (_, i) => input({ shipmentId: `PRICY${i}`, carrier: 'Summit Express', shippingCostCents: 13800 }));
    const results = assessShippingCosts([...cheap, ...pricier]);
    expect(results.get('PRICY0')?.method).toBe('route_carrier');
    expect(results.get('PRICY0')?.isAnomaly).toBe(false);
    expect(results.get('CHEAP0')?.isAnomaly).toBe(false);
  });

  it('falls back to per-mile when the route has fewer than 8 peers but the per-mile pool is big enough', () => {
    const routeShipments: CostInput[] = Array.from({ length: 3 }, (_, i) =>
      input({ shipmentId: `R${i}`, routeKey: 'RARE>ROUTE', distanceMiles: 200, shippingCostCents: 20000 })
    );
    const perMilePadding: CostInput[] = Array.from({ length: 6 }, (_, i) =>
      input({ shipmentId: `P${i}`, routeKey: `OTHER${i}>ROUTE`, distanceMiles: 100, shippingCostCents: 10000 })
    );
    const results = assessShippingCosts([...routeShipments, ...perMilePadding]);
    expect(results.get('R0')?.method).toBe('per_mile');
  });

  it("is 'none' when the endpoint is unmapped (no distance) and the route peer group is small", () => {
    const inputs: CostInput[] = [input({ shipmentId: 'S1', routeKey: 'X>Y', distanceMiles: null })];
    const results = assessShippingCosts(inputs);
    expect(results.get('S1')).toEqual({ method: 'none', peerCount: 0, baselineCents: null, score: null, isAnomaly: false });
  });

  it('flags a 5x outlier as anomalous', () => {
    const inputs: CostInput[] = [
      ...Array.from({ length: 7 }, (_, i) => input({ shipmentId: `S${i}`, shippingCostCents: 10000 })),
      input({ shipmentId: 'OUTLIER', shippingCostCents: 50000 })
    ];
    const results = assessShippingCosts(inputs);
    expect(results.get('OUTLIER')?.isAnomaly).toBe(true);
  });

  it('does not flag a mild variation as anomalous', () => {
    const base = [9800, 9900, 10000, 10100, 10200, 9950, 10050];
    const inputs: CostInput[] = [
      ...base.map((cents, i) => input({ shipmentId: `S${i}`, shippingCostCents: cents })),
      input({ shipmentId: 'MILD', shippingCostCents: 10500 })
    ];
    const results = assessShippingCosts(inputs);
    expect(results.get('MILD')?.isAnomaly).toBe(false);
  });

  it('never flags a cheap outlier (upper tail only)', () => {
    const inputs: CostInput[] = [
      ...Array.from({ length: 7 }, (_, i) => input({ shipmentId: `S${i}`, shippingCostCents: 10000 })),
      input({ shipmentId: 'CHEAP', shippingCostCents: 500 })
    ];
    const results = assessShippingCosts(inputs);
    expect(results.get('CHEAP')?.isAnomaly).toBe(false);
  });

  it('excludes cancelled shipments and zero-cost shipments from stats', () => {
    const inputs: CostInput[] = [
      ...Array.from({ length: 8 }, (_, i) => input({ shipmentId: `S${i}`, shippingCostCents: 10000 })),
      input({ shipmentId: 'CANCELLED', status: 'cancelled', shippingCostCents: 999999 }),
      input({ shipmentId: 'ZERO', shippingCostCents: 0 })
    ];
    const results = assessShippingCosts(inputs);
    expect(results.get('CANCELLED')).toEqual({ method: 'none', peerCount: 0, baselineCents: null, score: null, isAnomaly: false });
    expect(results.get('ZERO')).toEqual({ method: 'none', peerCount: 0, baselineCents: null, score: null, isAnomaly: false });
    // and neither pollutes the peer group used for S0..S7
    expect(results.get('S0')?.peerCount).toBe(8);
  });

  it('reports a sensible baselineCents for the route method', () => {
    const inputs: CostInput[] = Array.from({ length: 8 }, (_, i) => input({ shipmentId: `S${i}`, shippingCostCents: 10000 }));
    const results = assessShippingCosts(inputs);
    expect(results.get('S0')?.baselineCents).toBe(10000);
  });
});

describe('minimum relative excess (COST_ANOMALY_MIN_RATIO)', () => {
  const peers = (base: number, spread: number): CostInput[] =>
    Array.from({ length: 16 }, (_, i) => input({ shipmentId: `P${i}`, shippingCostCents: base + ((i % 5) - 2) * spread }));

  it('never flags a 16-shipment group with ±10% noise, however tight its MAD happens to be', () => {
    // Uniform-ish ±10% spread; run many deterministic variants so at least some have a small MAD.
    let seed = 1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let trial = 0; trial < 500; trial += 1) {
      const inputs = Array.from({ length: 16 }, (_, i) => input({ shipmentId: `T${trial}-${i}`, shippingCostCents: Math.round(100_000 * (0.9 + 0.2 * rand())) }));
      const flagged = [...assessShippingCosts(inputs).values()].filter((a) => a.isAnomaly);
      expect(flagged).toEqual([]);
    }
  });

  it('does not flag a shipment 1.4x the median even when its z-score is very high', () => {
    const inputs = [...peers(100_000, 100), input({ shipmentId: 'X', shippingCostCents: 140_000 })];
    const result = assessShippingCosts(inputs).get('X');
    expect(result?.score).toBeGreaterThan(3.5);
    expect(result?.isAnomaly).toBe(false);
  });

  it('flags a shipment 1.6x the median', () => {
    const inputs = [...peers(100_000, 100), input({ shipmentId: 'X', shippingCostCents: 160_000 })];
    expect(assessShippingCosts(inputs).get('X')?.isAnomaly).toBe(true);
  });

  it('applies the ratio to the per-mile baseline too', () => {
    const mk = (id: string, cents: number, route: string): CostInput =>
      input({ shipmentId: id, routeKey: route, shippingCostCents: cents, distanceMiles: 1000 });
    const pool = Array.from({ length: 12 }, (_, i) => mk(`M${i}`, 200_000 + (i % 3) * 100, `R${i}>Z`));
    const modest = assessShippingCosts([...pool, mk('MOD', 280_000, 'RARE>Z')]).get('MOD');
    const big = assessShippingCosts([...pool, mk('BIG', 320_000, 'RARE>Z')]).get('BIG');
    expect(modest?.method).toBe('per_mile');
    expect(modest?.isAnomaly).toBe(false);
    expect(big?.isAnomaly).toBe(true);
  });
});
