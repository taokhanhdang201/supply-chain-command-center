// Regression tests for R-2: `niceTicks` must never produce a top tick below `max`, or a chart's mark gets drawn
// past the edge of its plotted area.

import { describe, it, expect } from 'vitest';
import { linearScale, niceTicks } from '../../../src/client/components/charts/scales';

describe('niceTicks', () => {
  it('returns [0] for max <= 0', () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(-5)).toEqual([0]);
  });

  it('always has a last tick >= max (R-2 regression)', () => {
    // 12098558 is the reviewer's reproduction case: the real September 2026 total shipping cost in the sample
    // data, which previously produced a top tick of 1e7 (below the 12098558 max), clipping the line chart.
    for (const max of [12_098_558, 118_000, 1_234, 14, 0.5, 1, 999_999, 5_000_000]) {
      const ticks = niceTicks(max);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks[ticks.length - 1] as number).toBeGreaterThanOrEqual(max);
    }
  });

  it('produces evenly-spaced, ascending ticks starting at 0', () => {
    const ticks = niceTicks(1234);
    expect(ticks[0]).toBe(0);
    for (let i = 1; i < ticks.length; i += 1) {
      expect((ticks[i] as number) - (ticks[i - 1] as number)).toBeCloseTo((ticks[1] as number) - (ticks[0] as number), 9);
    }
  });
});

describe('linearScale', () => {
  it('maps the domain endpoints to the range endpoints', () => {
    const scale = linearScale([0, 100], [300, 0]);
    expect(scale(0)).toBe(300);
    expect(scale(100)).toBe(0);
  });

  it('maps everything to the range midpoint for a zero-width domain', () => {
    const scale = linearScale([5, 5], [0, 100]);
    expect(scale(5)).toBe(50);
    expect(scale(999)).toBe(50);
  });
});
