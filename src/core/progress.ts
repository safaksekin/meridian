// Player progression computed from local stats only (no server, nothing invented).
// Everything is derived from each mode's stats history (storage.getStats(mode).history),
// which only ever contains real daily puzzles: practice rounds (day !== todayNumber())
// are never recorded by recordResult, so they never earn XP or extend a streak.
import { getStats } from './storage';
import { todayNumber } from './daily';
import { lang, type Lang } from './i18n';

/** Mode ids (hardcoded instead of importing the registry to keep core free of mode imports). */
export const MODE_IDS = ['beeline', 'streets', 'mental', 'headcount', 'hinterland', 'tripoint'] as const;

/** Modes whose label is "n/N" (solved in n guesses) or "X/N" (not solved). */
export const GUESS_MODES: readonly string[] = ['beeline', 'streets', 'hinterland', 'tripoint'];
/** Modes whose label is a 0–100 score ("74/100" for mental, "98" for headcount). */
export const SCORE_MODES: readonly string[] = ['mental', 'headcount'];

export interface WeekDay {
  /** Short weekday label in the current language, e.g. "Pzt" / "Mon". */
  label: string;
  played: boolean;
  today: boolean;
  future: boolean;
}

export interface ProgressSummary {
  xp: number;
  level: number;
  /** e.g. "Kaşif" / "Explorer". */
  levelTitle: string;
  /** XP at which the current level started and the next one starts. */
  levelStartXp: number;
  nextLevelXp: number;
  /** Consecutive days (ending today or yesterday) with at least one finished puzzle. */
  streak: number;
  bestStreak: number;
  /** Monday-first current week. */
  week: WeekDay[];
  /** Finished puzzles today (0–6). */
  todayDone: number;
  /** XP earned today. */
  todayXp: number;
}

export type History = Record<string, { won: boolean; label: string }>;

export interface ParsedLabel {
  kind: 'guess' | 'score';
  /** guess: guesses used (Infinity when not solved); score: the score. */
  value: number;
  /** guess: number of allowed guesses (N in "n/N"), 0 when unknown. */
  max: number;
  solved: boolean;
}

/** Parse a stats/share label. Returns null for anything malformed. */
export function parseLabel(modeId: string, label: string): ParsedLabel | null {
  if (typeof label !== 'string') return null;
  const s = label.trim();
  if (SCORE_MODES.includes(modeId)) {
    const m = /^(\d{1,3})(?:\/\d{1,3})?$/.exec(s);
    if (!m) return null;
    const v = Math.min(100, parseInt(m[1], 10));
    return { kind: 'score', value: v, max: 100, solved: true };
  }
  const m = /^(\d{1,2}|X)\/(\d{1,2})$/i.exec(s);
  if (!m) return null;
  const max = parseInt(m[2], 10);
  if (m[1].toUpperCase() === 'X') return { kind: 'guess', value: Infinity, max, solved: false };
  const n = parseInt(m[1], 10);
  if (n < 1 || n > max) return null;
  return { kind: 'guess', value: n, max, solved: true };
}

export const XP_BASE = 40;
export const XP_WIN = 60;
export const XP_CAP = 150;

/**
 * XP for one finished daily puzzle:
 *   40 for finishing it at all
 * + 60 if it counts as a win
 * + quality bonus
 *     guess modes (label "n/N"): +10 per unused guess (N − n); "X/N" gives no bonus
 *     score modes (mental "74/100", headcount "98"): + floor(score / 2)
 * capped at 150 per puzzle.
 * Examples: beeline won in 2/6 → 40+60+40 = 140; beeline X/6 → 40;
 *           mental 74/100 won → 40+60+37 = 137; headcount 98 won → 40+60+49 = 149.
 */
export function xpFor(modeId: string, won: boolean, label: string): number {
  let xp = XP_BASE + (won ? XP_WIN : 0);
  const p = parseLabel(modeId, label);
  if (p?.kind === 'guess' && p.solved) xp += 10 * Math.max(0, p.max - p.value);
  else if (p?.kind === 'score') xp += Math.floor(p.value / 2);
  return Math.min(XP_CAP, xp);
}

const TITLES: Record<Lang, string[]> = {
  en: ['Apprentice Mapper', 'Wanderer', 'Explorer', 'Cartographer', 'Navigator', 'Meridian Master'],
  tr: ['Çırak Haritacı', 'Gezgin', 'Kaşif', 'Kartograf', 'Navigatör', 'Meridyen Ustası'],
};

/** XP needed to reach level n (1-based): 0, 300, 800, 1600, 3000, 5000, then +2500 per level. */
export function levelStartXp(level: number): number {
  const base = [0, 300, 800, 1600, 3000, 5000];
  if (level <= 6) return base[Math.max(1, level) - 1];
  return 5000 + (level - 6) * 2500;
}

export function levelFor(xp: number): number {
  let lv = 1;
  while (levelStartXp(lv + 1) <= xp) lv++;
  return lv;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Localized title; beyond level 6 the master title gets a roman rank: "Meridian Master II". */
export function levelTitle(level: number, l: Lang = lang): string {
  const titles = TITLES[l];
  if (level <= titles.length) return titles[Math.max(1, level) - 1];
  const rank = level - titles.length + 1;
  return `${titles[titles.length - 1]} ${ROMAN[rank] ?? rank}`;
}

const WEEK_LABELS: Record<Lang, string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  tr: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'],
};

/** Pure core of progressSummary, testable without storage or clocks. */
export function computeProgress(
  histories: Record<string, History>,
  today: number,
  /** 0 = Monday … 6 = Sunday for `today`. */
  weekdayIndex: number,
  l: Lang = 'en',
): ProgressSummary {
  let xp = 0;
  let todayXp = 0;
  let todayDone = 0;
  const days = new Set<number>();
  for (const [mode, hist] of Object.entries(histories)) {
    for (const [dayKey, r] of Object.entries(hist || {})) {
      const day = Number(dayKey);
      if (!Number.isInteger(day) || day < 1 || day > today || !r || typeof r.label !== 'string') continue;
      const gain = xpFor(mode, !!r.won, r.label);
      xp += gain;
      days.add(day);
      if (day === today) {
        todayXp += gain;
        todayDone++;
      }
    }
  }

  // Current streak: run of consecutive played days ending today, or yesterday if today is still open.
  let end = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(end)) {
    streak++;
    end--;
  }
  let bestStreak = 0;
  for (const d of days) {
    if (days.has(d - 1)) continue; // only start counting at the first day of a run
    let n = 0;
    while (days.has(d + n)) n++;
    bestStreak = Math.max(bestStreak, n);
  }

  const level = levelFor(xp);
  const week: WeekDay[] = WEEK_LABELS[l].map((label, i) => {
    const day = today - weekdayIndex + i;
    return { label, played: days.has(day), today: i === weekdayIndex, future: i > weekdayIndex };
  });

  return {
    xp,
    level,
    levelTitle: levelTitle(level, l),
    levelStartXp: levelStartXp(level),
    nextLevelXp: levelStartXp(level + 1),
    streak,
    bestStreak,
    week,
    todayDone,
    todayXp,
  };
}

/** Histories of all modes from local storage. */
export function allHistories(): Record<string, History> {
  const out: Record<string, History> = {};
  for (const id of MODE_IDS) out[id] = getStats(id).history;
  return out;
}

export function progressSummary(): ProgressSummary {
  const now = new Date();
  return computeProgress(allHistories(), todayNumber(now), (now.getDay() + 6) % 7, lang);
}
