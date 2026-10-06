// Shipping-cost anomaly detection via a modified z-score (Iglewicz-Hoaglin) on median and MAD, upper-tail only
// (plan §4.6). We only flag abnormally *expensive* shipments; cheap outliers are never flagged.

import type { CostAssessment, ShipmentStatus } from '../types';
import { COST_ANOMALY_MIN_RATIO, COST_ANOMALY_Z_THRESHOLD, COST_MIN_DISTANCE_MILES, COST_MIN_PEER_GROUP, MAD_SCALE, MEAN_AD_SCALE } from '../constants';

export interface CostInput {
  shipmentId: string;
  routeKey: string;
  carrier: string;
  status: ShipmentStatus;
  shippingCostCents: number;
  distanceMiles: number | null;
}

/** Median of a numeric array; even length averages the two middle values; empty array returns null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Modified z-score of `x` against `values`, using the median absolute deviation (MAD), with a mean-absolute-
 * deviation fallback when MAD is 0, and 0 when both are 0 (all values identical).
 */
export function robustZScore(x: number, values: readonly number[]): number {
  const med = median(values) as number;
  const mad = median(values.map((v) => Math.abs(v - med))) as number;
  if (mad > 0) return (MAD_SCALE * (x - med)) / mad;
  const meanAD = values.reduce((sum, v) => sum + Math.abs(v - med), 0) / values.length;
  if (meanAD > 0) return (x - med) / (MEAN_AD_SCALE * meanAD);
  return 0;
}

/** Anomaly rule: a high modified z-score AND a real, practical excess over the peer median (at least
 * `COST_ANOMALY_MIN_RATIO` times it). Without the second condition, a tight peer group flags shipments that are
 * only a few percent above typical. */
function isCostAnomaly(score: number, x: number, peerMedian: number): boolean {
  return score > COST_ANOMALY_Z_THRESHOLD && x >= COST_ANOMALY_MIN_RATIO * peerMedian;
}

/** Builds `key(s) -> shippingCostCents[]` groups from `eligible` inputs. */
function groupCosts(eligible: readonly CostInput[], key: (s: CostInput) => string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const s of eligible) {
    const k = key(s);
    const arr = groups.get(k) ?? [];
    arr.push(s.shippingCostCents);
    groups.set(k, arr);
  }
  return groups;
}

/**
 * Assesses every shipment's shipping cost against a peer group, keyed by shipmentId . Peer groups are
 * tried in order of specificity, each requiring `COST_MIN_PEER_GROUP` members to be statistically meaningful:
 *
 * 1. `route + carrier` -- the tightest, most homogeneous group. Different carriers can legitimately charge quite
 *    different per-mile rates on the same route (see `generateSampleData.ts`'s carrier rate table), so mixing
 *    carriers into one route-only peer group can flag a shipment as "anomalous" purely because it used a
 *    pricier carrier, not because anything is actually wrong with it.
 * 2. `route` alone -- falls back here when a route doesn't have `COST_MIN_PEER_GROUP` shipments from the same
 *    carrier (e.g. a low-volume route, or one carrier dominating it).
 * 3. `per_mile` -- falls back here when the route itself doesn't have enough peers at all (e.g. a rare route),
 *    comparing cost-per-mile against every other long-haul shipment regardless of route or carrier.
 * 4. `none` -- no peer group large enough to say anything.
 *
 * In every case a shipment is flagged only if its score exceeds `COST_ANOMALY_Z_THRESHOLD` AND its cost is at
 * least `COST_ANOMALY_MIN_RATIO` times the peer median (per-mile rate for the per-mile group).
 */
export function assessShippingCosts(inputs: readonly CostInput[]): Map<string, CostAssessment> {
  const results = new Map<string, CostAssessment>();

  const eligible = inputs.filter((s) => s.status !== 'cancelled' && s.shippingCostCents > 0);

  const routeGroups = groupCosts(eligible, (s) => s.routeKey);
  const routeCarrierGroups = groupCosts(eligible, (s) => `${s.routeKey}::${s.carrier}`);

  const perMilePool = eligible.filter((s) => s.distanceMiles !== null && s.distanceMiles >= COST_MIN_DISTANCE_MILES);
  const perMileValues = perMilePool.map((s) => s.shippingCostCents / (s.distanceMiles as number));

  for (const s of inputs) {
    if (s.status === 'cancelled' || s.shippingCostCents <= 0) {
      results.set(s.shipmentId, { method: 'none', peerCount: 0, baselineCents: null, score: null, isAnomaly: false });
      continue;
    }

    const routeCarrierValues = routeCarrierGroups.get(`${s.routeKey}::${s.carrier}`) ?? [];
    if (routeCarrierValues.length >= COST_MIN_PEER_GROUP) {
      const x = s.shippingCostCents;
      const peerMedian = median(routeCarrierValues) as number;
      const baselineCents = Math.round(peerMedian);
      const score = robustZScore(x, routeCarrierValues);
      results.set(s.shipmentId, {
        method: 'route_carrier',
        peerCount: routeCarrierValues.length,
        baselineCents,
        score: Math.round(score * 100) / 100,
        isAnomaly: isCostAnomaly(score, x, peerMedian)
      });
      continue;
    }

    const routeValues = routeGroups.get(s.routeKey) ?? [];
    if (routeValues.length >= COST_MIN_PEER_GROUP) {
      const x = s.shippingCostCents;
      const peerMedian = median(routeValues) as number;
      const baselineCents = Math.round(peerMedian);
      const score = robustZScore(x, routeValues);
      results.set(s.shipmentId, {
        method: 'route',
        peerCount: routeValues.length,
        baselineCents,
        score: Math.round(score * 100) / 100,
        isAnomaly: isCostAnomaly(score, x, peerMedian)
      });
      continue;
    }

    const inPerMilePool = s.distanceMiles !== null && s.distanceMiles >= COST_MIN_DISTANCE_MILES;
    if (inPerMilePool && perMileValues.length >= COST_MIN_PEER_GROUP) {
      const x = s.shippingCostCents / (s.distanceMiles as number);
      const peerMedian = median(perMileValues) as number;
      const baselineCents = Math.round(peerMedian * (s.distanceMiles as number));
      const score = robustZScore(x, perMileValues);
      results.set(s.shipmentId, {
        method: 'per_mile',
        peerCount: perMileValues.length,
        baselineCents,
        score: Math.round(score * 100) / 100,
        isAnomaly: isCostAnomaly(score, x, peerMedian)
      });
      continue;
    }

    results.set(s.shipmentId, { method: 'none', peerCount: 0, baselineCents: null, score: null, isAnomaly: false });
  }

  return results;
}
