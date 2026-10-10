// Daily puzzle selection. Everyone on the same local calendar day gets the same puzzle.
const EPOCH = { y: 2026, m: 10, d: 10 }; // Day #1

function localMidnightUTC(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Real calendar day number (1-based) for the given local date, ignoring any override. */
export function todayNumber(now = new Date()): number {
  const epoch = Date.UTC(EPOCH.y, EPOCH.m - 1, EPOCH.d);
  return Math.max(1, Math.round((localMidnightUTC(now) - epoch) / 86400000) + 1);
}

/** Puzzle day being played. Supports ?day=N override (test mode and debugging). */
export function dayNumber(now = new Date()): number {
  const override = new URLSearchParams(location.search).get('day');
  if (override && /^\d+$/.test(override)) return Math.max(1, parseInt(override, 10));
  return todayNumber(now);
}

/** Today's index into a pre-shuffled puzzle list of length n. */
export function puzzleIndex(day: number, n: number): number {
  return (((day - 1) % n) + n) % n;
}

/** Milliseconds until the next local midnight. */
export function msUntilTomorrow(now = new Date()): number {
  const t = new Date(now);
  t.setHours(24, 0, 0, 0);
  return t.getTime() - now.getTime();
}

/** Small deterministic PRNG for per-day randomness (e.g. shuffling hint order). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
