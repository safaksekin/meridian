// Pure game logic for Beeline (no DOM), shared with tests.
export type Tile = 'good' | 'near' | 'bad';

/** Wordle-style feedback for an ordered guess of distinct countries. */
export function scoreRow(guess: string[], answer: string[]): Tile[] {
  return guess.map((g, i) => (g === answer[i] ? 'good' : answer.includes(g) ? 'near' : 'bad'));
}

export const MAX_ROWS = 6;

export function isSolved(rows: string[][], answer: string[]): boolean {
  return rows.some((r) => r.every((g, i) => g === answer[i]));
}

/** Index of the first slot not yet solved in any row (5 when all are known). */
export function solvedPrefix(rows: string[][], answer: string[]): number {
  let k = 0;
  while (k < answer.length && rows.some((r) => r[k] === answer[k])) k++;
  return k;
}

const WINDS: Record<'en' | 'tr', string[]> = {
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
  tr: ['K', 'KKD', 'KD', 'DKD', 'D', 'DGD', 'GD', 'GGD', 'G', 'GGB', 'GB', 'BGB', 'B', 'BKB', 'KB', 'KKB'],
};

export function windName(bearing: number, lang: 'en' | 'tr'): string {
  return WINDS[lang][Math.round(bearing / 22.5) % 16];
}

export function pad3(n: number): string {
  return String(Math.round(n)).padStart(3, '0');
}

const EMOJI: Record<Tile, string> = { good: '🟩', near: '🟨', bad: '⬛' };
export function emojiRow(tiles: Tile[]): string {
  return tiles.map((t) => EMOJI[t]).join('');
}
