// Game rules and scoring. Pure functions, no UI.
//
// Before each of the DAYS game days the player picks how much of the portfolio to have
// invested (a LEVELS value). The trade fills at that day's open with a FEE on the amount
// traded; the portfolio is then valued at that day's close.

export type Bar = [open: number, high: number, low: number, close: number];

export const START = 10_000;
export const FEE = 0.001;
export const DAYS = 30;
export const LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

export interface DayResult {
  alloc: number;
  fee: number;
  value: number; // portfolio value at the day's close
  pnl: number; // change in value since the previous close
}

export interface PlayResult {
  days: DayResult[];
  final: number;
  fees: number;
}

export function play(game: Bar[], allocs: number[]): PlayResult {
  let cash = START;
  let shares = 0;
  let prev = START;
  let fees = 0;
  const days: DayResult[] = [];
  allocs.forEach((alloc, d) => {
    const [open, , , close] = game[d];
    const value = cash + shares * open;
    const trade = alloc * value - shares * open;
    let fee = 0;
    if (trade > 1e-9) {
      const buy = Math.min(trade, cash / (1 + FEE));
      shares += buy / open;
      fee = buy * FEE;
      cash -= buy + fee;
    } else if (trade < -1e-9) {
      const sell = -trade;
      shares -= sell / open;
      fee = sell * FEE;
      cash += sell - fee;
    }
    const closeValue = cash + shares * close;
    days.push({ alloc, fee, value: closeValue, pnl: closeValue - prev });
    prev = closeValue;
    fees += fee;
  });
  return { days, final: prev, fees };
}

export const pctChange = (value: number) => (value / START - 1) * 100;

export function buyAndHold(game: Bar[], days = game.length): number {
  return play(game, Array(days).fill(1)).final;
}

/** The best result with perfect hindsight: fully in when the price rises before the next decision, out otherwise. */
export function bestPossible(game: Bar[]): number {
  const allocs = game.map(([open], d) => {
    const next = d + 1 < game.length ? game[d + 1][0] : game[d][3];
    return next > open ? 1 : 0;
  });
  return play(game, allocs).final;
}

// Small seeded PRNG so every player is compared with the same random traders.
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

/** Final values of random traders who pick a random level and change it on ~1 day in 3. */
export function randomFinals(game: Bar[], count: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const pick = () => LEVELS[Math.floor(rand() * LEVELS.length)];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let level: number = pick();
    const allocs = game.map((_, d) => (d === 0 || rand() < 0.35 ? (level = pick()) : level));
    out.push(play(game, allocs).final);
  }
  return out.sort((a, b) => a - b);
}

/** Share of ``finals`` strictly below ``value``, in percent. */
export function percentile(value: number, finals: number[]): number {
  if (!finals.length) return 0;
  let lo = 0;
  let hi = finals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (finals[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / finals.length) * 100;
}

/** One emoji per day: in cash, or invested and the day gained or lost. */
export function squares(days: DayResult[]): string {
  return days.map((d) => (d.alloc === 0 ? "⬜" : d.pnl >= 0 ? "🟩" : "🟥")).join("");
}

export function signed(value: number, digits = 1): string {
  const s = value.toFixed(digits);
  return value > 0 ? `+${s}` : value < 0 ? s.replace("-", "−") : s;
}

export function shareText(opts: { title: string; n: number; practice: boolean; subject: string; result: PlayResult; bh: number; url: string }): string {
  const ret = pctChange(opts.result.final);
  const bh = pctChange(opts.bh);
  return [
    `${opts.title} ${opts.practice ? "practice " : ""}#${opts.n} · ${opts.subject}`,
    `${ret >= 0 ? "📈" : "📉"} ${signed(ret)}% vs buy & hold ${signed(bh)}% ${ret > bh ? "✅" : "❌"}`,
    opts.url,
  ].filter(Boolean).join("\n");
}
