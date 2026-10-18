// Progress and stats live in this browser only. Every access is guarded: storage can be unavailable
// (private windows, blocked site data) and the game must still work without it.

const PREFIX = "dailytrade:";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: progress just won't persist */
  }
}

export function loadProgress(n: number): number[] {
  return read<{ allocs: number[] }>(`game:${n}`, { allocs: [] }).allocs;
}

export function saveProgress(n: number, allocs: number[]): void {
  write(`game:${n}`, { allocs });
}

export interface GameRecord {
  ret: number; // % return
  bh: number; // buy-and-hold % return
  pct: number; // percentile vs random traders
}

export interface Stats {
  played: number;
  beat: number; // rounds that beat buy and hold
  streak: number;
  maxStreak: number;
  lastN: number | null;
  history: Record<string, GameRecord>;
}

const EMPTY: Stats = { played: 0, beat: 0, streak: 0, maxStreak: 0, lastN: null, history: {} };

export function loadStats(): Stats {
  return { ...EMPTY, ...read<Partial<Stats>>("stats", {}) };
}

/** Record a finished daily puzzle once; returns the updated stats. */
export function recordResult(n: number, record: GameRecord): Stats {
  const stats = loadStats();
  if (stats.history[n]) return stats;
  const streak = stats.lastN === n - 1 ? stats.streak + 1 : 1;
  const next: Stats = {
    played: stats.played + 1,
    beat: stats.beat + (record.ret > record.bh ? 1 : 0),
    streak,
    maxStreak: Math.max(stats.maxStreak, streak),
    lastN: n,
    history: { ...stats.history, [n]: record },
  };
  write("stats", next);
  return next;
}

export function seenHelp(): boolean {
  return read("help-seen", false);
}

export function markHelpSeen(): void {
  write("help-seen", true);
}
