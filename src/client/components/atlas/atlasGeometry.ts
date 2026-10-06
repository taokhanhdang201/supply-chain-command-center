// Pure geometry and derivations for the Atlas scene (V2 Dashboard). Nothing here computes a business metric: lane
// colour reuses the existing route-delay thresholds, and a "transit dot" is only where an existing in-transit
// shipment sits between its ship date and its estimated delivery, measured against the snapshot's `today`.

import type { Location, Shipment } from '../../../shared/types';
import { diffDays } from '../../../shared/dates';
import { projectToMap } from '../../../shared/geo';
import { ROUTE_DELAY_CRITICAL_SHARE, ROUTE_DELAY_WARNING_SHARE } from '../../../shared/constants';

export interface Pt {
  x: number;
  y: number;
}

export type LaneTone = 'neutral' | 'warning' | 'critical';

/** Same two thresholds the Routes map uses for line colour. */
export function laneTone(delayedShare: number): LaneTone {
  if (delayedShare >= ROUTE_DELAY_CRITICAL_SHARE) return 'critical';
  if (delayedShare >= ROUTE_DELAY_WARNING_SHARE) return 'warning';
  return 'neutral';
}

/** Control point of the lane's quadratic curve: the same 15% perpendicular bow the Routes map draws. */
export function laneControl(p1: Pt, p2: Pt): Pt {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = 0.15 * length;
  return { x: (p1.x + p2.x) / 2 + (-dy / length) * offset, y: (p1.y + p2.y) / 2 + (dx / length) * offset };
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path for the whole lane. */
export function lanePath(p1: Pt, p2: Pt): string {
  const c = laneControl(p1, p2);
  return `M${fmt(p1.x)},${fmt(p1.y)} Q${fmt(c.x)},${fmt(c.y)} ${fmt(p2.x)},${fmt(p2.y)}`;
}

/** The point at parameter `t` (0..1) along the lane's curve. */
export function pointOnLane(p1: Pt, p2: Pt, t: number): Pt {
  const c = laneControl(p1, p2);
  const u = 1 - t;
  return { x: u * u * p1.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * c.y + t * t * p2.y };
}

/** The lane's curve from the origin up to parameter `t` (de Casteljau split), for animating a dot along it. */
export function laneSegmentPath(p1: Pt, p2: Pt, t: number): string {
  const c = laneControl(p1, p2);
  const q = { x: p1.x + t * (c.x - p1.x), y: p1.y + t * (c.y - p1.y) };
  const end = pointOnLane(p1, p2, t);
  return `M${fmt(p1.x)},${fmt(p1.y)} Q${fmt(q.x)},${fmt(q.y)} ${fmt(end.x)},${fmt(end.y)}`;
}

/** How far along its scheduled journey a shipment is: 0 at ship date, 1 at estimated delivery (clamped). Null when the
 * estimated delivery is missing or not after the ship date, so there is nothing honest to place. */
export function transitProgress(s: Pick<Shipment, 'shipDate' | 'estimatedDelivery'>, today: string): number | null {
  if (s.estimatedDelivery === null) return null;
  const total = diffDays(s.estimatedDelivery, s.shipDate);
  if (total <= 0) return null;
  const elapsed = diffDays(today, s.shipDate);
  return Math.min(1, Math.max(0, elapsed / total));
}

export interface TransitDot {
  shipmentId: string;
  label: string;
  x: number;
  y: number;
  /** Curve from the origin to the dot, used to animate its arrival. */
  segmentPath: string;
  progress: number;
  /** True once the shipment is past its estimated delivery and still not delivered. */
  overdue: boolean;
}

/** One dot per in-transit shipment whose route is fully mapped and whose journey can be placed. */
export function buildTransitDots(shipments: readonly Shipment[], locations: readonly Location[], today: string): TransitDot[] {
  const byCode = new Map(locations.map((l) => [l.code, l]));
  const dots: TransitDot[] = [];
  for (const s of shipments) {
    if (s.status !== 'in_transit' || s.originCode === null || s.destinationCode === null || s.originCode === s.destinationCode) continue;
    const from = byCode.get(s.originCode);
    const to = byCode.get(s.destinationCode);
    const progress = transitProgress(s, today);
    if (!from || !to || progress === null) continue;
    const p1 = projectToMap(from.lat, from.lon);
    const p2 = projectToMap(to.lat, to.lon);
    const at = pointOnLane(p1, p2, progress);
    dots.push({
      shipmentId: s.shipmentId,
      label: s.routeLabel,
      x: at.x,
      y: at.y,
      segmentPath: laneSegmentPath(p1, p2, progress),
      progress,
      overdue: s.deliveryState === 'overdue'
    });
  }
  return dots;
}
