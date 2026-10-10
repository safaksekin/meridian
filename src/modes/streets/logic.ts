// Pure logic for Streetprint (no DOM, no imports) so node --test can load it directly.

export const MAX_GUESSES = 6;
export const BUCKETS = ['1', '2', '3', '4', '5', '6', 'X'];
/** Hint layers in unlock order: one per wrong guess. */
export const HINTS = ['north', 'water', 'rail', 'zoom', 'names'] as const;
export type Hint = (typeof HINTS)[number];

/** A polyline as [x0, y0, dx1, dy1, dx2, dy2, ...] in integer metres (y points south). */
export type Line = number[];
/** A polygon as a list of closed rings, rendered with the even-odd rule. */
export type Poly = Line[];

export interface PuzzleMeta {
  id: number;
  /** GeoNames id of the answer city. */
  c: string;
  n: string;
  cc: string;
  lat: number;
  lon: number;
  /** Initial rotation of the crop in degrees (30–330). */
  rot: number;
}

export interface View {
  /** Half size of the square in metres. */
  s: number;
  w: Poly[];
  wl: Line[];
}

export interface Puzzle extends View {
  id: number;
  /** Major roads (motorway–secondary). */
  m: Line[];
  /** All other streets. */
  r: Line[];
  /** Railways, metro and tram. */
  rl: Line[];
  /** ~10 km context view. f = motorway/trunk, m = primary/secondary. */
  z: View & { f: Line[]; m: Line[] };
  /** 36-bin street bearing histogram (0°, 10°, ... clockwise from north), max = 100. */
  rose: number[];
  names: string[];
}

export interface City {
  /** GeoNames id. */
  i: string;
  /** English name. */
  n: string;
  /** Turkish name if different. */
  t?: string;
  c: string;
  a: number;
  o: number;
  /** Extra folded search keys (local and alternative names). */
  k?: string[];
}

export interface Status {
  done: boolean;
  won: boolean;
  misses: number;
}

export function status(guesses: string[], target: string): Status {
  const won = guesses.includes(target);
  const misses = guesses.filter((g) => g !== target).length;
  return { done: won || guesses.length >= MAX_GUESSES, won, misses };
}

/** Hints visible now: one per wrong guess; everything once the game is over. */
export function unlockedHints(guesses: string[], target: string): Set<Hint> {
  const st = status(guesses, target);
  const n = st.done ? HINTS.length : Math.min(st.misses, HINTS.length);
  return new Set(HINTS.slice(0, n));
}

export function bucketFor(guesses: string[], target: string): string {
  const st = status(guesses, target);
  return st.won ? String(guesses.indexOf(target) + 1) : 'X';
}

export function scoreLabel(guesses: string[], target: string): string {
  return `${bucketFor(guesses, target)}/${MAX_GUESSES}`;
}

export function emojiLine(guesses: string[], target: string): string {
  const st = status(guesses, target);
  const squares: string[] = guesses.map((g) => (g === target ? '🟩' : '⬛'));
  if (!st.won && st.done) squares[squares.length - 1] = '🟥';
  return `🛣️ ${squares.join('')} ${scoreLabel(guesses, target)}`;
}

export function shareText(day: number, guesses: string[], target: string, url = 'https://meridian.example/#/streets'): string {
  return `Meridian Streetprint #${day}\n${emojiLine(guesses, target)}\n${url}`;
}

/** Decodes a delta-encoded line into absolute points. */
export function decode(line: Line): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < line.length; i += 2) {
    x = i === 0 ? line[0] : x + line[i];
    y = i === 0 ? line[1] : y + line[i + 1];
    out.push([x, y]);
  }
  return out;
}

/** SVG path data for a set of open polylines. */
export function linesPath(lines: Line[]): string {
  let d = '';
  for (const l of lines) {
    if (l.length < 4) continue;
    let x = l[0];
    let y = l[1];
    d += `M${x} ${y}`;
    for (let i = 2; i + 1 < l.length; i += 2) {
      x += l[i];
      y += l[i + 1];
      d += `L${x} ${y}`;
    }
  }
  return d;
}

/** SVG path data for one polygon (closed rings). */
export function polyPath(poly: Poly): string {
  return poly.map((r) => (r.length >= 6 ? linesPath([r]) + 'Z' : '')).join('');
}

/**
 * Scale that keeps a square crop covering its square viewport when rotated by `deg`:
 * a side-S square rotated by θ covers a centred square of side S / (|cos θ| + |sin θ|).
 */
export function coverScale(deg: number): number {
  const r = (deg * Math.PI) / 180;
  return Math.abs(Math.cos(r)) + Math.abs(Math.sin(r));
}

/**
 * Path data for the orientation rose (Boeing style polar histogram), centred on 0,0 with outer radius r.
 * Petal i points at bearing i*10° (clockwise from north) and spans ±5°. Radius ∝ sqrt(value) so area ∝ value.
 */
export function rosePath(rose: number[], r: number): string {
  const max = Math.max(1, ...rose);
  let d = '';
  for (let i = 0; i < rose.length; i++) {
    const v = rose[i] / max;
    if (v <= 0) continue;
    const len = r * Math.sqrt(v);
    const step = 360 / rose.length;
    const a0 = ((i * step - step / 2 - 90) * Math.PI) / 180;
    const a1 = ((i * step + step / 2 - 90) * Math.PI) / 180;
    const p = (a: number) => `${(len * Math.cos(a)).toFixed(2)} ${(len * Math.sin(a)).toFixed(2)}`;
    d += `M0 0L${p(a0)}A${len.toFixed(2)} ${len.toFixed(2)} 0 0 1 ${p(a1)}Z`;
  }
  return d;
}
