// Round-3 scrutiny of BUG-4/R-12's approach (per the coder's fix-round-2 change: `assessShippingCosts` now tries
// route+carrier -> route -> per_mile -> none, in that order, each requiring COST_MIN_PEER_GROUP (8) members).
// This file independently checks that narrowing the *tightest* peer group from "whole route" to "route+carrier"
// did NOT introduce false negatives: a genuinely expensive shipment must still be caught at every fallback tier,
// including the tiers the plan's minimum-sample rule forces a fall-through to. Constructed datasets only --
// nothing here depends on `generateSampleData`'s specific seed/output.

import { describe, it, expect } from 'vitest';
import { assessShippingCosts, type CostInput } from '../../src/shared/domain/costAnomaly';
import { COST_MIN_PEER_GROUP, COST_MIN_DISTANCE_MILES, COST_ANOMALY_Z_THRESHOLD } from '../../src/shared/constants';

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

describe('BUG-4/R-12 fallback tiers: a real anomaly is still caught at every tier, no false negatives', () => {
  it('tier 1 (route_carrier): exactly the minimum peer-group size (8) still flags a genuinely expensive outlier', () => {
    // 8 peers is the smallest group the detector will ever use for route_carrier -- confirm the statistic still
    // has enough power at the boundary size, not just in a comfortably large group.
    const peers: CostInput[] = Array.from({ length: 7 }, (_, i) => input({ shipmentId: `PEER${i}`, shippingCostCents: 10000 + i * 50 }));
    const outlier = input({ shipmentId: 'OUTLIER', shippingCostCents: 40000 }); // 4x the peer baseline
    const results = assessShippingCosts([...peers, outlier]);
    expect(results.get('OUTLIER')?.method).toBe('route_carrier');
    expect(results.get('OUTLIER')?.peerCount).toBe(8);
    expect(results.get('OUTLIER')?.isAnomaly).toBe(true);
  });

  it('tier 2 (route fallback): route+carrier group too small (mixed carriers, 3 each) but the route as a whole reaches 8 -- outlier still caught', () => {
    // 3 carriers x 3 shipments = 9 route-total peers, but no single carrier reaches 8 -> must fall back to route.
    const peers: CostInput[] = [];
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 3; i++) {
        peers.push(input({ shipmentId: `PEER-${c}-${i}`, carrier: `Carrier ${c}`, shippingCostCents: 10000 + i * 50 }));
      }
    }
    const outlier = input({ shipmentId: 'OUTLIER', carrier: 'Carrier 0', shippingCostCents: 45000 });
    const results = assessShippingCosts([...peers, outlier]);
    expect(results.get('OUTLIER')?.method).toBe('route');
    expect(results.get('OUTLIER')?.isAnomaly).toBe(true);
  });

  it('tier 3 (per_mile fallback): a rare/unique route with too few peers of its own, but a large long-haul per-mile pool -- outlier still caught', () => {
    // The subject's own route has only 2 shipments (itself + 1 peer) -- neither route_carrier nor route tiers
    // are usable. A large pool of *other* routes' long-haul shipments (distance >= COST_MIN_DISTANCE_MILES)
    // supplies the per_mile fallback.
    const perMilePool: CostInput[] = Array.from({ length: 10 }, (_, i) => input({
      shipmentId: `POOL${i}`,
      routeKey: `WH-OTHER${i}>DEST${i}`,
      carrier: `Carrier ${i}`,
      shippingCostCents: 20000, // $2.00/mile at 100 miles
      distanceMiles: 100
    }));
    const routePeer = input({ shipmentId: 'RARE-PEER', routeKey: 'WH-RARE>DEST', distanceMiles: 200, shippingCostCents: 40000 });
    const outlier = input({ shipmentId: 'OUTLIER', routeKey: 'WH-RARE>DEST', distanceMiles: 200, shippingCostCents: 200000 }); // $10.00/mile, 5x the pool
    const results = assessShippingCosts([...perMilePool, routePeer, outlier]);
    expect(results.get('OUTLIER')?.method).toBe('per_mile');
    expect(results.get('OUTLIER')?.isAnomaly).toBe(true);
  });

  it('minimum-sample rule (plan): below COST_MIN_PEER_GROUP everywhere and below the distance floor -- correctly reports "none", not a false negative disguised as a miss', () => {
    // A truly isolated shipment (short route, too few peers, too short a distance for per_mile) has no
    // statistically meaningful peer group at all. The detector must not guess -- "none"/not-anomaly is the
    // documented, correct behavior here, not a bug.
    const onlyPeer = input({ shipmentId: 'PEER', routeKey: 'WH-TINY>DEST', distanceMiles: 10, shippingCostCents: 10000 });
    const expensive = input({ shipmentId: 'EXPENSIVE', routeKey: 'WH-TINY>DEST', distanceMiles: 10, shippingCostCents: 100000 });
    const results = assessShippingCosts([onlyPeer, expensive]);
    expect(results.get('EXPENSIVE')?.method).toBe('none');
    expect(results.get('EXPENSIVE')?.isAnomaly).toBe(false);
  });

  it('narrower route+carrier grouping catches an anomaly that a route-wide (mixed-carrier) grouping would have masked', () => {
    // This is the whole point of R-12: one carrier charges genuinely more per shipment (not anomalous for that
    // carrier), the other has a real outlier. Mixed into one route-wide group of 24, the outlier would be judged
    // against a much noisier baseline (pulled up by the pricier carrier) and could go undetected. Split by
    // route+carrier (12 each), the outlier is judged only against its own carrier's tight distribution.
    const cheapCarrier: CostInput[] = Array.from({ length: 11 }, (_, i) => input({ shipmentId: `CHEAP${i}`, carrier: 'Budget Line', shippingCostCents: 10000 + i * 20 }));
    const cheapOutlier = input({ shipmentId: 'CHEAP-OUTLIER', carrier: 'Budget Line', shippingCostCents: 40000 });
    const pricierCarrier: CostInput[] = Array.from({ length: 12 }, (_, i) => input({ shipmentId: `PRICY${i}`, carrier: 'Premium Express', shippingCostCents: 30000 + i * 30 }));
    const results = assessShippingCosts([...cheapCarrier, cheapOutlier, ...pricierCarrier]);
    expect(results.get('CHEAP-OUTLIER')?.method).toBe('route_carrier');
    expect(results.get('CHEAP-OUTLIER')?.isAnomaly).toBe(true);
    // Sanity: none of the pricier carrier's own (non-outlier) shipments are flagged just for being pricier.
    for (let i = 0; i < 12; i++) {
      expect(results.get(`PRICY${i}`)?.isAnomaly).toBe(false);
    }
  });

  it('a genuinely 10x-expensive shipment is still caught even at a much larger route_carrier peer group (sensitivity does not degrade with more peers)', () => {
    const peers: CostInput[] = Array.from({ length: 50 }, (_, i) => input({ shipmentId: `PEER${i}`, shippingCostCents: 9500 + (i % 5) * 100 }));
    const outlier = input({ shipmentId: 'OUTLIER', shippingCostCents: 100000 });
    const results = assessShippingCosts([...peers, outlier]);
    expect(results.get('OUTLIER')?.method).toBe('route_carrier');
    expect(results.get('OUTLIER')?.isAnomaly).toBe(true);
    expect(results.get('OUTLIER')?.score).toBeGreaterThan(COST_ANOMALY_Z_THRESHOLD);
  });

  it('sanity: cancelled shipments are never flagged regardless of cost, and never pollute peer groups', () => {
    const peers: CostInput[] = Array.from({ length: 8 }, (_, i) => input({ shipmentId: `PEER${i}`, shippingCostCents: 10000 }));
    const cancelledExpensive = input({ shipmentId: 'CANCELLED', status: 'cancelled', shippingCostCents: 999999 });
    const results = assessShippingCosts([...peers, cancelledExpensive]);
    expect(results.get('CANCELLED')?.method).toBe('none');
    expect(results.get('CANCELLED')?.isAnomaly).toBe(false);
    // Also confirm the cancelled shipment's huge cost didn't get counted into the real peers' group size or
    // pull their baseline upward -- the group should be exactly the 8 real peers, not 9.
    expect(results.get('PEER0')?.peerCount).toBe(8);
    expect(results.get('PEER0')?.baselineCents).toBe(10000);
  });

  it('references the documented minimum peer-group and distance-floor constants (so this test breaks loudly if the plan thresholds change)', () => {
    expect(COST_MIN_PEER_GROUP).toBe(8);
    expect(COST_MIN_DISTANCE_MILES).toBe(50);
  });
});
