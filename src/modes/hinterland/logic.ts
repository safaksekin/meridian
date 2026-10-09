// Pure game logic for Hinterland (no DOM, no imports) so node --test can load it directly.

export interface HName {
  n: string;
  lat: number;
  lon: number;
  admin1?: string;
}

export interface Puzzle {
  country: string;
  /** Six settlement names, most ambiguous first. */
  names: HName[];
  /** Typical toponym ending in this country and its share of the country's names (percent). */
  pat?: { s: string; pct: number };
}

/** Country code -> language family id. */
export type Families = Record<string, string>;

export type Tile = 'good' | 'near' | 'bad';

export const MAX_GUESSES = 6;
export const BUCKETS = ['1', '2', '3', '4', '5', '6', 'X'];
export const SHARE_URL = 'https://meridian.example/#/hinterland';
const SQUARE: Record<Tile, string> = { good: '🟩', near: '🟨', bad: '🟥' };

export function sameFamily(a: string, b: string, families: Families): boolean {
  const fa = families[a];
  return !!fa && fa === families[b];
}

/** Share square for one guess: correct, same language family, otherwise. */
export function tileFor(guess: string, target: string, families: Families): Tile {
  if (guess === target) return 'good';
  return sameFamily(guess, target, families) ? 'near' : 'bad';
}

export function status(guesses: string[], target: string): { done: boolean; won: boolean } {
  const won = guesses.includes(target);
  return { done: won || guesses.length >= MAX_GUESSES, won };
}

/** How many names are visible: one at start, one more per wrong guess, all six once the game is over. */
export function revealedCount(guesses: string[], target: string, total = 6): number {
  if (status(guesses, target).done) return total;
  return Math.min(total, guesses.length + 1);
}

export function bucketFor(guesses: string[], target: string): string {
  const i = guesses.indexOf(target);
  return i >= 0 ? String(i + 1) : 'X';
}

export function scoreLabel(guesses: string[], target: string): string {
  return `${bucketFor(guesses, target)}/${MAX_GUESSES}`;
}

export function shareText(day: number, guesses: string[], target: string, families: Families): string {
  const squares = guesses.map((g) => SQUARE[tileFor(g, target, families)]).join('');
  return [`Meridian Hinterland #${day}`, `🏘️ ${squares} ${scoreLabel(guesses, target)}`, SHARE_URL].join('\n');
}
