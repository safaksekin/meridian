// Pure rules for Expedition (no DOM, no imports) so node --test can load it directly.
//
// A run: you start in a city with a full tank. Each leg names no place; it only shows the next
// destination through a clue window. You tap a spot on the globe and fly there from where you are.
// Land within ARRIVE_KM of the destination and you refuel; miss and you are now wherever you
// landed, with a rough bearing and distance band to go on. Every flight burns its great-circle
// length plus a fixed take-off cost. The run ends when the fuel can no longer reach the destination.

export type Kind = 'coast' | 'pop' | 'names' | 'streets';
export type Tier = 1 | 2 | 3;
export type Extra = 'sun' | 'flag';

export interface Place {
  k: Kind;
  t: Tier;
  /** Latitude, longitude. */
  a: number;
  o: number;
  /** Name (GeoNames), Turkish name if it differs. */
  n: string;
  tr?: string;
  /** Country code. */
  c: string;
  /** names: the village signs; streets: Streetprint puzzle id. */
  x?: string[] | number;
}

/**
 * Fuel economy, tuned by simulating players of different skill (tests/expedition.test.mjs): a casual
 * player lasts a handful of legs, a strong one 15–25. Refuels shrink leg by leg, so every run ends.
 */
export const FUEL = { start: 10000, refuel: 4600, refuelStep: 250, refuelFloor: 1000, firstTry: 1000, secondTry: 300 };
export const START_FUEL = FUEL.start;
export const TAKEOFF_KM = 250;
export const ARRIVE_KM = 300;
export const EXTRA_COST: Record<Extra, number> = { sun: 400, flag: 1500 };
/** Legs to finish for the run to count as a win in the stats. */
export const WIN_LEGS = 5;
/** Clue window half-size in km per kind and tier (coast is mirrored in scripts/build-expedition.mjs). */
export const WINDOW_KM: Record<'coast' | 'pop', [number, number, number]> = {
  coast: [1600, 1100, 700],
  pop: [1400, 1000, 700],
};
/** Distance bands told after a miss, km. */
export const BANDS = [750, 1500, 3000, 6000];
export const BUCKETS = ['0–2', '3–5', '6–9', '10–14', '15+'];

const R = 6371.0088;
const D2R = Math.PI / 180;

export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin((lon2 - lon1) * D2R) * Math.cos(lat2 * D2R);
  const x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) - Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon2 - lon1) * D2R);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

/** 0 = N, 1 = NE … 7 = NW. */
export function compass8(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) / 45) % 8;
}

/** Index into BANDS: 0 = under 750 km … 4 = over 6000 km. */
export function bandFor(km: number): number {
  const i = BANDS.findIndex((b) => km < b);
  return i < 0 ? BANDS.length : i;
}

/** Fuel won by landing on a destination, after `hops` flights on leg `leg` (0-based). */
export function refuelFor(leg: number, hops: number): number {
  const base = Math.max(FUEL.refuelFloor, FUEL.refuel - FUEL.refuelStep * leg);
  return base + (hops === 1 ? FUEL.firstTry : hops === 2 ? FUEL.secondTry : 0);
}

export function flightCost(km: number): number {
  return Math.round(TAKEOFF_KM + km);
}

/** Farthest a flight can go with this much fuel. */
export function rangeKm(fuel: number): number {
  return Math.max(0, fuel - TAKEOFF_KM);
}

// ---------------------------------------------------------------- planning a run
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

/** Tiers allowed on leg `i`: gentle first legs, then harder windows. */
export function tiersFor(i: number): Tier[] {
  if (i < 2) return [1];
  if (i < 5) return [1, 2];
  if (i < 9) return [2, 3];
  return [3, 2, 3];
}

const KIND_WEIGHTS: Record<Kind, number> = { coast: 3, pop: 2, names: 3, streets: 2 };

/** Kinds allowed on leg `i` (the street crops are the hardest window; they come later). */
export function kindsFor(i: number): Kind[] {
  return i < 3 ? ['coast', 'pop', 'names'] : ['coast', 'pop', 'names', 'streets'];
}

export interface Run {
  start: Place;
  legs: Place[];
}

/**
 * Plans a run deterministically from a seed: the same seed always gives the same start and the same
 * destinations, so a daily run (seed = day) is the same for everyone and a friend can replay it.
 * Each destination is 1,200–5,000 km from the previous one, never in the same country twice in a row,
 * never repeated, and its clue kind differs from the previous leg's.
 */
export function planRun(pool: Place[], seed: number, n = 60): Run {
  const rnd = mulberry32(seed * 2654435761);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const starts = pool.filter((p) => p.k === 'pop' && p.t <= 2);
  const start = pick(starts.length ? starts : pool);
  const used = new Set<Place>([start]);
  const legs: Place[] = [];
  let at = start;
  let prevKind: Kind | null = null;
  for (let i = 0; i < n; i++) {
    const tiers = tiersFor(i);
    const kinds = kindsFor(i).filter((k) => k !== prevKind);
    let choice: Place | null = null;
    // Widen the search step by step if the neighbourhood runs dry.
    for (const [lo, hi, relaxTier] of [[1200, 5000, false], [800, 7000, false], [800, 9000, true], [0, 20100, true]] as const) {
      const cands = pool.filter(
        (p) => !used.has(p) && p.c !== at.c && kinds.includes(p.k) && (relaxTier || tiers.includes(p.t)) && inRange(at, p, lo, hi),
      );
      if (!cands.length) continue;
      // weighted kind, then a random place of that kind
      const present = kinds.filter((k) => cands.some((p) => p.k === k));
      const total = present.reduce((s, k) => s + KIND_WEIGHTS[k], 0);
      let r = rnd() * total;
      let kind = present[0];
      for (const k of present) {
        r -= KIND_WEIGHTS[k];
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      choice = pick(cands.filter((p) => p.k === kind));
      break;
    }
    if (!choice) break;
    used.add(choice);
    legs.push(choice);
    prevKind = choice.k;
    at = choice;
  }
  return { start, legs };
}

function inRange(a: Place, b: Place, lo: number, hi: number): boolean {
  const d = distKm(a.a, a.o, b.a, b.o);
  return d >= lo && d <= hi;
}

// ---------------------------------------------------------------- playing a run
export interface LegLog {
  /** Landing points of each flight on this leg, [lat, lon]. */
  hops: [number, number][];
  arrived: boolean;
  extras: Extra[];
  /** Fuel won on arrival. */
  refuel?: number;
}

export interface RunState {
  seed: number;
  fuel: number;
  /** Current position, [lat, lon]. */
  pos: [number, number];
  /** One entry per leg started; the last one is the current leg. */
  log: LegLog[];
  done: boolean;
  /** Why the run ended. */
  end?: 'fuel' | 'quit' | 'complete';
}

export function newRun(run: Run, seed: number): RunState {
  return { seed, fuel: FUEL.start, pos: [run.start.a, run.start.o], log: [{ hops: [], arrived: false, extras: [] }], done: false };
}

export function legsDone(s: RunState): number {
  return s.log.filter((l) => l.arrived).length;
}

export function currentLeg(s: RunState): number {
  return s.log.length - 1;
}

/** The destination can no longer be reached: even a perfect flight would run dry. */
export function stranded(s: RunState, target: Place): boolean {
  return rangeKm(s.fuel) < distKm(s.pos[0], s.pos[1], target.a, target.o) - ARRIVE_KM;
}

export interface HopResult {
  cost: number;
  arrived: boolean;
  /** Distance from the landing point to the destination. */
  missKm: number;
  /** After a miss: compass8 index and band index from the landing point. */
  dir?: number;
  band?: number;
  refuel?: number;
}

/** Can a flight to (lat, lon) be paid for? */
export function canFly(s: RunState, lat: number, lon: number): boolean {
  return !s.done && flightCost(distKm(s.pos[0], s.pos[1], lat, lon)) <= s.fuel;
}

/** Flies to (lat, lon). Mutates the state. The caller checks canFly first. */
export function fly(s: RunState, run: Run, lat: number, lon: number): HopResult {
  const leg = s.log[s.log.length - 1];
  const target = run.legs[currentLeg(s)];
  const cost = flightCost(distKm(s.pos[0], s.pos[1], lat, lon));
  s.fuel = Math.max(0, s.fuel - cost);
  leg.hops.push([round3(lat), round3(lon)]);
  const missKm = distKm(lat, lon, target.a, target.o);
  if (missKm <= ARRIVE_KM) {
    const refuel = refuelFor(currentLeg(s), leg.hops.length);
    leg.arrived = true;
    leg.refuel = refuel;
    s.fuel += refuel;
    s.pos = [target.a, target.o];
    if (currentLeg(s) + 1 >= run.legs.length) {
      s.done = true;
      s.end = 'complete';
    } else {
      s.log.push({ hops: [], arrived: false, extras: [] });
      if (stranded(s, run.legs[currentLeg(s)])) {
        s.done = true;
        s.end = 'fuel';
      }
    }
    return { cost, arrived: true, missKm, refuel };
  }
  s.pos = [round3(lat), round3(lon)];
  if (stranded(s, target)) {
    s.done = true;
    s.end = 'fuel';
  }
  return { cost, arrived: false, missKm, dir: compass8(bearing(lat, lon, target.a, target.o)), band: bandFor(missKm) };
}

/** Buys an extra clue for the current leg. False when it is owned or unaffordable. */
export function buyExtra(s: RunState, run: Run, e: Extra): boolean {
  const leg = s.log[s.log.length - 1];
  if (s.done || leg.extras.includes(e) || s.fuel < EXTRA_COST[e]) return false;
  s.fuel -= EXTRA_COST[e];
  leg.extras.push(e);
  if (stranded(s, run.legs[currentLeg(s)])) {
    s.done = true;
    s.end = 'fuel';
  }
  return true;
}

export function quit(s: RunState): void {
  s.done = true;
  s.end = 'quit';
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------- results
export function bucketFor(legs: number): string {
  return legs <= 2 ? BUCKETS[0] : legs <= 5 ? BUCKETS[1] : legs <= 9 ? BUCKETS[2] : legs <= 14 ? BUCKETS[3] : BUCKETS[4];
}

/** One square per leg: 🟩 first flight, 🟨 second, 🟧 third, 🟥 more; 💥 the leg the tank ran dry. */
export function legEmoji(l: LegLog): string {
  if (!l.arrived) return '💥';
  const n = l.hops.length;
  return n === 1 ? '🟩' : n === 2 ? '🟨' : n === 3 ? '🟧' : '🟥';
}

export function shareText(day: number, s: RunState, url = 'https://meridian.example/#/expedition'): string {
  const legs = legsDone(s);
  const squares = s.log.filter((l) => l.arrived || l.hops.length || s.end === 'fuel').map(legEmoji);
  const rows: string[] = [];
  for (let i = 0; i < squares.length; i += 10) rows.push(squares.slice(i, i + 10).join(''));
  return [`Meridian Expedition #${day}`, `✈️ ${legs} · ⛽ ${Math.round(s.fuel).toLocaleString('en-US')} km`, ...rows, url].join('\n');
}

// ---------------------------------------------------------------- sun clock
export interface SunDay {
  /** UTC hours (0–24, may wrap) of sunrise and sunset; null in polar day or night. */
  rise: number | null;
  set: number | null;
  /** Day length in hours. */
  hours: number;
  /** UTC hour of solar noon. */
  noon: number;
}

/** Sunrise, sunset and solar noon (UTC) on the given date (NOAA approximation, ±2 min). */
export function sunDay(lat: number, lon: number, date: Date): SunDay {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (doy + 0.5 - 1);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const noonMin = 720 - 4 * lon - eqtime;
  const noon = (((noonMin / 60) % 24) + 24) % 24;
  const cosH = Math.cos(90.833 * D2R) / (Math.cos(lat * D2R) * Math.cos(decl)) - Math.tan(lat * D2R) * Math.tan(decl);
  if (cosH >= 1) return { rise: null, set: null, hours: 0, noon };
  if (cosH <= -1) return { rise: null, set: null, hours: 24, noon };
  const ha = Math.acos(cosH) / D2R; // degrees
  const wrap = (h: number) => ((h % 24) + 24) % 24;
  return { rise: wrap((noonMin - 4 * ha) / 60), set: wrap((noonMin + 4 * ha) / 60), hours: (8 * ha) / 60, noon };
}

export function hhmm(hours: number): string {
  const m = Math.round(hours * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
