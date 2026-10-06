// Pure scale helpers for the Flow charts, kept out of the component file so editing a chart keeps Fast Refresh working.

/** Widest a bar may be, in px: slim bars leave the red delayed tops room to lead. */
export const MAX_BAR = 48;

/** A "nice" axis maximum (1, 2, 5 x 10^n) at or above `v`. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * p;
}

/** Reliability chart height by drawing width (1440 / 1024 / 768 / 390 give 320 / 280 / 260 / 220). */
export function reliabilityHeight(width: number): number {
  return width >= 880 ? 320 : width >= 700 ? 280 : width >= 500 ? 260 : 220;
}

/** Cost chart height by drawing width (200 / 180 / 180 / 160). */
export function costHeight(width: number): number {
  return width >= 880 ? 200 : width >= 500 ? 180 : 160;
}
