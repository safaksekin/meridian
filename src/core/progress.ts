// Player progression computed from local stats (no server). STUB: replaced by the full version.
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

export function progressSummary(): ProgressSummary {
  return {
    xp: 0, level: 1, levelTitle: 'Kaşif', levelStartXp: 0, nextLevelXp: 500, streak: 0, bestStreak: 0,
    week: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((label, i) => ({ label, played: false, today: i === 0, future: i > 0 })),
    todayDone: 0, todayXp: 0,
  };
}
