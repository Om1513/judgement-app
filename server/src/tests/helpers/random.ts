// Deterministic replacement for Math.random.
//
// Several game rules are randomised - shuffling, random trump order, bot bid
// jitter. Asserting on one hard-coded "random" sequence would test the PRNG,
// not the rule, so instead the tests either assert on properties that must hold
// for every sequence, or pin the seed with this helper so a failure is
// reproducible.

/** Mulberry32: tiny, fast, well-distributed, and identical on every machine. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs `fn` with Math.random pinned to `seed`, restoring the real one
 * afterwards even if `fn` throws.
 */
export function withSeed<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/**
 * Async form of `withSeed`, for pinning the deal across an awaited service
 * call. Safe because node:test runs the tests within a file one at a time, so
 * nothing else is drawing from Math.random while this is in effect.
 */
export async function withSeedAsync<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

/** Runs `fn` with Math.random pinned to a constant value. */
export function withFixedRandom<T>(value: number, fn: () => T): T {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
