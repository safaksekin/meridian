// Pure game logic for Tripoint (no DOM, no imports) so node --test can load it directly.

export type Mark = 'good' | 'near' | 'bad';

export const MAX_GUESSES = 4;
export const SHARE_URL = 'https://meridian.example/#/tripoint';

/** Feedback for one guessed country: in the answer, a neighbour of any answer country, or neither. */
export function mark(code: string, answer: string[], neighbours: (c: string) => string[]): Mark {
  if (answer.includes(code)) return 'good';
  const nb = neighbours(code);
  if (answer.some((a) => nb.includes(a) || neighbours(a).includes(code))) return 'near';
  return 'bad';
}

export function marks(guess: string[], answer: string[], neighbours: (c: string) => string[]): Mark[] {
  return guess.map((g) => mark(g, answer, neighbours));
}

export function isWin(guess: string[], answer: string[]): boolean {
  return guess.length === 3 && answer.every((a) => guess.includes(a));
}

/** Number of guesses that did not solve the puzzle. */
export function misses(guesses: string[][], answer: string[]): number {
  return guesses.filter((g) => !isWin(g, answer)).length;
}

/**
 * Hint layers unlocked after `missCount` wrong guesses:
 * 1 coastlines + lakes, 2 rivers, 3 wider view (500 km) and one missing country named.
 */
export function hints(missCount: number) {
  return { coast: missCount >= 1, rivers: missCount >= 2, wide: missCount >= 3, give: missCount >= 3 };
}

/** Answer countries the player has already found. */
export function found(guesses: string[][], answer: string[]): string[] {
  return answer.filter((a) => guesses.some((g) => g.includes(a)));
}

/**
 * The country handed over by the last hint: the most populous missing one, only while at least
 * two are missing (so the final guess is never given away).
 */
export function givenCountry(guesses: string[][], answer: string[], pop: (c: string) => number): string | null {
  if (!hints(misses(guesses, answer)).give) return null;
  const known = found(guesses, answer);
  const missing = answer.filter((a) => !known.includes(a));
  if (missing.length < 2) return null;
  return [...missing].sort((a, b) => pop(b) - pop(a) || a.localeCompare(b))[0];
}

/**
 * Slots for the next guess: found countries stay where the player put them, the given country goes
 * into the first free slot, everything else is cleared.
 */
export function lockedSlots(guesses: string[][], answer: string[], given: string | null): (string | null)[] {
  const slots: (string | null)[] = [null, null, null];
  for (const g of guesses) g.forEach((c, i) => { if (answer.includes(c) && !slots.includes(c) && !slots[i]) slots[i] = c; });
  // A found country whose slot was taken by another found one goes into any free slot.
  for (const c of found(guesses, answer)) if (!slots.includes(c)) slots[slots.indexOf(null)] = c;
  if (given && !slots.includes(given)) slots[slots.indexOf(null)] = given;
  return slots;
}

const EMOJI: Record<Mark, string> = { good: '🟩', near: '🟨', bad: '⬛' };
const RANK: Record<Mark, number> = { good: 0, near: 1, bad: 2 };

/** One share row: squares sorted green, yellow, black so the slot order spoils nothing. */
export function shareRow(m: Mark[]): string {
  return [...m].sort((a, b) => RANK[a] - RANK[b]).map((x) => EMOJI[x]).join('');
}

export function shareText(day: number, rows: Mark[][], won: boolean): string {
  return [`Meridian Tripoint #${day}`, ...rows.map(shareRow), `📍 ${won ? rows.length : 'X'}/${MAX_GUESSES}`, SHARE_URL].join('\n');
}

/** Stats bucket: "1".."4" or "X". */
export function bucket(won: boolean, n: number): string {
  return won ? String(n) : 'X';
}

/** Decode one delta-encoded line [x0, y0, dx1, dy1, ...] into an SVG path fragment. */
export function pathOf(lines: number[][], close = false): string {
  let out = '';
  for (const l of lines) {
    let x = 0, y = 0;
    for (let i = 0; i < l.length; i += 2) {
      x += l[i];
      y += l[i + 1];
      out += (i ? 'L' : 'M') + x + ' ' + y;
    }
    if (close) out += 'Z';
  }
  return out;
}

/** A round scale-bar length (km) no longer than maxKm. */
export function niceKm(maxKm: number): number {
  const p = 10 ** Math.floor(Math.log10(maxKm));
  for (const m of [5, 2, 1]) if (m * p <= maxKm) return m * p;
  return p;
}
