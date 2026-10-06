// Round-2 independent verification of R-2 ("niceTicks must never produce a top tick below max"). The coder's
// own regression test (tests/client/components/scales.test.ts) checks a fixed list of reviewer-supplied
// reproduction values; this file fuzzes the invariant across a large number of random values (including
// sub-1 magnitudes, huge magnitudes, and boundary/edge inputs called out in the round-2 test plan: 0, negatives,
// tiny values, huge values, and repeated/all-equal-looking inputs) to catch any edge the fixed list might miss.

import { describe, it, expect } from 'vitest';
import { niceTicks } from '../../src/client/components/charts/scales';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('R-2 regression (round 2, independent fuzz): niceTicks last tick is always >= max', () => {
  it('holds for 0 and negative values (degenerate domain -> [0])', () => {
    for (const max of [0, -1, -0.5, -1000, -1e9, -Number.EPSILON]) {
      expect(niceTicks(max)).toEqual([0]);
    }
  });

  it('holds for tiny (sub-1) magnitudes in the range this app can actually produce (dollars >= $0.01, counts >= 1)', () => {
    for (const max of [1e-4, 0.001, 0.01, 0.1, 0.33, 0.999999]) {
      const ticks = niceTicks(max);
      expect(ticks[ticks.length - 1] as number).toBeGreaterThanOrEqual(max);
    }
  });

  it('BUG-3 marker: niceTicks violates its own "last tick >= max" contract for max below ~5e-7', () => {
    // niceTicks's final loop does `Math.round(v * 1e6) / 1e6` on every tick value, presumably to clean up
    // floating-point noise (e.g. 0.1 + 0.2 artifacts) for the "nice round number" ticks it targets. But for a
    // `max` small enough that `top` itself rounds to 0 under that same 1e-6 rounding, the returned tick array's
    // last entry is 0, which is *below* max -- exactly the invariant R-2 was supposed to guarantee everywhere.
    // Not currently reachable from this app's own UI (every real chart value here is either a shipment/item
    // count >= 1, or a dollar amount derived from integer cents, so the smallest possible nonzero `max` passed
    // to niceTicks in production is 0.01) -- flagged here as a latent defect in the shared utility itself, since
    // the reviewer's brief asked for the invariant to be fuzzed including tiny values, and this is where it
    // actually breaks. Left failing per tester process (BUG-3): not a fix.
    for (const max of [1e-9, 1e-8, 1e-7, 2e-7]) {
      const ticks = niceTicks(max);
      expect(ticks[ticks.length - 1] as number).toBeGreaterThanOrEqual(max);
    }
  });

  it('holds for huge magnitudes (beyond any realistic dollar figure)', () => {
    for (const max of [1e12, 1e15, 9_999_999_999, 123_456_789_012.34, Number.MAX_SAFE_INTEGER]) {
      const ticks = niceTicks(max);
      expect(ticks[ticks.length - 1] as number).toBeGreaterThanOrEqual(max);
    }
  });

  it('holds across 5,000 random positive values spanning many orders of magnitude', () => {
    const rand = mulberry32(20260928);
    for (let i = 0; i < 5000; i += 1) {
      // Sample magnitude uniformly in [-3, 15] (i.e. 0.001 .. 1e15) then a random mantissa, so we hit values
      // right at nice-step boundaries (e.g. exactly 5e6) as well as awkward ones (e.g. 12098558.37).
      const exponent = rand() * 18 - 3;
      const mantissa = 1 + rand() * 9;
      const max = mantissa * 10 ** exponent;
      const ticks = niceTicks(max);
      const last = ticks[ticks.length - 1] as number;
      expect(last).toBeGreaterThanOrEqual(max);
      // Ticks must be non-decreasing and start at 0.
      expect(ticks[0]).toBe(0);
      for (let k = 1; k < ticks.length; k += 1) {
        expect(ticks[k] as number).toBeGreaterThan(ticks[k - 1] as number);
      }
    }
  });

  it('holds for values exactly on a "nice" boundary (all-equal-looking round numbers)', () => {
    for (const max of [5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 1000000, 5000000, 10000000]) {
      const ticks = niceTicks(max);
      expect(ticks[ticks.length - 1] as number).toBeGreaterThanOrEqual(max);
    }
  });

  it('holds for a value just barely above a round tick boundary (the class of bug R-2 actually had)', () => {
    // The original bug: niceTicks(12098558) produced a top tick of 1e7, i.e. *below* max. Fuzz values just above
    // round boundaries at several scales to make sure no other boundary regressed.
    for (const boundary of [10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000]) {
      for (const bump of [1, 0.01, boundary * 0.0001 + 0.5]) {
        const max = boundary + bump;
        const ticks = niceTicks(max);
        expect(ticks[ticks.length - 1] as number).toBeGreaterThanOrEqual(max);
      }
    }
  });
});
