// Shared performance targets for the client: the Dashboard hero and the Analytics stage colour the on-time rate with
// the same thresholds, and say the same thing about the deliveries it cannot rate. A figure against its target colours
// only its number (DESIGN.md "Target tone"): plain on target, amber below it, red below the floor.

import type { Shipment } from '../../shared/types';
import type { FigureTone } from '../components/ui/Figure';

export type TargetTone = 'neutral' | 'good' | 'warning' | 'critical';

/** On-time delivery target: at or above it is good. Below the floor it is critical; in between, a warning. */
export const ON_TIME_TARGET = 0.9;
export const ON_TIME_FLOOR = 0.8;

/** Warehouse utilization: from 90% full the number turns amber; over capacity it is red. */
export const UTILIZATION_WARN_FROM = 0.9;

export function onTimeTone(rate: number | null): TargetTone {
  if (rate === null) return 'neutral';
  if (rate >= ON_TIME_TARGET) return 'good';
  if (rate >= ON_TIME_FLOOR) return 'warning';
  return 'critical';
}

/** The tone of a utilization number: amber from 90%, red over 100%, plain below 90% and when the capacity is unknown. */
export function utilizationTone(u: number | null): FigureTone {
  if (u === null) return 'neutral';
  if (u > 1) return 'critical';
  if (u >= UTILIZATION_WARN_FROM) return 'warning';
  return 'neutral';
}

/** The colour of a number measured against its target: on target it stays plain ink (good is not painted green). */
export function targetFigureTone(t: TargetTone): FigureTone {
  return t === 'good' ? 'neutral' : t;
}

/**
 * "8 not measurable": the delivered shipments the on-time rate leaves out because the server could not
 * rate them (deliveryState "unknown": a delivery date is missing, or the delivery is dated before the ship date). Beside
 * "364 of 425 delivered on time" it says why 425 is not every delivered shipment (433). It counts the server's flags;
 * null when every delivered shipment was rated, so complete data shows nothing extra.
 */
export function notMeasurableNote(shipments: readonly Shipment[]): string | null {
  const count = shipments.filter((s) => s.status === 'delivered' && s.deliveryState === 'unknown').length;
  return count === 0 ? null : `${count.toLocaleString('en-US')} not measurable`;
}
