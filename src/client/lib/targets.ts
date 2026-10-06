// Shared performance targets for the client: the Dashboard hero and the Analytics stage colour the on-time rate with
// the same thresholds.

export type TargetTone = 'neutral' | 'good' | 'warning' | 'critical';

/** On-time delivery target: at or above it is good. Below the floor it is critical; in between, a warning. */
export const ON_TIME_TARGET = 0.9;
export const ON_TIME_FLOOR = 0.8;

export function onTimeTone(rate: number | null): TargetTone {
  if (rate === null) return 'neutral';
  if (rate >= ON_TIME_TARGET) return 'good';
  if (rate >= ON_TIME_FLOOR) return 'warning';
  return 'critical';
}
