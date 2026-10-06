// Pure shipment domain logic (plan §4.3-§4.5): location resolution, route derivation, data-issue detection,
// delivery-state classification, and full shipment enrichment, including shipping-cost anomaly scoring (§4.6),
// which needs the full population of shipments at once and so runs as a second pass inside `enrichShipments`.

import type { DataIssue, DayString, DeliveryState, Location, Shipment, ShipmentRecord } from '../types';
import { diffDays } from '../dates';
import { formatDay, statusLabel } from '../format';
import { haversineMiles } from '../geo';
import { assessShippingCosts, type CostInput } from './costAnomaly';

/** Trims, collapses inner whitespace, and uppercases a location string for matching. */
export function normalizeLocationText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Resolves free-text location to a known Location by matching its code or name (case-insensitive); else null. */
export function resolveLocation(text: string, locations: readonly Location[]): Location | null {
  const normalized = normalizeLocationText(text);
  return locations.find((l) => l.code.toUpperCase() === normalized || l.name.toUpperCase() === normalized) ?? null;
}

/** Every logical data inconsistency found on a shipment record, in the fixed evaluation order (plan §4.4). */
export function findShipmentIssues(r: ShipmentRecord, today: DayString, originKey: string, destinationKey: string): DataIssue[] {
  const issues: DataIssue[] = [];
  const label = statusLabel(r.status).toLowerCase();

  if (r.actualDelivery !== null && r.actualDelivery < r.shipDate) {
    issues.push({
      code: 'ACTUAL_BEFORE_SHIP',
      message: `Actual delivery ${formatDay(r.actualDelivery)} is before ship date ${formatDay(r.shipDate)}.`
    });
  }
  if (r.estimatedDelivery !== null && r.estimatedDelivery < r.shipDate) {
    issues.push({
      code: 'ETA_BEFORE_SHIP',
      message: `Estimated delivery ${formatDay(r.estimatedDelivery)} is before ship date ${formatDay(r.shipDate)}.`
    });
  }
  if ((r.status === 'pending' || r.status === 'in_transit') && r.actualDelivery !== null) {
    issues.push({
      code: 'OPEN_WITH_ACTUAL',
      message: `Status is ${label} but an actual delivery date (${formatDay(r.actualDelivery)}) is recorded.`
    });
  }
  if (originKey === destinationKey) {
    issues.push({ code: 'SAME_ORIGIN_DESTINATION', message: `Origin and destination are the same (${originKey}).` });
  }
  if (r.status !== 'cancelled' && r.shippingCostCents === 0) {
    issues.push({ code: 'ZERO_COST', message: `Shipping cost is $0.00 for a ${label} shipment.` });
  }
  if ((r.status === 'in_transit' || r.status === 'delivered') && r.shipDate > today) {
    issues.push({
      code: 'SHIP_DATE_IN_FUTURE',
      message: `Ship date ${formatDay(r.shipDate)} is in the future for a ${label} shipment.`
    });
  }
  if (r.actualDelivery !== null && r.actualDelivery > today) {
    issues.push({ code: 'ACTUAL_IN_FUTURE', message: `Actual delivery ${formatDay(r.actualDelivery)} is in the future.` });
  }

  return issues;
}

/** Classifies delivery state and days late, per the ordered rules in plan §4.5. */
export function getDeliveryState(
  r: ShipmentRecord,
  today: DayString,
  issues: readonly DataIssue[]
): { state: DeliveryState; daysLate: number | null } {
  if (r.status === 'cancelled') return { state: 'cancelled', daysLate: null };
  if (issues.some((i) => i.code === 'ACTUAL_BEFORE_SHIP')) return { state: 'unknown', daysLate: null };

  if (r.status === 'delivered') {
    if (r.actualDelivery === null || r.estimatedDelivery === null) return { state: 'unknown', daysLate: null };
    if (r.actualDelivery <= r.estimatedDelivery) return { state: 'on_time', daysLate: null };
    return { state: 'late', daysLate: diffDays(r.actualDelivery, r.estimatedDelivery) };
  }

  // pending / in_transit
  if (r.estimatedDelivery === null) return { state: 'unknown', daysLate: null };
  if (today > r.estimatedDelivery) return { state: 'overdue', daysLate: diffDays(today, r.estimatedDelivery) };
  return { state: 'in_progress', daysLate: null };
}

/** Enriches raw shipment records with resolved locations, route info, delivery state, data issues, and
 * shipping-cost anomaly scoring (computed across the whole batch, since it needs route/per-mile peer groups). */
export function enrichShipments(records: readonly ShipmentRecord[], today: DayString, locations: readonly Location[]): Shipment[] {
  const withoutCost: Shipment[] = records.map((r) => {
    const originLoc = resolveLocation(r.origin, locations);
    const destinationLoc = resolveLocation(r.destination, locations);
    const originKey = originLoc?.code ?? normalizeLocationText(r.origin);
    const destinationKey = destinationLoc?.code ?? normalizeLocationText(r.destination);
    const routeKey = `${originKey}>${destinationKey}`;
    const routeLabel = `${originLoc?.name ?? r.origin.trim().replace(/\s+/g, ' ')} → ${destinationLoc?.name ?? r.destination.trim().replace(/\s+/g, ' ')}`;
    const distanceMiles = originLoc && destinationLoc ? Math.round(10 * haversineMiles(originLoc, destinationLoc)) / 10 : null;

    const issues = findShipmentIssues(r, today, originKey, destinationKey);
    const { state, daysLate } = getDeliveryState(r, today, issues);
    const isDelayed = state === 'late' || state === 'overdue';

    const transitDays =
      r.status === 'delivered' && r.actualDelivery !== null && r.actualDelivery >= r.shipDate
        ? diffDays(r.actualDelivery, r.shipDate)
        : null;

    const missingDates: Array<'estimated_delivery' | 'actual_delivery'> = [];
    if (r.status !== 'cancelled' && r.estimatedDelivery === null) missingDates.push('estimated_delivery');
    if (r.status === 'delivered' && r.actualDelivery === null) missingDates.push('actual_delivery');

    return {
      ...r,
      originCode: originLoc?.code ?? null,
      destinationCode: destinationLoc?.code ?? null,
      routeKey,
      routeLabel,
      distanceMiles,
      deliveryState: state,
      isDelayed,
      daysLate,
      transitDays,
      missingDates,
      cost: { method: 'none', peerCount: 0, baselineCents: null, score: null, isAnomaly: false },
      issues
    };
  });

  const costInputs: CostInput[] = withoutCost.map((s) => ({
    shipmentId: s.shipmentId,
    routeKey: s.routeKey,
    carrier: s.carrier,
    status: s.status,
    shippingCostCents: s.shippingCostCents,
    distanceMiles: s.distanceMiles
  }));
  const costAssessments = assessShippingCosts(costInputs);

  return withoutCost.map((s) => ({ ...s, cost: costAssessments.get(s.shipmentId) ?? s.cost }));
}
