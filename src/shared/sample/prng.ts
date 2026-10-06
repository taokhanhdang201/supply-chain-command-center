// Deterministic pseudo-random number generation (mulberry32) so sample data is fully reproducible from a seed.

export type Rng = () => number;

/** Creates a mulberry32 PRNG seeded from `seed`, returning floats in [0, 1). */
export function createPrng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [min, max], inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Random float in [min, max). */
export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

/** Picks a uniformly random element from a non-empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)] as T;
}

/** Fisher-Yates shuffle of a copy of `arr`; does not mutate the input. */
export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i);
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}
