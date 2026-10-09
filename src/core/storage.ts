// Per-viewer persistence in localStorage. Every access is guarded: the game must work without it.
const PREFIX = 'meridian:';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: ignore */
  }
}

export function loadGame<T>(mode: string, day: number): T | null {
  return read<T>(`${mode}:day:${day}`);
}

export function saveGame(mode: string, day: number, state: unknown): void {
  write(`${mode}:day:${day}`, state);
}

export interface ModeStats {
  played: number;
  wins: number;
  streak: number;
  maxStreak: number;
  lastDay: number;
  /** Histogram keyed by a mode-defined bucket label (e.g. "1".."6", "X"). */
  dist: Record<string, number>;
  /** Day -> short result summary for the home screen. */
  history: Record<string, { won: boolean; label: string }>;
}

const EMPTY: ModeStats = { played: 0, wins: 0, streak: 0, maxStreak: 0, lastDay: 0, dist: {}, history: {} };

export function getStats(mode: string): ModeStats {
  return { ...EMPTY, ...(read<ModeStats>(`${mode}:stats`) || {}) };
}

/** Record a finished puzzle once. `bucket` feeds the distribution chart, `label` the home card. */
export function recordResult(mode: string, day: number, won: boolean, bucket: string, label: string): ModeStats {
  const s = getStats(mode);
  if (s.history[day]) return s;
  s.played += 1;
  if (won) {
    s.wins += 1;
    s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
  } else {
    s.streak = 0;
  }
  s.lastDay = day;
  s.dist[bucket] = (s.dist[bucket] || 0) + 1;
  s.history[day] = { won, label };
  write(`${mode}:stats`, s);
  return s;
}

export function getPref(key: string): string | null {
  return read<string>(`pref:${key}`);
}

export function setPref(key: string, value: string): void {
  write(`pref:${key}`, value);
}
