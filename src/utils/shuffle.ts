/**
 * Explore's order.
 *
 * Explore is still what it was — the newest photographs from across
 * VINTAGE, nothing ranked — but it no longer reads in exactly the same
 * order every time it is opened. The set is the same; the deal is fresh.
 *
 * The shuffle is seeded, so one seed always gives one order: a screen
 * re-rendering keeps its rows where they are, and pull-to-refresh, which
 * draws a new seed, is what reshuffles. It is also a permutation, so no
 * photograph is repeated or dropped.
 */

/** A small deterministic generator — enough to deal a grid, cheap to run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seed. Returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Keep one member's photographs from landing side by side.
 *
 * A shuffle of sixty pictures from a dozen people will put two of the
 * same person's together now and then, which reads as a run. This walks
 * the order once and, where a row would repeat the author just before
 * it, swaps in the next photograph by someone else. Stable otherwise, and
 * still a permutation.
 */
export function spreadAuthors<T extends { author_id: string }>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    if (out[i].author_id !== out[i - 1].author_id) continue;
    const swap = out.findIndex((p, j) => j > i && p.author_id !== out[i - 1].author_id);
    if (swap === -1) break;
    [out[i], out[swap]] = [out[swap], out[i]];
  }
  return out;
}

/** The order explore shows: shuffled by seed, then spread. */
export function dealExplore<T extends { author_id: string }>(items: readonly T[], seed: number): T[] {
  return spreadAuthors(seededShuffle(items, seed));
}

/** A fresh seed for a fresh deal. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
